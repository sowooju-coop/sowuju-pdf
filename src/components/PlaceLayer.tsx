import { useRef, useState } from 'react';
import type { PageInfo } from '../lib/protocol';
import type { Mark } from '../lib/library';
import { Icon } from './Icon';

export interface Placed {
  id: string;
  page: number;
  kind: Mark['kind'];
  src: string;
  /** 화면 좌표(pt, 위가 0) */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  index: number;
  info: PageInfo;
  zoom: number;
  items: Placed[];
  activeId: string | null;
  placing: Mark | null;
  onPlace: (page: number, cx: number, cy: number) => void;
  onChange: (id: string, patch: Partial<Placed>) => void;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onApply: () => void;
  onAgain: (id: string) => void;
}

const MIN = 12;

/** 서명·직인을 놓고 옮기고 크기를 바꾸는 층. 적용하기 전까지는 PDF에 쓰지 않는다 */
export function PlaceLayer({ index, info, zoom, items, activeId, placing, onPlace, onChange, onSelect, onRemove, onApply, onAgain }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; kind: 'move' | 'size'; sx: number; sy: number; o: Placed; pid: number } | null>(null);

  const pt = (e: React.PointerEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const begin = (it: Placed, kind: 'move' | 'size') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(it.id);
    layer.current!.setPointerCapture(e.pointerId);
    const p = pt(e);
    drag.current = { id: it.id, kind, sx: p.x, sy: p.y, o: it, pid: e.pointerId };
  };

  const onMove = (e: React.PointerEvent) => {
    const p = pt(e);
    if (placing) setHover(p);
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    const dx = p.x - d.sx, dy = p.y - d.sy;
    if (d.kind === 'move') {
      onChange(d.id, { x: Math.max(-d.o.w / 2, Math.min(info.width - d.o.w / 2, d.o.x + dx)), y: Math.max(-d.o.h / 2, Math.min(info.height - d.o.h / 2, d.o.y + dy)) });
    } else {
      // 모서리를 끌면 가로세로 비율을 지키며 키우고 줄인다
      const ratio = d.o.h / d.o.w;
      const w = Math.max(MIN, Math.min(info.width, d.o.w + Math.max(dx, dy / ratio)));
      onChange(d.id, { w, h: w * ratio });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (drag.current?.pid === e.pointerId) { drag.current = null; return; }
  };

  const active = items.find((i) => i.id === activeId);

  return (
    <div
      ref={layer}
      className={`placelayer${placing ? ' placing' : ''}`}
      style={{ width: info.width * zoom, height: info.height * zoom }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (placing) { const p = pt(e); onPlace(index, p.x, p.y); setHover(null); }
        else onSelect(null);
      }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          className={`placed${it.id === activeId ? ' on' : ''}`}
          style={{ left: it.x * zoom, top: it.y * zoom, width: it.w * zoom, height: it.h * zoom }}
          onPointerDown={begin(it, 'move')}
          role="img"
          aria-label={it.kind === 'sign' ? '넣은 서명' : '넣은 직인'}
        >
          <img src={it.src} alt="" draggable={false} />
          {it.id === activeId && <span className="handle" onPointerDown={begin(it, 'size')} aria-label="크기 바꾸기" />}
        </div>
      ))}
      {placing && hover && (
        <img className="placeghost" src={placing.src} alt="" style={{ left: (hover.x - placing.w / 2) * zoom, top: (hover.y - placing.h / 2) * zoom, width: placing.w * zoom, height: placing.h * zoom }} />
      )}
      {active && !placing && (
        <div
          className="minibar"
          style={{ left: active.x * zoom, top: Math.max(4, active.y * zoom - 52) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className="mb-no" onClick={() => onAgain(active.id)}><Icon name="plus" size={15} />하나 더</button>
          <button className="mb-no" onClick={() => onRemove(active.id)}><Icon name="trash" size={15} />빼기</button>
          <span className="mb-sep" aria-hidden="true" />
          <button className="mb-ok" onClick={onApply}>적용<small>Enter</small></button>
        </div>
      )}
    </div>
  );
}
