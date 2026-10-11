import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PdfClient, type EditResult } from './lib/pdfClient';
import type { PageInfo, ReplaceRequest } from './lib/protocol';
import { FONTS, loadFonts, type FontFamily } from './lib/fonts';
import type { EditStyle } from './lib/textDiff';
import { EditLayer, type EditingState } from './components/EditLayer';
import { isApp, openFile, printPages, saveFile, type PrintPage } from './lib/host';
import { PageCanvas } from './components/PageCanvas';
import { Icon } from './components/Icon';

interface Doc {
  name: string;
  pages: PageInfo[];
}
type PrintRange = 'all' | 'current' | 'selected';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const baseName = (n: string) => n.replace(/\.pdf$/i, '');

export default function App() {
  const client = useMemo(() => new PdfClient(), []);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [rev, setRev] = useState(0);
  const [zoom, setZoom] = useState(1.25);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pw, setPw] = useState<{ name: string; bytes: Uint8Array; wrong: boolean } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [styleOverride, setStyleOverride] = useState<EditStyle | null>(null);
  useEffect(() => { loadFonts(); }, []);
  const viewer = useRef<HTMLDivElement | null>(null);
  const [viewerEl, setViewerEl] = useState<HTMLDivElement | null>(null);
  const lastClick = useRef<number | null>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout((say as any).t);
    (say as any).t = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const fitWidth = useCallback((pages: PageInfo[], cap = false) => {
    const v = viewer.current;
    if (!v || !pages.length) return;
    const maxW = Math.max(...pages.map((p) => p.width));
    let z = (v.clientWidth - 48) / maxW;
    if (cap) z = Math.min(z, 1.5);
    setZoom(clamp(z, 0.25, 4));
  }, []);

  const load = useCallback(async (name: string, bytes: Uint8Array, password?: string) => {
    setBusy('여는 중…');
    try {
      const r = await client.open(bytes, password);
      if (r.needsPassword) {
        setPw({ name, bytes, wrong: !!r.wrongPassword });
        return;
      }
      setPw(null);
      setDoc({ name, pages: r.pages! });
      setSel(new Set());
      setCur(0);
      setDirty(false);
      setHist({ canUndo: false, canRedo: false });
      setRev((v) => v + 1);
      viewer.current?.scrollTo(0, 0);
      requestAnimationFrame(() => fitWidth(r.pages!, true));
    } catch (e) {
      say(`"${name}" 파일을 열지 못했어요. ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [client, fitWidth, say]);

  const doOpen = useCallback(async () => {
    const f = await openFile();
    if (f) load(f.name, f.bytes);
  }, [load]);

  const doSave = useCallback(async () => {
    if (!doc) return;
    setBusy('저장하는 중…');
    try {
      const bytes = await client.save();
      const where = await saveFile(`${baseName(doc.name)}${dirty ? '_편집' : ''}.pdf`, bytes);
      if (where) { say('저장했어요.'); setDirty(false); }
    } catch (e) {
      say(`저장하지 못했어요. ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [client, doc, dirty, say]);

  const targets = useCallback((): number[] => (sel.size ? [...sel].sort((a, b) => a - b) : doc ? [cur] : []), [sel, cur, doc]);

  const applyPages = useCallback((r: EditResult) => {
    setDoc((d) => (d ? { ...d, pages: r.pages } : d));
    setHist({ canUndo: r.canUndo, canRedo: r.canRedo });
    setRev((v) => v + 1);
    setDirty(true);
  }, []);

  const replace = useCallback(async (req: ReplaceRequest) => {
    setBusy('글자 바꾸는 중…');
    try { applyPages(await client.replace(req)); }
    catch (e) { say(`글자를 바꾸지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, [client, applyPages, say]);

  const undo = useCallback(async () => { if (hist.canUndo) applyPages(await client.undo()); }, [client, hist, applyPages]);
  const redo = useCallback(async () => { if (hist.canRedo) applyPages(await client.redo()); }, [client, hist, applyPages]);

  const rotate = useCallback(async (delta: number) => {
    const t = targets();
    if (t.length) applyPages(await client.rotate(t, delta));
  }, [client, targets, applyPages]);

  const remove = useCallback(async () => {
    const t = targets();
    if (!doc || !t.length) return;
    if (t.length >= doc.pages.length) { say('모든 페이지를 지울 수는 없어요. 한 쪽 이상 남겨 주세요.'); return; }
    applyPages(await client.delete(t));
    setSel(new Set());
    setCur((c) => clamp(c, 0, doc.pages.length - t.length - 1));
    say(`${t.length}쪽을 지웠어요.`);
  }, [client, doc, targets, applyPages, say]);

  const move = useCallback(async (dir: -1 | 1) => {
    if (!doc) return;
    const t = new Set(targets());
    const order = doc.pages.map((_, i) => i);
    if (dir < 0) { for (let i = 1; i < order.length; i++) if (t.has(order[i]) && !t.has(order[i - 1])) [order[i - 1], order[i]] = [order[i], order[i - 1]]; }
    else { for (let i = order.length - 2; i >= 0; i--) if (t.has(order[i]) && !t.has(order[i + 1])) [order[i + 1], order[i]] = [order[i], order[i + 1]]; }
    applyPages(await client.move(order));
    const newSel = new Set(order.map((o, i) => (t.has(o) ? i : -1)).filter((i) => i >= 0));
    setSel(sel.size ? newSel : new Set());
    setCur(order.indexOf(cur));
  }, [client, doc, targets, applyPages, sel, cur]);

  const doPrint = useCallback(async (range: PrintRange, dpi: number) => {
    if (!doc) return;
    setPrintOpen(false);
    const list = range === 'all' ? doc.pages.map((_, i) => i) : range === 'current' ? [cur] : targets();
    const pages: PrintPage[] = [];
    try {
      for (let k = 0; k < list.length; k++) {
        setBusy(`인쇄 준비 중… ${k + 1} / ${list.length}쪽`);
        const info = doc.pages[list[k]];
        const landscape = info.width > info.height;
        // 가로 페이지는 세로 용지에 꽉 차도록 90도 돌려 그린다
        pages.push({ png: await client.renderPng(list[k], dpi / 72, landscape ? 90 : 0), landscape });
      }
      setBusy(null);
      const r = await printPages(baseName(doc.name), pages);
      if (!r.ok && r.reason && r.reason !== 'cancelled') say(`인쇄하지 못했어요. (${r.reason})`);
    } catch (e) {
      say(`인쇄 준비 중 문제가 생겼어요. ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [client, doc, cur, targets, say]);

  // 스크롤 위치로 현재 페이지 추적
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mid = v.scrollTop + v.clientHeight * 0.4;
        const els = v.querySelectorAll<HTMLElement>('.page');
        let c = 0;
        els.forEach((el, i) => { if (el.offsetTop <= mid) c = i; });
        setCur(c);
      });
    };
    v.addEventListener('scroll', onScroll);
    return () => v.removeEventListener('scroll', onScroll);
  }, [doc]);

  const goTo = (i: number) => {
    const el = viewer.current?.querySelectorAll<HTMLElement>('.page')[i];
    if (el && viewer.current) viewer.current.scrollTop = el.offsetTop - 16;
    setCur(i);
  };

  const onThumb = (i: number, e: React.MouseEvent) => {
    const s = new Set(sel);
    if (e.shiftKey && lastClick.current !== null) {
      s.clear();
      for (let k = Math.min(lastClick.current, i); k <= Math.max(lastClick.current, i); k++) s.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      s.has(i) ? s.delete(i) : s.add(i);
      lastClick.current = i;
    } else {
      s.clear();
      s.add(i);
      lastClick.current = i;
    }
    setSel(s);
    goTo(i);
  };

  // 단축키, 끌어다 놓기, 설치형에서 파일 연결로 열기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); doOpen(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
      else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); if (doc) setPrintOpen(true); }
      else if ((e.target as HTMLElement).isContentEditable) return;
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (!mod && e.key.toLowerCase() === 'e' && doc) { setMode((m) => (m === 'edit' ? 'view' : 'edit')); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom((z) => clamp(z * 1.2, 0.25, 4)); }
      else if (mod && e.key === '-') { e.preventDefault(); setZoom((z) => clamp(z / 1.2, 0.25, 4)); }
      else if (e.key === 'Escape') { setPrintOpen(false); }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) load(f.name, new Uint8Array(await f.arrayBuffer()));
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onOver);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onOver);
    };
  }, [doOpen, doSave, load, doc, undo, redo]);

  useEffect(() => { window.sowuju?.onOpenPath((f) => load(f.name, f.bytes)); }, [load]);

  const thumbZoom = (p: PageInfo) => Math.min(120 / p.width, 160 / p.height);

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">소우주 <b>PDF</b></div>
        <div className="tools" role="toolbar" aria-label="도구">
          <div className="grp">
            <button className="tb" onClick={doOpen} title="열기 (Ctrl+O)"><Icon name="open" /><span>열기</span></button>
            <button className="tb primary" onClick={doSave} disabled={!doc} title="저장 (Ctrl+S)"><Icon name="save" /><span>저장</span></button>
            <button className="tb" onClick={() => setPrintOpen(true)} disabled={!doc} title="인쇄 (Ctrl+P)"><Icon name="print" /><span>인쇄</span></button>
          </div>
          <div className="grp">
            <button className={`tb${mode === 'edit' ? ' on' : ''}`} onClick={() => setMode((m) => (m === 'edit' ? 'view' : 'edit'))} disabled={!doc} title="글자 수정 (E)"><Icon name="edit" /><span>글자 수정</span></button>
          </div>
          <div className="grp">
            <button className="tb" onClick={undo} disabled={!hist.canUndo} title="실행 취소 (Ctrl+Z)"><Icon name="undo" /><span>취소</span></button>
            <button className="tb" onClick={redo} disabled={!hist.canRedo} title="다시 실행 (Ctrl+Shift+Z)"><Icon name="redo" /><span>다시</span></button>
          </div>
          <div className="grp">
            <button className="tb" onClick={() => setZoom((z) => clamp(z / 1.2, 0.25, 4))} disabled={!doc} title="축소"><Icon name="zoomout" /><span>축소</span></button>
            <div className="zoomv">{Math.round(zoom * 100)}%</div>
            <button className="tb" onClick={() => setZoom((z) => clamp(z * 1.2, 0.25, 4))} disabled={!doc} title="확대"><Icon name="zoomin" /><span>확대</span></button>
            <button className="tb" onClick={() => doc && fitWidth(doc.pages)} disabled={!doc} title="폭에 맞추기"><Icon name="fit" /><span>폭 맞춤</span></button>
          </div>
        </div>
        {doc && <div className="docname" title={doc.name}>{doc.name}{dirty ? ' · 수정됨' : ''}</div>}
      </header>
      {mode === 'edit' && doc && (
        <div className="ctx" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
          {editing ? (
            <>
              <span className="lbl">글꼴</span>
              {(Object.keys(FONTS) as FontFamily[]).map((f) => {
                const cur = styleOverride ?? editing.style;
                return <button key={f} className={`btn${cur.family === f ? ' on' : ''}`} onClick={() => setStyleOverride({ ...cur, family: f })}>{FONTS[f].label}</button>;
              })}
              <button className={`btn${(styleOverride ?? editing.style).bold ? ' on' : ''}`} onClick={() => { const cur = styleOverride ?? editing.style; setStyleOverride({ ...cur, bold: !cur.bold }); }}><b>굵게</b></button>
              <span className="hint">Enter로 적용, Esc로 취소. 원래 글꼴에 맞춰 자동으로 골랐어요.</span>
            </>
          ) : (
            <span className="hint">점선 상자를 누르면 그 줄을, 글자 위를 끌면 고른 부분만 고쳐요. 바뀐 글자만 파일에서 지우고 같은 자리에 새로 써요.</span>
          )}
        </div>
      )}

      <div className="main">
        <aside className="side" aria-label="페이지 목록">
          <div className="pacts">
            <button className="tb" onClick={() => rotate(-90)} disabled={!doc} title="왼쪽으로 회전"><Icon name="rotl" /><span>왼쪽</span></button>
            <button className="tb" onClick={() => rotate(90)} disabled={!doc} title="오른쪽으로 회전"><Icon name="rotr" /><span>오른쪽</span></button>
            <button className="tb" onClick={remove} disabled={!doc} title="페이지 삭제"><Icon name="trash" /><span>삭제</span></button>
            <button className="tb" onClick={() => move(-1)} disabled={!doc} title="앞으로"><Icon name="up" /><span>앞으로</span></button>
            <button className="tb" onClick={() => move(1)} disabled={!doc} title="뒤로"><Icon name="down" /><span>뒤로</span></button>
          </div>
          <div className="psel">{sel.size ? `${sel.size}쪽 선택됨` : '페이지를 눌러 선택 · Shift/Ctrl로 여러 장'}</div>
          <div className="thumbs" onClick={(e) => { if (e.target === e.currentTarget) setSel(new Set()); }}>
            {doc?.pages.map((p, i) => (
              <div key={i} className={`thumb${sel.has(i) ? ' sel' : ''}${cur === i ? ' cur' : ''}`} onClick={(e) => onThumb(i, e)}>
                <PageCanvas client={client} index={i} info={p} zoom={thumbZoom(p)} rev={rev} root={null} className="tbox" />
                <div className="num">{i + 1}</div>
              </div>
            ))}
          </div>
        </aside>

        <section className="viewer" ref={(el) => { const d = el as HTMLDivElement | null; viewer.current = d; if (d !== viewerEl) setViewerEl(d); }}>
          {doc ? (
            <div className="pages">
              {doc.pages.map((p, i) => (
                <div key={i} className="page" data-n={`${i + 1} / ${doc.pages.length}`}>
                  <PageCanvas client={client} index={i} info={p} zoom={zoom} rev={rev} root={viewerEl} className="sheet" />
                  {mode === 'edit' && (
                    <EditLayer
                      client={client} index={i} info={p} zoom={zoom} rev={rev}
                      onReplace={replace} onMessage={say}
                      onEditing={(s) => { setEditing(s); setStyleOverride(null); }}
                      styleOverride={editing?.page === i ? styleOverride : null}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="drop">
                <h2>PDF를 여기에 끌어다 놓으세요</h2>
                <p>파일은 이 컴퓨터 안에서만 처리돼요.{isApp ? '' : ' (브라우저 개발 모드)'}</p>
                <button className="btn solid" onClick={doOpen}>PDF 열기</button>
              </div>
            </div>
          )}
        </section>
      </div>

      {printOpen && doc && <PrintDialog hasSel={sel.size > 0} pageCount={doc.pages.length} onClose={() => setPrintOpen(false)} onPrint={doPrint} />}

      {pw && (
        <div className="modal">
          <form className="dlg" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('pw') as HTMLInputElement).value; load(pw.name, pw.bytes, v); }}>
            <h3>암호가 걸린 PDF</h3>
            <p>{pw.wrong ? '암호가 맞지 않아요. 다시 입력해 주세요. ' : ''}"{pw.name}" 파일을 열려면 암호가 필요해요.</p>
            <input name="pw" type="password" autoFocus autoComplete="off" aria-label="PDF 암호" />
            <div className="acts">
              <button type="button" className="btn" onClick={() => setPw(null)}>취소</button>
              <button type="submit" className="btn solid">열기</button>
            </div>
          </form>
        </div>
      )}

      {busy && <div className="busy"><div>{busy}</div></div>}
      <div className={`toast${toast ? ' show' : ''}`} role="status">{toast}</div>
    </div>
  );
}

