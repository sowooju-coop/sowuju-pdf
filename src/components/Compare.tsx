import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { PageCanvas } from './PageCanvas';
import { PdfClient } from '../lib/pdfClient';
import { diff, hunks, type Hunk } from '../lib/diff';
import type { OpenedFile } from '../lib/host';
import type { PageInfo } from '../lib/protocol';

type Word = { page: number; t: string; r: [number, number, number, number] };
const key = (w: Word) => w.t.normalize('NFC').toLowerCase();
const join = (ws: Word[]) => ws.map((w) => w.t).join(' ');
const cut = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 한쪽 문서 세로 목록 + 바뀐 낱말 표시 */
function Column({ client, pages, marks, current, colRef, tone, title, onScroll }: {
  client: PdfClient; pages: PageInfo[];
  /** 쪽 → 표시할 상자 [x0,y0,x1,y1, 바뀐 곳 번호] */
  marks: Map<number, [number, number, number, number, number][]>;
  current: number; colRef: React.RefObject<HTMLDivElement>; tone: 'del' | 'ins'; title: string;
  onScroll?: () => void;
}) {
  const [width, setWidth] = useState(500);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;
    setRoot(el);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [colRef]);
  const maxW = Math.max(...pages.map((p) => p.width), 1);
  const zoom = Math.max(0.2, (width - 40) / maxW);
  return (
    <div className="cmpcolwrap">
      <div className={`cmphead ${tone}`}>{title}</div>
      <div className="cmpcol" ref={colRef} onScroll={onScroll}>
        {pages.map((p, i) => (
          <div key={i} className="cmppage" data-page={i} style={{ width: p.width * zoom, height: p.height * zoom }}>
            <PageCanvas client={client} index={i} info={p} zoom={zoom} rev={0} root={root} className="sheet" />
            {(marks.get(i) ?? []).map(([x0, y0, x1, y1, h], k) => (
              <span key={k} className={`cmpmark ${tone}${h === current ? ' cur' : ''}`} data-h={h}
                style={{ left: x0 * zoom - 1, top: y0 * zoom - 1, width: (x1 - x0) * zoom + 2, height: (y1 - y0) * zoom + 2 }} />
            ))}
            <span className="cmppn">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 두 PDF 비교: 왼쪽(고른 파일, 이전)과 오른쪽(지금 문서)을 나란히 놓고
 * 빠진 낱말은 빨강, 새로 생긴 낱말은 초록으로 표시한다. 글자만 비교한다(그림·표 선은 아님)
 */
export function CompareView({ client, pages, name, other, onClose }: {
  client: PdfClient; pages: PageInfo[]; name: string; other: OpenedFile; onClose: () => void;
}) {
  const [otherClient, setOtherClient] = useState<PdfClient | null>(null);
  const [otherPages, setOtherPages] = useState<PageInfo[] | null>(null);
  const [state, setState] = useState<{ a: Word[]; b: Word[]; hs: Hunk[] } | { error: string } | null>(null);
  const [idx, setIdx] = useState(0);
  const colA = useRef<HTMLDivElement>(null), colB = useRef<HTMLDivElement>(null);

  // 고른 파일은 따로 작업 스레드를 하나 더 열어서 읽는다 (지금 문서에 영향 없음)
  useEffect(() => {
    const c = new PdfClient();
    let off = false;
    (async () => {
      try {
        const r = await c.open(other.bytes);
        if (r.needsPassword) throw new Error('암호가 걸린 PDF예요. 암호를 푼 뒤 비교해 주세요.');
        if (off) return;
        setOtherClient(c); setOtherPages(r.pages!);
        const [a, b] = await Promise.all([c.words(), client.words()]);
        if (off) return;
        if (!a.length && !b.length) throw new Error('두 문서 모두 글자가 없어요(스캔 문서). 먼저 "글자 읽기"를 해 주세요.');
        const ops = diff(a.map(key), b.map(key));
        if (!ops) throw new Error('두 문서가 너무 많이 달라서 비교할 수 없어요.');
        setState({ a, b, hs: hunks(ops) });
      } catch (e) { if (!off) setState({ error: (e as Error).message }); }
    })();
    return () => { off = true; c.close(); };
  }, [client, other]);

  const data = state && 'hs' in state ? state : null;
  const marks = useMemo(() => {
    const A = new Map<number, [number, number, number, number, number][]>(), B = new Map<number, [number, number, number, number, number][]>();
    if (!data) return { A, B };
    // 비스듬한 글자(워터마크 등)는 상자가 쪽을 덮으므로 쪽 위에는 그리지 않고 목록에만 둔다
    const ok = (r: Word['r']) => r[3] - r[1] < 60;
    data.hs.forEach((h, n) => {
      for (let i = h.a[0]; i < h.a[1]; i++) { const w = data.a[i]; if (ok(w.r)) A.set(w.page, [...(A.get(w.page) ?? []), [...w.r, n]]); }
      for (let i = h.b[0]; i < h.b[1]; i++) { const w = data.b[i]; if (ok(w.r)) B.set(w.page, [...(B.get(w.page) ?? []), [...w.r, n]]); }
    });
    return { A, B };
  }, [data]);

  /** 바뀐 곳 n으로 두 쪽 모두 옮긴다 (한쪽에 낱말이 없으면 그 근처 낱말로) */
  const show = (n: number) => {
    if (!data || !data.hs.length) return;
    const k = (n + data.hs.length) % data.hs.length;
    setIdx(k);
    const h = data.hs[k];
    const scroll = (col: HTMLDivElement | null, ws: Word[], i: number) => {
      const w = ws[Math.min(i, ws.length - 1)];
      if (!col || !w) return;
      const el = col.querySelector<HTMLElement>(`.cmppage[data-page="${w.page}"]`);
      if (!el) return;
      const zoom = el.clientWidth / (col === colA.current ? otherPages![w.page].width : pages[w.page].width);
      col.scrollTo({ top: el.offsetTop + w.r[1] * zoom - col.clientHeight * 0.35, behavior: 'smooth' });
    };
    scroll(colA.current, data.a, h.a[0]);
    scroll(colB.current, data.b, h.b[0]);
  };
  useEffect(() => { if (data?.hs.length) requestAnimationFrame(() => show(0)); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowDown' || e.key === 'F3' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); show(idx + 1); }
      else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) { e.preventDefault(); show(idx - 1); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  const n = data?.hs.length ?? 0;
  return (
    <div className="cmpview" role="dialog" aria-label="두 PDF 비교">
      <header className="cmpbar">
        <b>두 PDF 비교</b>
        <span className="cmplegend"><i className="del" />빠진 글자 <i className="ins" />새로 생긴 글자</span>
        <span className="cmpcount" aria-live="polite">{!state ? '비교하는 중…' : 'error' in state ? '' : n ? `바뀐 곳 ${idx + 1} / ${n}` : '글자가 같아요'}</span>
        <button className="iconbtn" onClick={() => show(idx - 1)} disabled={!n} aria-label="앞의 바뀐 곳" title="앞의 바뀐 곳 (↑)"><Icon name="up" size={17} /></button>
        <button className="iconbtn" onClick={() => show(idx + 1)} disabled={!n} aria-label="다음 바뀐 곳" title="다음 바뀐 곳 (↓)"><Icon name="down" size={17} /></button>
        <button className="btn" onClick={onClose}>닫기</button>
      </header>
      {state && 'error' in state ? <div className="cmperr">{state.error}</div> : (
        <div className="cmpbody">
          {otherClient && otherPages ? (
            <Column client={otherClient} pages={otherPages} marks={marks.A} current={idx} colRef={colA} tone="del" title={`이전: ${other.name}`} />
          ) : <div className="cmpcolwrap"><div className="cmphead del">이전: {other.name}</div><div className="cmpcol" ref={colA}><p className="cmpwait">여는 중…</p></div></div>}
          <Column client={client} pages={pages} marks={marks.B} current={idx} colRef={colB} tone="ins" title={`지금: ${name}`} />
          <aside className="cmplist" aria-label="바뀐 곳 목록">
            {!data ? <p className="cmpwait">비교하는 중…</p> : !n ? <p className="cmpwait">두 문서의 글자가 똑같아요.<br />(그림·표 선·글꼴 모양은 비교하지 않아요)</p> : data.hs.map((h, k) => {
              const del = join(data.a.slice(h.a[0], h.a[1])), ins = join(data.b.slice(h.b[0], h.b[1]));
              const pg = (data.b[h.b[0]] ?? data.b[Math.max(0, h.b[0] - 1)])?.page;
              return (
                <button key={k} className={`cmpitem${k === idx ? ' on' : ''}`} onClick={() => show(k)}>
                  <small>{pg !== undefined ? `${pg + 1}쪽` : ''} · {del && ins ? '바뀜' : del ? '빠짐' : '생김'}</small>
                  {del && <span className="d">{cut(del)}</span>}
                  {ins && <span className="i">{cut(ins)}</span>}
                </button>
              );
            })}
          </aside>
        </div>
      )}
    </div>
  );
}
