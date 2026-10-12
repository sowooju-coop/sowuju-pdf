import { memo, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import type { PageInfo } from '../lib/protocol';

export interface FindHit { page: number; rect: [number, number, number, number]; text: string }
export interface FindState { q: string; hits: FindHit[]; idx: number; busy: boolean; open: boolean }

/** 화면 오른쪽 위 찾기 창 */
export function FindBar({ state, onQuery, onMove, onClose }: {
  state: FindState;
  onQuery: (q: string) => void;
  onMove: (d: 1 | -1) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [state.open]);
  const n = state.hits.length;
  const count = !state.q.trim() ? '' : state.busy ? '찾는 중…' : n ? `${state.idx + 1} / ${n >= 3000 ? '3000+' : n}` : '없어요';
  return (
    <div className="findbar" role="search">
      <Icon name="search" size={16} />
      <input
        ref={input}
        value={state.q}
        placeholder="문서에서 찾기"
        aria-label="문서에서 찾을 글자"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') { e.preventDefault(); onMove(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
      />
      <span className={`fcount${n === 0 && state.q.trim() && !state.busy ? ' none' : ''}`} aria-live="polite">{count}</span>
      <button className="iconbtn" aria-label="앞에서 찾기" title="앞에서 찾기 (Shift+Enter)" disabled={!n} onClick={() => onMove(-1)}><Icon name="up" size={16} /></button>
      <button className="iconbtn" aria-label="다음 찾기" title="다음 찾기 (Enter)" disabled={!n} onClick={() => onMove(1)}><Icon name="down" size={16} /></button>
      <button className="iconbtn" aria-label="찾기 닫기" title="닫기 (Esc)" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
  );
}

/** 쪽 위에 찾은 자리를 노랗게(지금 것은 주황) 표시 */
export const FindLayer = memo(function FindLayer({ info, zoom, hits, current }: {
  info: PageInfo; zoom: number; hits: FindHit[]; current: FindHit | null;
}) {
  return (
    <div className="findlayer" style={{ width: info.width * zoom, height: info.height * zoom }} aria-hidden="true">
      {hits.map((h, k) => {
        const [x0, y0, x1, y1] = h.rect;
        return <span key={k} className={`fhit${h === current ? ' cur' : ''}`} style={{ left: x0 * zoom - 1, top: y0 * zoom - 1, width: (x1 - x0) * zoom + 2, height: (y1 - y0) * zoom + 2 }} />;
      })}
    </div>
  );
});
