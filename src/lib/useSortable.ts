import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 마우스·터치로 끌어서 순서를 바꾸는 기능 (쪽 목록과 한눈에 보기에서 함께 쓴다).
 * 항목 요소에는 data-sort-index 를 붙인다. 놓을 자리(slot)는 0 = 맨 앞, n = n번째 항목 앞, count = 맨 뒤.
 */
export interface SortState {
  moving: number[];
  slot: number;
  x: number;
  y: number;
  /** 놓일 자리 표시 (컨테이너 기준 좌표) */
  line: { left: number; top: number; width: number; height: number } | null;
}

interface Options {
  container: React.RefObject<HTMLElement>;
  count: number;
  selected: Set<number>;
  layout: 'list' | 'grid';
  onDrop: (moving: number[], slot: number) => void;
}

export function useSortable({ container, count, selected, layout, onDrop }: Options) {
  const [state, setState] = useState<SortState | null>(null);
  const live = useRef<SortState | null>(null);
  const pending = useRef<{ i: number; x: number; y: number; id: number } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const raf = useRef(0);
  const opts = useRef({ count, selected, layout, onDrop });
  opts.current = { count, selected, layout, onDrop };

  const items = () => [...(container.current?.querySelectorAll<HTMLElement>('[data-sort-index]') ?? [])];

  const compute = useCallback((x: number, y: number) => {
    const els = items();
    const box = container.current;
    if (!els.length || !box) return { slot: 0, line: null };
    const cb = box.getBoundingClientRect();
    const toLocal = (r: DOMRect) => ({ left: r.left - cb.left + box.scrollLeft, top: r.top - cb.top + box.scrollTop, right: r.right - cb.left + box.scrollLeft, bottom: r.bottom - cb.top + box.scrollTop });
    if (opts.current.layout === 'list') {
      let slot = els.length;
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) { slot = i; break; }
      }
      const ref = toLocal(els[Math.min(slot, els.length - 1)].getBoundingClientRect());
      const top = slot < els.length ? ref.top - 6 : ref.bottom + 4;
      return { slot, line: { left: ref.left + 6, top, width: ref.right - ref.left - 12, height: 3 } };
    }
    // 바둑판: 가장 가까운 칸을 찾아 그 칸의 왼쪽/오른쪽에 넣는다
    let best = 0, bd = Infinity;
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dy * 3 + dx;
      if (d < bd) { bd = d; best = i; }
    });
    const r = els[best].getBoundingClientRect();
    const slot = x < r.left + r.width / 2 ? best : best + 1;
    const l = toLocal(r);
    const left = slot === best ? l.left - 10 : l.right + 7;
    return { slot, line: { left, top: l.top, width: 3, height: l.bottom - l.top } };
  }, [container]);

  const update = useCallback(() => {
    const s = live.current;
    if (!s) return;
    const { x, y } = pointer.current;
    const c = compute(x, y);
    live.current = { ...s, x, y, slot: c.slot, line: c.line };
    setState(live.current);
  }, [compute]);

  // 가장자리 가까이 가면 저절로 넘어가기
  const autoscroll = useCallback(() => {
    const box = container.current;
    if (box && live.current) {
      const r = box.getBoundingClientRect();
      const { y } = pointer.current;
      const edge = 56;
      let dy = 0;
      if (y < r.top + edge) dy = -Math.ceil((r.top + edge - y) / 4);
      else if (y > r.bottom - edge) dy = Math.ceil((y - (r.bottom - edge)) / 4);
      if (dy) { box.scrollTop += dy; update(); }
    }
    raf.current = requestAnimationFrame(autoscroll);
  }, [container, update]);

  const end = useCallback((drop: boolean) => {
    cancelAnimationFrame(raf.current);
    const s = live.current;
    live.current = null;
    pending.current = null;
    setState(null);
    document.body.classList.remove('sorting');
    if (drop && s) {
      // 끌기가 끝난 직후의 클릭이 쪽 선택으로 이어지지 않게 한 번 막는다
      const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
      opts.current.onDrop(s.moving, s.slot);
    }
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const p = pending.current;
      if (live.current) { update(); return; }
      if (!p || p.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      const sel = opts.current.selected;
      const moving = sel.has(p.i) ? [...sel].sort((a, b) => a - b) : [p.i];
      live.current = { moving, slot: p.i, x: e.clientX, y: e.clientY, line: null };
      document.body.classList.add('sorting');
      update();
      raf.current = requestAnimationFrame(autoscroll);
    };
    const up = (e: PointerEvent) => {
      if (live.current) end(true);
      else if (pending.current?.id === e.pointerId) pending.current = null;
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && live.current) { e.preventDefault(); end(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    const cancel = () => { if (live.current) end(false); pending.current = null; };
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      cancelAnimationFrame(raf.current);
    };
  }, [update, autoscroll, end]);

  const start = useCallback((i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    pending.current = { i, x: e.clientX, y: e.clientY, id: e.pointerId };
  }, []);

  return { state, start };
}

/** 끌기가 끝났을 때 새 쪽 순서 */
export function reorderFor(count: number, moving: number[], slot: number): number[] | null {
  const rest = Array.from({ length: count }, (_, i) => i).filter((i) => !moving.includes(i));
  const before = moving.filter((i) => i < slot).length;
  rest.splice(slot - before, 0, ...moving);
  return rest.some((v, i) => v !== i) ? rest : null;
}
