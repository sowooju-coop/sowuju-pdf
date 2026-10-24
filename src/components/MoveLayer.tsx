// 옮기기: 쪽 안의 원래 글자 줄·그림을 눌러 고르고 끌어서 옮긴다. 그림은 모서리를 끌어 크기도 바꾼다.
// 여러 줄은 빈 곳에서 끌어 네모로 고른다. 화살표 키로 조금씩(Shift는 크게) 옮길 수 있다.
import { memo, useEffect, useRef, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { MovableObject, MoveRequest, PageInfo, TextLine } from '../lib/protocol';

type Rect = [number, number, number, number];
interface Sel { kind: 'image' | 'text'; rect: Rect }
type Drag =
  | { mode: 'move'; pid: number; sx: number; sy: number; dx: number; dy: number; ghost: string | null }
  | { mode: 'resize'; pid: number; corner: number; to: Rect }
  | { mode: 'marquee'; pid: number; a: [number, number]; b: [number, number] };

const inside = (r: Rect, x: number, y: number, pad = 0) => x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad;
const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const overlap = (a: Rect, b: Rect) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const union = (rs: Rect[]): Rect => [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];

export const MoveLayer = memo(function MoveLayer({ client, index, info, zoom, rev, onMove }: {
  client: PdfClient; index: number; info: PageInfo; zoom: number; rev: number;
  /** 옮기기를 해 보고, 되면 true */
  onMove: (req: MoveRequest) => Promise<boolean>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Rect[]>([]);
  const [images, setImages] = useState<Rect[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [hover, setHover] = useState<Sel | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(-1);

  const load = () => {
    if (loaded.current === rev) return;
    loaded.current = rev;
    void client.lines(index).then((ls: TextLine[]) => setLines(ls.filter((l) => l.chars.some((c) => c.c.trim())).map((l) => l.bbox))).catch(() => setLines([]));
    void client.movableImages(index).then((im: MovableObject[]) => setImages(im.map((x) => x.rect))).catch(() => setImages([]));
  };
  useEffect(() => { loaded.current = -1; setHover(null); }, [rev]);

  const pt = (e: React.PointerEvent): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };
  /** 누른 자리의 글자 줄, 없으면 가장 작은 그림 */
  const pick = (x: number, y: number): Sel | null => {
    const line = lines.filter((r) => inside(r, x, y, 2)).sort((a, b) => area(a) - area(b))[0];
    if (line) return { kind: 'text', rect: line };
    const img = images.filter((r) => inside(r, x, y)).sort((a, b) => area(a) - area(b))[0];
    return img ? { kind: 'image', rect: img } : null;
  };

  /** 끄는 동안 보여 줄 고른 부분의 그림 (쪽 그림에서 잘라 온다) */
  const ghostOf = (r: Rect) => {
    const canvas = el.current?.parentElement?.querySelector('canvas');
    if (!canvas) return null;
    const k = canvas.width / (info.width * zoom);
    const c = document.createElement('canvas');
    const w = Math.max(1, Math.round((r[2] - r[0]) * zoom * k)), h = Math.max(1, Math.round((r[3] - r[1]) * zoom * k));
    c.width = w; c.height = h;
    try { c.getContext('2d')!.drawImage(canvas, r[0] * zoom * k, r[1] * zoom * k, w, h, 0, 0, w, h); return c.toDataURL(); } catch { return null; }
  };

  const run = async (from: Sel, to: Rect) => {
    if (Math.abs(to[0] - from.rect[0]) < 0.5 && Math.abs(to[1] - from.rect[1]) < 0.5 && Math.abs(to[2] - from.rect[2]) < 0.5 && Math.abs(to[3] - from.rect[3]) < 0.5) return;
    setBusy(true);
    const ok = await onMove({ page: index, kind: from.kind, rect: from.rect, to });
    setBusy(false);
    setSel(ok ? { kind: from.kind, rect: to } : from);
  };

  // 화살표 키로 조금씩 옮기기
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (busy || t.closest('input, textarea, [contenteditable]')) return;
      const step = e.shiftKey ? 10 : 1;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (e.key === 'Escape') { setSel(null); return; }
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      void run(sel, [sel.rect[0] + v[0], sel.rect[1] + v[1], sel.rect[2] + v[0], sel.rect[3] + v[1]]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = drag?.mode === 'move' && sel
    ? [sel.rect[0] + drag.dx, sel.rect[1] + drag.dy, sel.rect[2] + drag.dx, sel.rect[3] + drag.dy] as Rect
    : drag?.mode === 'resize' ? drag.to : sel?.rect ?? null;
  const box = (r: Rect) => ({ left: r[0] * zoom - 2, top: r[1] * zoom - 2, width: (r[2] - r[0]) * zoom + 4, height: (r[3] - r[1]) * zoom + 4 });

  return (
    <div
      ref={el}
      className={`movelayer${busy ? ' busy' : ''}`}
      style={{ width: info.width * zoom, height: info.height * zoom }}
      onPointerEnter={load}
      onPointerMove={(e) => {
        const [x, y] = pt(e);
        if (drag && drag.pid === e.pointerId) {
          if (drag.mode === 'move') setDrag({ ...drag, dx: x - drag.sx, dy: y - drag.sy });
          else if (drag.mode === 'marquee') setDrag({ ...drag, b: [x, y] });
          else if (sel) {
            // 그림 크기: 반대쪽 모서리를 고정하고 가로세로 비율을 지킨다
            const r = sel.rect, w = r[2] - r[0], h = r[3] - r[1];
            const fx = drag.corner % 2 ? r[0] : r[2], fy = drag.corner < 2 ? r[3] : r[1];
            const s = Math.max(0.1, Math.max(Math.abs(x - fx) / w, Math.abs(y - fy) / h));
            const nx = drag.corner % 2 ? fx + w * s : fx - w * s, ny = drag.corner < 2 ? fy - h * s : fy + h * s;
            setDrag({ ...drag, to: [Math.min(fx, nx), Math.min(fy, ny), Math.max(fx, nx), Math.max(fy, ny)] });
          }
          return;
        }
        if (!e.buttons) setHover(pick(x, y));
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        if (e.button !== 0 || busy) return;
        load();
        e.preventDefault();
        el.current!.setPointerCapture(e.pointerId);
        const [x, y] = pt(e);
        const handle = (e.target as HTMLElement).dataset.corner;
        if (handle && sel) { setDrag({ mode: 'resize', pid: e.pointerId, corner: +handle, to: sel.rect }); return; }
        if (sel && inside(sel.rect, x, y, 2)) { setDrag({ mode: 'move', pid: e.pointerId, sx: x, sy: y, dx: 0, dy: 0, ghost: ghostOf(sel.rect) }); return; }
        const p = pick(x, y);
        if (p) { setSel(p); setDrag({ mode: 'move', pid: e.pointerId, sx: x, sy: y, dx: 0, dy: 0, ghost: ghostOf(p.rect) }); return; }
        setSel(null);
        setDrag({ mode: 'marquee', pid: e.pointerId, a: [x, y], b: [x, y] });
      }}
      onPointerUp={(e) => {
        if (!drag || drag.pid !== e.pointerId) return;
        const d = drag;
        setDrag(null);
        if (d.mode === 'marquee') {
          const m: Rect = [Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.max(d.a[0], d.b[0]), Math.max(d.a[1], d.b[1])];
          const got = lines.filter((r) => overlap(r, m) > area(r) * 0.6);
          if (got.length) setSel({ kind: 'text', rect: union(got) });
          return;
        }
        if (!sel) return;
        if (d.mode === 'move') void run(sel, [sel.rect[0] + d.dx, sel.rect[1] + d.dy, sel.rect[2] + d.dx, sel.rect[3] + d.dy]);
        else void run(sel, d.to);
      }}
    >
      {hover && !drag && !(sel && hover.rect.every((v, i) => v === sel.rect[i])) && <div className="mvhover" style={box(hover.rect)} />}
      {drag?.mode === 'move' && sel && <div className="mvhole" style={box(sel.rect)} />}
      {shown && sel && (
        <div className={`mvsel${sel.kind === 'image' ? ' img' : ''}`} style={box(shown)}>
          {drag?.mode === 'move' && drag.ghost && <img src={drag.ghost} alt="" draggable={false} />}
          {sel.kind === 'image' && !drag && [0, 1, 2, 3].map((c) => <span key={c} className={`mvh c${c}`} data-corner={c} />)}
        </div>
      )}
      {drag?.mode === 'marquee' && (
        <div className="mvmarq" style={{ left: Math.min(drag.a[0], drag.b[0]) * zoom, top: Math.min(drag.a[1], drag.b[1]) * zoom, width: Math.abs(drag.b[0] - drag.a[0]) * zoom, height: Math.abs(drag.b[1] - drag.a[1]) * zoom }} />
      )}
    </div>
  );
});
