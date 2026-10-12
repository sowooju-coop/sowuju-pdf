import { useEffect, useRef, useState } from 'react';
import type { PageInfo } from '../lib/protocol';
import { FONTS, LINE_HEIGHT, type FontFamily } from '../lib/fonts';
import { Icon } from './Icon';

/** 빈 곳에 새로 쓰는 글자 상자 (적용하기 전까지는 화면에만 있다) */
export interface TextBox {
  id: string;
  page: number;
  /** 상자 왼쪽 위 (pt, 화면 좌표) */
  x: number;
  y: number;
  text: string;
  size: number;
  family: FontFamily;
  bold: boolean;
  color: string;
  /** 메모: 노란 쪽지 바탕 위에 쓴 글자 (인쇄에도 나온다) */
  note?: boolean;
}

/** 메모 쪽지의 안쪽 여백 (pt) */
export const NOTE_PAD = { x: 6, y: 4 };
export const NOTE_COLOR = '#FFF1A6';

export const TEXT_COLORS = [
  { id: '#111827', label: '검정' },
  { id: '#1D4ED8', label: '파랑' },
  { id: '#C8102E', label: '빨강' },
];

interface Props {
  index: number;
  info: PageInfo;
  zoom: number;
  boxes: TextBox[];
  activeId: string | null;
  /** 글자 넣을 곳을 고르는 중 (text 가 있으면 그 글자를 바로 놓는다: 날짜 등) */
  adding: { text: string; note?: boolean } | null;
  onAdd: (page: number, x: number, y: number) => void;
  onChange: (id: string, patch: Partial<TextBox>) => void;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onApply: () => void;
}

export function TextLayer({ index, info, zoom, boxes, activeId, adding, onAdd, onChange, onSelect, onRemove, onApply }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; pid: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const pt = (e: React.PointerEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const startMove = (b: TextBox) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(b.id);
    layer.current!.setPointerCapture(e.pointerId);
    const p = pt(e);
    drag.current = { id: b.id, sx: p.x, sy: p.y, ox: b.x, oy: b.y, pid: e.pointerId };
  };

  const active = boxes.find((b) => b.id === activeId);

  return (
    <div
      ref={layer}
      className={`textlayer${adding ? ' adding' : ''}`}
      style={{ width: info.width * zoom, height: info.height * zoom }}
      onPointerMove={(e) => {
        const p = pt(e);
        if (adding) setHover(p);
        const d = drag.current;
        if (!d || d.pid !== e.pointerId) return;
        onChange(d.id, { x: Math.max(0, Math.min(info.width - 8, d.ox + p.x - d.sx)), y: Math.max(0, Math.min(info.height - 8, d.oy + p.y - d.sy)) });
      }}
      onPointerUp={(e) => { if (drag.current?.pid === e.pointerId) drag.current = null; }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.target !== e.currentTarget) return;
        if (adding) { e.preventDefault(); const p = pt(e); onAdd(index, p.x, p.y); setHover(null); }
        else onSelect(null);
      }}
    >
      {boxes.map((b) => (
        <Box key={b.id} box={b} zoom={zoom} active={b.id === activeId} onFocus={() => onSelect(b.id)} onBlur={(to) => { if (!to?.closest('.textlayer')) onSelect(null); }} onText={(text) => onChange(b.id, { text })} onMove={startMove(b)} />
      ))}
      {adding && hover && (
        <div className="textghost" style={{ left: hover.x * zoom, top: hover.y * zoom - 10 }}>
          {adding.text ? adding.text : <span className="caret" />}
        </div>
      )}
      {active && !adding && (
        <div
          className="minibar"
          style={{ left: active.x * zoom, top: Math.max(4, active.y * zoom - 52) }}
          onPointerDown={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}
        >
          {(Object.keys(FONTS) as FontFamily[]).map((f) => (
            <button key={f} className={`mb-b wide${active.family === f ? ' on' : ''}`} style={{ fontFamily: FONTS[f].css }} onClick={() => onChange(active.id, { family: f })}>{FONTS[f].label}</button>
          ))}
          <span className="mb-sep" aria-hidden="true" />
          <button className="mb-b" aria-label="글자 작게" onClick={() => onChange(active.id, { size: Math.max(6, active.size - 1) })}><Icon name="minus" size={14} /></button>
          <span className="mb-size" aria-label="글자 크기">{active.size}</span>
          <button className="mb-b" aria-label="글자 크게" onClick={() => onChange(active.id, { size: Math.min(72, active.size + 1) })}><Icon name="plus" size={14} /></button>
          <button className={`mb-b${active.bold ? ' on' : ''}`} aria-pressed={active.bold} aria-label="굵게" onClick={() => onChange(active.id, { bold: !active.bold })}>B</button>
          <span className="mb-sep" aria-hidden="true" />
          {TEXT_COLORS.map((c) => (
            <button key={c.id} className={`mb-color${active.color === c.id ? ' on' : ''}`} aria-label={c.label} title={c.label} onClick={() => onChange(active.id, { color: c.id })}><span style={{ background: c.id }} /></button>
          ))}
          <span className="mb-sep" aria-hidden="true" />
          <button className="mb-no" onClick={() => onRemove(active.id)}><Icon name="trash" size={15} />빼기</button>
          <button className="mb-ok" onClick={onApply}>적용</button>
        </div>
      )}
    </div>
  );
}

/** 글자 상자 하나. 입력 중 커서가 튀지 않도록 처음 한 번만 글자를 넣고 그 뒤로는 손대지 않는다 */
function Box({ box, zoom, active, onFocus, onBlur, onText, onMove }: { box: TextBox; zoom: number; active: boolean; onFocus: () => void; onBlur: (to: HTMLElement | null) => void; onText: (t: string) => void; onMove: (e: React.PointerEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.innerText = box.text;
    if (!box.text) {
      el.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`textbox${active ? ' on' : ''}${box.note ? ' note' : ''}`} style={{ left: box.x * zoom, top: box.y * zoom, ...(box.note ? { padding: `${NOTE_PAD.y * zoom}px ${NOTE_PAD.x * zoom}px`, background: NOTE_COLOR } : {}) }}>
      <span className="tgrip" onPointerDown={onMove} title="끌어서 옮기기" aria-label="끌어서 옮기기"><Icon name="move" size={12} /></span>
      <div
        ref={ref}
        className="tedit"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        aria-label={box.note ? '메모' : '새 글자'}
        style={{ fontFamily: FONTS[box.family].css, fontWeight: box.bold ? 700 : 400, fontSize: box.size * zoom, lineHeight: LINE_HEIGHT, color: box.color }}
        onFocus={onFocus}
        onBlur={(e) => onBlur(e.relatedTarget as HTMLElement | null)}
        onInput={(e) => onText((e.currentTarget as HTMLDivElement).innerText.replace(/\n$/, ''))}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
