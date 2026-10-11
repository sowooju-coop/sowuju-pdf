import type { SortState } from '../lib/useSortable';

/** 끄는 동안 마우스를 따라다니는 작은 표시와, 놓일 자리 선 */
export function SortOverlay({ state }: { state: SortState | null }) {
  if (!state) return null;
  return (
    <>
      {state.line && <div className="sortline" style={{ left: state.line.left, top: state.line.top, width: state.line.width, height: state.line.height }} />}
      <div className="sortghost" style={{ left: state.x + 14, top: state.y + 10 }} aria-hidden="true">
        <span className="sg-pages"><i /><i /></span>
        {state.moving.length === 1 ? `${state.moving[0] + 1}쪽 옮기는 중` : `${state.moving.length}쪽 옮기는 중`}
      </div>
    </>
  );
}
