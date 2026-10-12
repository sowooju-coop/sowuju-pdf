import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { PdfClient } from '../lib/pdfClient';
import type { Bookmark } from '../lib/protocol';

type Path = number[];
const clone = (l: Bookmark[]): Bookmark[] => l.map((b) => ({ ...b, children: clone(b.children) }));
const at = (l: Bookmark[], p: Path) => p.slice(1).reduce((b, i) => b.children[i], l[p[0]]);
const siblings = (l: Bookmark[], p: Path) => (p.length === 1 ? l : at(l, p.slice(0, -1)).children);
const samePath = (a: Path | null, b: Path) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);
const count = (l: Bookmark[]): number => l.reduce((n, b) => n + 1 + count(b.children), 0);

/**
 * 왼쪽 '목차' 화면: 누르면 그 자리로 가고, 이름 바꾸기·지우기·순서·단계 바꾸기, 지금 쪽 넣기, 자동으로 만들기.
 * 고칠 때마다 바로 문서에 들어간다 (되돌리기 가능)
 */
export function OutlinePanel({ client, version, cur, onGo, onApply, onMessage }: {
  client: PdfClient;
  /** 문서가 바뀔 때마다 달라지는 값 (목차를 다시 읽는다) */
  version: string;
  cur: number;
  onGo: (page: number, y?: number) => void;
  onApply: (list: Bookmark[]) => Promise<void>;
  onMessage: (m: string) => void;
}) {
  const [list, setList] = useState<Bookmark[] | null>(null);
  const [selPath, setSelPath] = useState<Path | null>(null);
  const [editing, setEditing] = useState<Path | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let off = false;
    client.outline().then((l) => { if (!off) setList(l); }).catch(() => setList([]));
    return () => { off = true; };
  }, [client, version]);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);

  const commit = async (next: Bookmark[], sel: Path | null = selPath) => {
    setList(next);
    setSelPath(sel);
    await onApply(next);
  };
  const change = (fn: (l: Bookmark[]) => Path | null | void) => {
    if (!list) return;
    const next = clone(list);
    const sel = fn(next);
    void commit(next, sel === undefined ? selPath : sel);
  };

  const addCurrent = async () => {
    const t = await client.pageTitle(cur).catch(() => null);
    const b: Bookmark = { title: t?.title ?? `${cur + 1}쪽`, page: cur, y: t?.y, open: true, children: [] };
    change((l) => {
      // 고른 항목 바로 뒤(같은 단계)에, 없으면 쪽 순서에 맞는 자리에
      if (selPath) { const sib = siblings(l, selPath); sib.splice(selPath[selPath.length - 1] + 1, 0, b); const p = [...selPath]; p[p.length - 1]++; setEditing(p); return p; }
      let i = l.findIndex((x) => x.page > cur);
      if (i < 0) i = l.length;
      l.splice(i, 0, b);
      setEditing([i]);
      return [i];
    });
  };
  const auto = async () => {
    if (list?.length && !window.confirm('지금 목차를 지우고 글씨 크기로 새로 만들까요?')) return;
    setBusy(true);
    try {
      const l = await client.autoOutline();
      if (!l.length) { onMessage('제목으로 보이는 줄을 찾지 못했어요. "지금 쪽 넣기"로 직접 만들어 주세요.'); return; }
      await commit(l, null);
      onMessage(`목차 ${count(l)}개를 만들었어요. 이름을 바꾸거나 지울 수 있어요.`);
    } catch (e) { onMessage(`목차를 만들지 못했어요. ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const ops = selPath && list ? (() => {
    const p = selPath, last = p[p.length - 1], sib = siblings(list, p);
    return {
      up: last > 0, down: last < sib.length - 1, indent: last > 0, outdent: p.length > 1,
    };
  })() : null;
  const move = (d: -1 | 1) => change((l) => {
    const p = selPath!, sib = siblings(l, p), i = p[p.length - 1];
    [sib[i], sib[i + d]] = [sib[i + d], sib[i]];
    return [...p.slice(0, -1), i + d];
  });
  const indent = () => change((l) => {
    const p = selPath!, sib = siblings(l, p), i = p[p.length - 1];
    const [b] = sib.splice(i, 1);
    const parent = sib[i - 1];
    parent.children.push(b); parent.open = true;
    return [...p.slice(0, -1), i - 1, parent.children.length - 1];
  });
  const outdent = () => change((l) => {
    const p = selPath!, sib = siblings(l, p), i = p[p.length - 1];
    const [b] = sib.splice(i, 1);
    const pp = p.slice(0, -1), psib = siblings(l, pp), pi = pp[pp.length - 1];
    psib.splice(pi + 1, 0, b);
    return [...pp.slice(0, -1), pi + 1];
  });
  const remove = () => change((l) => {
    const p = selPath!, sib = siblings(l, p);
    const [b] = sib.splice(p[p.length - 1], 1);
    // 아래 단계는 지우지 않고 한 단계 올린다
    sib.splice(p[p.length - 1], 0, ...b.children);
    return null;
  });
  const rename = (p: Path, title: string) => {
    setEditing(null);
    const t = title.trim();
    if (!list || !t || t === at(list, p).title) return;
    change((l) => { at(l, p).title = t.slice(0, 120); });
  };

  const row = (b: Bookmark, p: Path): React.ReactNode => {
    const sel = samePath(selPath, p);
    return (
      <li key={p.join('.')}>
        <div className={`olrow${sel ? ' sel' : ''}`} style={{ paddingLeft: 6 + (p.length - 1) * 14 }}>
          {b.children.length ? (
            <button className="oltog" aria-label={b.open ? '접기' : '펼치기'} onClick={() => change((l) => { at(l, p).open = !b.open; })}><Icon name={b.open ? 'down' : 'right'} size={12} /></button>
          ) : <span className="oltog" />}
          {samePath(editing, p) ? (
            <input ref={input} className="olinput" defaultValue={b.title} aria-label="책갈피 이름"
              onBlur={(e) => rename(p, e.target.value)}
              onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') rename(p, e.currentTarget.value); if (e.key === 'Escape') setEditing(null); e.stopPropagation(); }} />
          ) : (
            <button className="oltitle" title={`${b.title} (${b.page + 1}쪽)`} onClick={() => { setSelPath(p); if (b.page >= 0) onGo(b.page, b.y); }} onDoubleClick={() => setEditing(p)}>
              <span>{b.title}</span><small>{b.page >= 0 ? b.page + 1 : ''}</small>
            </button>
          )}
        </div>
        {b.open && b.children.length > 0 && <ul>{b.children.map((c, i) => row(c, [...p, i]))}</ul>}
      </li>
    );
  };

  return (
    <aside className="outline" aria-label="목차">
      <div className="olacts">
        <button className="btn sm" onClick={addCurrent} disabled={!list}><Icon name="plus" size={14} />지금 쪽 넣기</button>
        <button className="btn sm" onClick={auto} disabled={!list || busy} title="큰 글씨·번호 붙은 제목을 찾아 목차를 만들어요">{busy ? '만드는 중…' : '자동으로'}</button>
      </div>
      {list === null ? <p className="olempty">읽는 중…</p> : list.length === 0 ? (
        <p className="olempty">목차가 없어요.<br />"자동으로"를 누르면 제목을 찾아 만들고, "지금 쪽 넣기"로 직접 넣을 수 있어요.<br />목차는 저장하면 다른 PDF 프로그램에서도 보여요.</p>
      ) : <ul className="oltree">{list.map((b, i) => row(b, [i]))}</ul>}
      {ops && (
        <div className="olbar" role="toolbar" aria-label="고른 책갈피">
          <button onClick={() => setEditing(selPath)} title="이름 바꾸기 (두 번 누르기)"><Icon name="edit" size={15} /></button>
          <button onClick={() => move(-1)} disabled={!ops.up} title="위로"><Icon name="up" size={15} /></button>
          <button onClick={() => move(1)} disabled={!ops.down} title="아래로"><Icon name="down" size={15} /></button>
          <button onClick={outdent} disabled={!ops.outdent} title="한 단계 위로 (바깥으로)"><Icon name="left" size={15} /></button>
          <button onClick={indent} disabled={!ops.indent} title="한 단계 아래로 (위 항목 안으로)"><Icon name="right" size={15} /></button>
          <button onClick={remove} title="지우기" className="danger"><Icon name="trash" size={15} /></button>
        </div>
      )}
    </aside>
  );
}
