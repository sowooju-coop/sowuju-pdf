import { useRef, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { PageInfo } from '../lib/protocol';
import { fileKind, readDropped, type OpenedFile } from '../lib/host';
import { PageCanvas } from './PageCanvas';
import { reorderFor, useSortable } from '../lib/useSortable';
import { SortOverlay } from './SortGhost';
import { PageMenu, type PageActions, type PageMenuState } from './PageMenu';
import { Icon } from './Icon';

interface Props extends PageActions {
  client: PdfClient;
  pages: PageInfo[];
  rev: number;
  cur: number;
  sel: Set<number>;
  onThumb: (i: number, e: React.MouseEvent) => void;
  onReorder: (order: number[]) => void;
  onInsertFiles: (at: number, files: OpenedFile[]) => void;
}


const thumbZoom = (p: PageInfo) => Math.min(96 / p.width, 136 / p.height);

/** 왼쪽 쪽 목록: 끌어서 순서 바꾸기, 오른쪽 클릭 메뉴, 쪽 사이 + 단추, 파일 끌어다 넣기 */
export function PageRail(props: Props) {
  const { client, pages, rev, cur, sel, onThumb, targetsFor } = props;
  /** 파일을 끌어다 넣을 자리: 0이면 맨 앞, n이면 n번째 쪽 뒤 */
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const [menu, setMenu] = useState<PageMenuState | null>(null);
  const rail = useRef<HTMLElement>(null);
  const sort = useSortable({
    container: rail, count: pages.length, selected: sel, layout: 'list',
    onDrop: (moving, slot) => { const order = reorderFor(pages.length, moving, slot); if (order) props.onReorder(order); },
  });
  const dragging = sort.state?.moving;

  /** 마우스 위치로 끼워 넣을 자리 계산 */
  const slotAt = (e: React.DragEvent) => {
    const thumbs = [...(rail.current?.querySelectorAll<HTMLElement>('.thumb') ?? [])];
    for (let i = 0; i < thumbs.length; i++) {
      const r = thumbs[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return thumbs.length;
  };

  const onDragOver = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setFileOver(true);
    setDropAt(slotAt(e));
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const at = dropAt ?? pages.length;
    setDropAt(null);
    setFileOver(false);
    const files = [...e.dataTransfer.files].filter((f) => fileKind(f));
    if (files.length) props.onInsertFiles(at, await Promise.all(files.map(readDropped)));
  };

  return (
    <aside
      ref={rail}
      className={`rail${fileOver ? ' fileover' : ''}`}
      aria-label="페이지 목록"
      onClick={(e) => { if (e.target === e.currentTarget) onThumb(-1, e); }}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!rail.current?.contains(e.relatedTarget as Node)) { setDropAt(null); setFileOver(false); } }}
      onDrop={onDrop}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && pages.length) { e.preventDefault(); props.onDelete(targetsFor(cur)); }
      }}
    >
      {pages.map((p, i) => (
        <div key={i} className="slotwrap">
          <button
            className={`gap${dropAt === i ? ' drop' : ''}`}
            aria-label={i === 0 ? '맨 앞에 빈 쪽 넣기' : `${i}쪽 뒤에 빈 쪽 넣기`}
            title="빈 쪽 넣기"
            onClick={() => props.onInsertBlank(i)}
          ><span><Icon name="plus" size={12} /></span></button>
          <button
            className={`thumb${sel.has(i) ? ' sel' : ''}${cur === i ? ' cur' : ''}${dragging?.includes(i) ? ' dragging' : ''}`}
            data-sort-index={i}
            draggable={false}
            onPointerDown={sort.start(i)}
            title="끌어서 순서를 바꿀 수 있어요"
            onClick={(e) => onThumb(i, e)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, i }); }}
            aria-label={`${i + 1}쪽`}
            aria-current={cur === i ? 'page' : undefined}
          >
            <PageCanvas client={client} index={i} info={p} zoom={thumbZoom(p)} rev={rev} root={null} className="tbox" />
            <span className="num">{i + 1}</span>
          </button>
        </div>
      ))}
      <button
        className={`gap last${dropAt === pages.length ? ' drop' : ''}`}
        aria-label="맨 뒤에 빈 쪽 넣기"
        title="빈 쪽 넣기"
        onClick={() => props.onInsertBlank(pages.length)}
      ><span><Icon name="plus" size={12} /></span></button>
      <button className="railadd" onClick={() => props.onPickFiles(pages.length)}><Icon name="plus" size={16} />파일에서 쪽 넣기</button>

      <SortOverlay state={sort.state} />

      <PageMenu menu={menu} onClose={() => setMenu(null)} actions={props} />
    </aside>
  );
}
