import { useRef } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { PageInfo } from '../lib/protocol';
import { reorderFor, useSortable } from '../lib/useSortable';
import { PageCanvas } from './PageCanvas';
import { SortOverlay } from './SortGhost';
import { Icon } from './Icon';

interface Props {
  client: PdfClient;
  pages: PageInfo[];
  rev: number;
  cur: number;
  sel: Set<number>;
  size: number;
  onThumb: (i: number, e: React.MouseEvent) => void;
  onOpenPage: (i: number) => void;
  onReorder: (order: number[]) => void;
  onInsertBlank: (at: number) => void;
  onContext: (i: number, x: number, y: number) => void;
}

/** 한눈에 보기: 모든 쪽을 바둑판으로 펼쳐 놓고 끌어서 순서를 바꾼다 */
export function PageGrid({ client, pages, rev, cur, sel, size, onThumb, onOpenPage, onReorder, onInsertBlank, onContext }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const sort = useSortable({
    container: box, count: pages.length, selected: sel, layout: 'grid',
    onDrop: (moving, slot) => { const order = reorderFor(pages.length, moving, slot); if (order) onReorder(order); },
  });
  const moving = sort.state?.moving;

  return (
    <div className="pagegrid" ref={box} onClick={(e) => { if (e.target === e.currentTarget) onThumb(-1, e); }}>
      <div className="gridinner" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size + 28}px, 1fr))` }} onClick={(e) => { if (e.target === e.currentTarget) onThumb(-1, e); }}>
        {pages.map((p, i) => {
          const z = Math.min(size / p.width, (size * 1.42) / p.height);
          return (
            <button
              key={i}
              data-sort-index={i}
              className={`gcell${sel.has(i) ? ' sel' : ''}${cur === i ? ' cur' : ''}${moving?.includes(i) ? ' dragging' : ''}`}
              style={{ minHeight: size * 1.42 + 40 }}
              onPointerDown={sort.start(i)}
              onClick={(e) => onThumb(i, e)}
              onDoubleClick={() => onOpenPage(i)}
              onContextMenu={(e) => { e.preventDefault(); onContext(i, e.clientX, e.clientY); }}
              aria-label={`${i + 1}쪽`}
              title="끌어서 순서 바꾸기 · 두 번 누르면 이 쪽 보기"
            >
              <span className="gpage" style={{ width: p.width * z, height: p.height * z }}>
                <PageCanvas client={client} index={i} info={p} zoom={z} rev={rev} root={box.current} className="tbox" />
              </span>
              <span className="gnum">{i + 1}</span>
            </button>
          );
        })}
        <button className="gcell gadd" style={{ minHeight: size * 1.42 + 40 }} onClick={() => onInsertBlank(pages.length)}>
          <span className="gaddin"><Icon name="plus" size={22} />빈 쪽 넣기</span>
        </button>
      </div>
      <SortOverlay state={sort.state} />
    </div>
  );
}
