import { memo, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { PdfClient } from '../lib/pdfClient';
import type { PageInfo, TextLine } from '../lib/protocol';

type Rect = [number, number, number, number];
export interface TextSelection { page: number; text: string; rects: Rect[] }

const charBox = (q: number[]): Rect => [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];

/** 줄 목록을 한 줄로 펼친 글자 번호로 다룬다 */
function flatten(lines: TextLine[]) {
  const start: number[] = [];
  let n = 0;
  for (const l of lines) { start.push(n); n += l.chars.length; }
  return { start, total: n };
}

/** 누른 자리 → 글자 사이 위치(0..total). near=true면 글자 가까이에서만 */
function hit(lines: TextLine[], start: number[], x: number, y: number, near: boolean): number | null {
  let best = -1, bestD = Infinity;
  lines.forEach((l, i) => {
    const [x0, y0, x1, y1] = l.bbox;
    const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const d = dy * 4 + dx;
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best < 0 || (near && bestD > 6)) return null;
  const l = lines[best];
  let k = l.chars.length;
  for (let i = 0; i < l.chars.length; i++) {
    const b = charBox(l.chars[i].quad);
    if (x < (b[0] + b[2]) / 2) { k = i; break; }
  }
  return start[best] + k;
}

function rangeOf(lines: TextLine[], start: number[], a: number, b: number): { text: string; rects: Rect[] } {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const rects: Rect[] = [];
  let text = '', lastY: number | null = null, lastX = 0;
  lines.forEach((l, i) => {
    const s = Math.max(lo - start[i], 0), e = Math.min(hi - start[i], l.chars.length);
    if (e <= s) return;
    const cs = l.chars.slice(s, e);
    const bs = cs.map((c) => charBox(c.quad));
    rects.push([Math.min(...bs.map((r) => r[0])), l.bbox[1], Math.max(...bs.map((r) => r[2])), l.bbox[3]]);
    // 같은 높이에 이어지는 줄은 띄어쓰기로, 아래 줄은 줄바꿈으로 잇는다
    const y = (l.bbox[1] + l.bbox[3]) / 2, h = l.bbox[3] - l.bbox[1];
    if (lastY !== null) text += Math.abs(y - lastY) < h * 0.5 && bs[0][0] >= lastX - 1 ? (text.endsWith(' ') ? '' : ' ') : '\n';
    text += cs.map((c) => c.c).join('');
    lastY = y; lastX = bs[bs.length - 1][2];
  });
  return { text: text.replace(/[ \t]+\n/g, '\n').trimEnd(), rects };
}

const isSpace = (c: string) => !c.trim();

/**
 * 보기 화면에서 글자를 끌어 고르기. 고르면 위에 작은 단추(복사·형광펜)가 뜬다.
 * 한 쪽 안에서만 고른다.
 */
export const SelectLayer = memo(function SelectLayer({ client, index, info, zoom, rev, current, onSelect, onCopy, onHighlight }: {
  client: PdfClient; index: number; info: PageInfo; zoom: number; rev: number;
  current: TextSelection | null;
  onSelect: (s: TextSelection | null) => void;
  onCopy: () => void;
  onHighlight: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const lines = useRef<{ rev: number; lines: TextLine[]; start: number[] } | null>(null);
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const drag = useRef<{ pid: number; a: number } | null>(null);

  const load = async () => {
    if (lines.current?.rev === rev) return lines.current;
    const l = (await client.lines(index).catch(() => [])).filter((x) => x.chars.length);
    lines.current = { rev, lines: l, start: flatten(l).start };
    return lines.current;
  };
  useEffect(() => { lines.current = null; setRange(null); }, [rev]);
  // 다른 쪽에서 고르면 여기 것은 지운다
  useEffect(() => { if (!current || current.page !== index) setRange(null); }, [current, index]);

  const pt = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };
  const report = (a: number, b: number) => {
    const L = lines.current;
    if (!L || a === b) { onSelect(null); return; }
    const { text, rects } = rangeOf(L.lines, L.start, a, b);
    onSelect(text.trim() ? { page: index, text, rects } : null);
  };

  const sel = range && lines.current ? rangeOf(lines.current.lines, lines.current.start, range.a, range.b) : null;
  const last = sel?.rects.length ? sel.rects[sel.rects.length - 1] : null;
  const first = sel?.rects.length ? sel.rects[0] : null;

  return (
    <div
      ref={el}
      className="selectlayer"
      style={{ width: info.width * zoom, height: info.height * zoom }}
      onPointerEnter={() => { void load(); }}
      onPointerMove={(e) => {
        const L = lines.current;
        if (drag.current?.pid === e.pointerId && L) {
          const [x, y] = pt(e);
          const b = hit(L.lines, L.start, x, y, false);
          if (b !== null) setRange({ a: drag.current.a, b });
          return;
        }
        if (!L || e.buttons) return;
        const [x, y] = pt(e);
        el.current!.style.cursor = hit(L.lines, L.start, x, y, true) !== null ? 'text' : '';
      }}
      onPointerDown={async (e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('.selbar')) return;
        const pid = e.pointerId, [x, y] = pt(e);
        el.current!.setPointerCapture(pid);
        const L = await load();
        const a = hit(L.lines, L.start, x, y, true);
        if (a === null) { setRange(null); onSelect(null); return; }
        e.preventDefault();
        drag.current = { pid, a };
        setRange({ a, b: a });
      }}
      onPointerUp={(e) => {
        if (drag.current?.pid !== e.pointerId) return;
        drag.current = null;
        if (range) report(range.a, range.b);
      }}
      onDoubleClick={(e) => {
        // 두 번 누르면 낱말, 세 번 누르면 한 줄
        const L = lines.current;
        if (!L || (e.target as HTMLElement).closest('.selbar')) return;
        const [x, y] = pt(e);
        const g = hit(L.lines, L.start, x, y, true);
        if (g === null) return;
        const li = L.start.findIndex((s, i) => g >= s && g <= s + L.lines[i].chars.length);
        const cs = L.lines[li].chars, s0 = L.start[li];
        let a = Math.min(g - s0, cs.length - 1), b = a;
        if (isSpace(cs[a].c)) return;
        while (a > 0 && !isSpace(cs[a - 1].c)) a--;
        while (b < cs.length && !isSpace(cs[b].c)) b++;
        setRange({ a: s0 + a, b: s0 + b });
        report(s0 + a, s0 + b);
      }}
      onClick={(e) => {
        if (e.detail !== 3) return;
        const L = lines.current;
        if (!L) return;
        const [x, y] = pt(e);
        const g = hit(L.lines, L.start, x, y, true);
        if (g === null) return;
        const li = L.start.findIndex((s, i) => g >= s && g <= s + L.lines[i].chars.length);
        const a = L.start[li], b = a + L.lines[li].chars.length;
        setRange({ a, b });
        report(a, b);
      }}
    >
      {sel?.rects.map((r, k) => (
        <span key={k} className="selrect" style={{ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom }} />
      ))}
      {!drag.current && current?.page === index && first && last && (
        <div className="selbar" style={{ left: Math.min(first[0] * zoom, info.width * zoom - 190), top: Math.max(0, first[1] * zoom - 44) }} onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={onCopy} title="복사 (Ctrl+C)"><Icon name="copy" size={15} />복사</button>
          <button onClick={onHighlight} title="고른 글자에 형광펜 칠하기"><Icon name="highlight" size={15} />형광펜</button>
        </div>
      )}
    </div>
  );
});
