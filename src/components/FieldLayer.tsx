import { useRef, useState } from 'react';
import { Icon } from './Icon';
import type { NewField, NewFieldType, PageInfo } from '../lib/protocol';

export type DraftField = NewField & { id: string };
type R = [number, number, number, number];

export const FIELD_TYPES: { id: NewFieldType; label: string }[] = [
  { id: 'text', label: '글자칸' },
  { id: 'multiline', label: '여러 줄' },
  { id: 'checkbox', label: '체크' },
  { id: 'combo', label: '고르기' },
];

/**
 * 입력칸 만들기 화면 (쪽마다): 빈 곳을 끌어 칸을 그리고, 칸을 눌러 이름·종류를 바꾸고, 끌어서 옮기거나 오른쪽 아래 모서리로 크기를 바꾼다
 */
export function FieldLayer({ index, info, zoom, drafts, activeId, tool, onAdd, onSelect, onChange, onRemove }: {
  index: number; info: PageInfo; zoom: number;
  drafts: DraftField[]; activeId: string | null; tool: NewFieldType;
  onAdd: (f: NewField) => void;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<NewField>) => void;
  onRemove: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ a: [number, number]; b: [number, number]; pid: number } | null>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'size'; start: [number, number]; rect: R; pid: number } | null>(null);
  const pt = (e: React.PointerEvent): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(info.width, (e.clientX - r.left) / zoom)), Math.max(0, Math.min(info.height, (e.clientY - r.top) / zoom))];
  };
  const norm = (a: [number, number], b: [number, number]): R => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const box = (r: R) => ({ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom });
  const active = drafts.find((d) => d.id === activeId);

  return (
    <div
      ref={el}
      className="fieldlayer"
      style={{ width: info.width * zoom, height: info.height * zoom }}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.target !== e.currentTarget) return;
        e.preventDefault();
        el.current!.setPointerCapture(e.pointerId);
        onSelect(null);
        const p = pt(e);
        setDraft({ a: p, b: p, pid: e.pointerId });
      }}
      onPointerMove={(e) => {
        if (draft?.pid === e.pointerId) { setDraft({ ...draft, b: pt(e) }); return; }
        const d = drag.current;
        if (!d || d.pid !== e.pointerId) return;
        const [x, y] = pt(e), dx = x - d.start[0], dy = y - d.start[1];
        const r = d.rect;
        if (d.mode === 'move') onChange(d.id, { rect: [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy] });
        else onChange(d.id, { rect: [r[0], r[1], Math.max(r[0] + 8, r[2] + dx), Math.max(r[1] + 8, r[3] + dy)] });
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (draft?.pid !== e.pointerId) return;
        let r = norm(draft.a, draft.b);
        setDraft(null);
        // 그냥 누르기만 했으면 알맞은 크기로 (체크는 작은 네모)
        if (r[2] - r[0] < 6 && r[3] - r[1] < 6) {
          const [x, y] = draft.a;
          r = tool === 'checkbox' ? [x - 6, y - 6, x + 6, y + 6] : tool === 'multiline' ? [x, y - 10, x + 200, y + 40] : [x, y - 10, x + 150, y + 10];
        }
        onAdd({ page: index, rect: r, type: tool, name: '', options: tool === 'combo' ? ['예', '아니요'] : undefined });
      }}
    >
      {drafts.map((d) => (
        <div
          key={d.id}
          className={`fdraft ${d.type}${d.id === activeId ? ' on' : ''}`}
          style={box(d.rect)}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onSelect(d.id);
            const target = e.target as HTMLElement;
            if (target.closest('.fpop')) return;
            el.current!.setPointerCapture(e.pointerId);
            drag.current = { id: d.id, mode: target.classList.contains('fsize') ? 'size' : 'move', start: pt(e), rect: [...d.rect] as R, pid: e.pointerId };
          }}
        >
          <span className="fname">{d.name || FIELD_TYPES.find((t) => t.id === d.type)?.label}</span>
          {d.type !== 'checkbox' && <span className="fsize" aria-hidden="true" />}
        </div>
      ))}
      {draft && <div className="fdraft drawing" style={box(norm(draft.a, draft.b))} />}
      {active && (
        <div className="fpop" style={{ left: Math.min(active.rect[0] * zoom, info.width * zoom - 290), top: active.rect[3] * zoom + 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <input value={active.name} placeholder="칸 이름 (예: 성명)" aria-label="칸 이름" autoFocus
            onChange={(e) => onChange(active.id, { name: e.target.value })}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSelect(null); }} />
          <div className="seg" role="group" aria-label="칸 종류">
            {FIELD_TYPES.map((t) => <button key={t.id} type="button" className={active.type === t.id ? 'on' : ''} onClick={() => onChange(active.id, { type: t.id, options: t.id === 'combo' ? active.options ?? ['예', '아니요'] : active.options })}>{t.label}</button>)}
          </div>
          {active.type === 'combo' && (
            <input defaultValue={(active.options ?? []).join(', ')} placeholder="고를 것 (쉼표로 나눠 쓰기)" aria-label="고를 것"
              onChange={(e) => onChange(active.id, { options: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) })}
              onKeyDown={(e) => e.stopPropagation()} />
          )}
          <button type="button" className="fdel" onClick={() => onRemove(active.id)} aria-label="이 칸 지우기"><Icon name="trash" size={15} />지우기</button>
        </div>
      )}
    </div>
  );
}