function PrintDialog({ hasSel, pageCount, onClose, onPrint }: { hasSel: boolean; pageCount: number; onClose: () => void; onPrint: (r: PrintRange, dpi: number) => void }) {
  const [range, setRange] = useState<PrintRange>('all');
  const [dpi, setDpi] = useState(300);
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg" onSubmit={(e) => { e.preventDefault(); onPrint(range, dpi); }}>
        <h3>인쇄</h3>
        <fieldset>
          <legend>인쇄할 페이지</legend>
          <label><input type="radio" name="range" checked={range === 'all'} onChange={() => setRange('all')} /> 전체 ({pageCount}쪽)</label>
          <label><input type="radio" name="range" checked={range === 'current'} onChange={() => setRange('current')} /> 지금 보는 쪽</label>
          <label><input type="radio" name="range" checked={range === 'selected'} disabled={!hasSel} onChange={() => setRange('selected')} /> 왼쪽 목록에서 고른 쪽</label>
        </fieldset>
        <fieldset>
          <legend>품질</legend>
          <label><input type="radio" name="dpi" checked={dpi === 200} onChange={() => setDpi(200)} /> 보통 (빠름)</label>
          <label><input type="radio" name="dpi" checked={dpi === 300} onChange={() => setDpi(300)} /> 선명하게 (권장)</label>
          <label><input type="radio" name="dpi" checked={dpi === 600} onChange={() => setDpi(600)} /> 아주 선명하게 (작은 글씨·도면)</label>
        </fieldset>
        <p>다음 화면에서 프린터, 매수, 양면 인쇄를 고를 수 있어요.</p>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn solid" autoFocus>다음</button>
        </div>
      </form>
    </div>
  );
}
