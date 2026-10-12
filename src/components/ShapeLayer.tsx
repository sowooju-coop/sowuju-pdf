import { useRef, useState } from 'react';
import type { PageInfo, ShapeKind } from '../lib/protocol';
import { shapeCmds, svgPath } from '../lib/shapeGeom';
import { Icon } from './Icon';

/** 적용하기 전의 펜·형광펜·도형·체크 (점 좌표는 pt, 화면 좌표) */
export interface Shape {
  id: string;
  page: number;
  kind: ShapeKind;
  points: [number, number][];
  color: string;
  width: number;
}

export const PEN_COLORS = [
  { id: '#C8102E', label: '빨강' },
  { id: '#1D4ED8', label: '파랑' },
  { id: '#111827', label: '검정' },
];
export const MARKER_COLORS = [
  { id: '#FFE45C', label: '노랑' },
  { id: '#B6F09C', label: '연두' },
  { id: '#FFB3D1', label: '분홍' },
];
export const PEN_WIDTHS = [
  { id: 1, label: '가늘게' },
  { id: 2, label: '보통' },
  { id: 3.5, label: '굵게' },
];

interface Props {
  index: number;
  info: PageInfo;
  zoom: number;
  shapes: Shape[];
  activeId: string | null;
  /** 그리는 중인 도구 (없으면 고르기만) */
  tool: { kind: ShapeKind; color: string; width: number } | null;
  onAdd: (s: Omit<Shape, 'id'>) => void;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Shape>) => void;
  onRemove: (id: string) => void;
  onApply: () => void;
}

const CHECK = 14; // 눌러서 넣는 체크 표시 크기 (pt)

export function ShapeLayer({ index, info, zoom, shapes, activeId, tool, onAdd, onSelect, onChange, onRemove, onApply }: Props) {
  const box = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const pid = useRef<number | null>(null);

  const pt = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(info.width, (e.clientX - r.left) / zoom)), Math.max(0, Math.min(info.height, (e.clientY - r.top) / zoom))];
  };

  const finish = () => {
    const ps = draft;
    setDraft(null);
    pid.current = null;
    if (!tool || !ps) return;
    const [a, b] = [ps[0], ps[ps.length - 1]];
    const small = Math.hypot(b[0] - a[0], b[1] - a[1]) < 3;
    if (tool.kind === 'check') {
      // 누르기만 하면 기본 크기, 끌면 그 크기로
      const pts: [number, number][] = small
        ? [[a[0] - CHECK / 2, a[1] - CHECK / 2], [a[0] + CHECK / 2, a[1] + CHECK / 2]]
        : [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]];
      onAdd({ page: index, kind: 'check', points: pts, color: tool.color, width: Math.max(1.2, (pts[1][0] - pts[0][0]) * 0.13) });
      return;
    }
    if (small) return;
    const pts: [number, number][] = tool.kind === 'pen' ? simplify(ps) : tool.kind === 'rect' || tool.kind === 'ellipse' || tool.kind === 'highlight'
      ? [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]]
      : [a, b];
    onAdd({ page: index, kind: tool.kind, points: pts, color: tool.color, width: tool.width });
  };

  const active = shapes.find((s) => s.id === activeId);
  const activeBox = active && bounds(active.points);

  return (
    <>
    {/* 곱하기 섞기: 형광펜 아래 글자가 비쳐 보이도록 층 전체를 곱하기로 겹친다 (PDF에 넣을 때와 같은 방식) */}
    <div className={`shapelayer${tool ? ' drawing' : ''}`} style={{ width: info.width * zoom, height: info.height * zoom }}>
      <svg
        ref={box}
        width={info.width * zoom}
        height={info.height * zoom}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (!tool) { if (e.target === e.currentTarget) onSelect(null); return; }
          e.preventDefault();
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          pid.current = e.pointerId;
          setDraft([pt(e)]);
        }}
        onPointerMove={(e) => {
          if (pid.current !== e.pointerId) return;
          const p = pt(e);
          setDraft((d) => (d ? (tool?.kind === 'pen' ? [...d, p] : [d[0], p]) : d));
        }}
        onPointerUp={(e) => { if (pid.current === e.pointerId) finish(); }}
      >
        {shapes.map((s) => (
          <ShapePath key={s.id} s={s} zoom={zoom} active={s.id === activeId} onPick={tool ? undefined : () => onSelect(s.id)} />
        ))}
        {draft && tool && (
          <ShapePath s={{ id: 'draft', page: index, kind: tool.kind, color: tool.color, width: tool.kind === 'check' ? 2 : tool.width, points: draftPoints(tool.kind, draft) }} zoom={zoom} active={false} />
        )}
      </svg>
    </div>
      {active && activeBox && !tool && (
        <div className="minibar shapebar" style={{ left: activeBox[0] * zoom, top: Math.max(4, activeBox[1] * zoom - 52) }} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}>
          {(active.kind === 'highlight' ? MARKER_COLORS : PEN_COLORS).map((c) => (
            <button key={c.id} className={`mb-color${active.color === c.id ? ' on' : ''}`} aria-label={c.label} title={c.label} onClick={() => onChange(active.id, { color: c.id })}><span style={{ background: c.id }} /></button>
          ))}
          <span className="mb-sep" aria-hidden="true" />
          <button className="mb-no" onClick={() => onRemove(active.id)}><Icon name="trash" size={15} />빼기</button>
          <button className="mb-ok" onClick={onApply}>적용</button>
        </div>
      )}
    </>
  );
}

function ShapePath({ s, zoom, active, onPick }: { s: Shape; zoom: number; active: boolean; onPick?: () => void }) {
  const d = svgPath(shapeCmds(s.kind, s.points, s.width), zoom);
  const hi = s.kind === 'highlight';
  return (
    <g className={`shp${active ? ' on' : ''}${onPick ? ' pickable' : ''}`} onPointerDown={onPick ? (e) => { e.stopPropagation(); onPick(); } : undefined}>
      {onPick && <path d={d} className="hit" strokeWidth={Math.max(10, s.width * zoom + 8)} />}
      <path
        d={d}
        fill={hi ? s.color : 'none'}
        stroke={hi ? 'none' : s.color}
        strokeWidth={s.width * zoom}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {active && <path d={d} className="sel" />}
    </g>
  );
}

function draftPoints(kind: ShapeKind, ps: [number, number][]): [number, number][] {
  if (kind === 'pen' || ps.length < 2) return ps.length < 2 ? [ps[0], ps[0]] : ps;
  const [a, b] = [ps[0], ps[ps.length - 1]];
  if (kind === 'line' || kind === 'arrow') return [a, b];
  return [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]];
}

function bounds(ps: [number, number][]) {
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** 펜 자국에서 너무 촘촘한 점을 덜어낸다 (0.6pt 안쪽 점은 버림) */
function simplify(ps: [number, number][]) {
  const out = [ps[0]];
  for (const p of ps.slice(1)) {
    const q = out[out.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.6) out.push(p);
  }
  if (out.length === 1) out.push(ps[ps.length - 1]);
  return out;
}
