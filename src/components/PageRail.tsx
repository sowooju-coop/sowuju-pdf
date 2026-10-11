import { useEffect, useRef, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { PageInfo } from '../lib/protocol';
import { fileKind, readDropped, type OpenedFile } from '../lib/host';
import { PageCanvas } from './PageCanvas';
import { Icon } from './Icon';

interface Props {
  client: PdfClient;
  pages: PageInfo[];
  rev: number;
  cur: number;
  sel: Set<number>;
  onThumb: (i: number, e: React.MouseEvent) => void;
  /** 고른 쪽들(없으면 i 한 쪽)을 대상으로 */
  targetsFor: (i: number) => number[];
  onReorder: (order: number[]) => void;
  onInsertBlank: (at: number) => void;
  onPickFiles: (at: number) => void;
  onInsertFiles: (at: number, files: OpenedFile[]) => void;
  onDuplicate: (idx: number[]) => void;
  onRotate: (idx: number[], delta: number) => void;
  onExtract: (idx: number[]) => void;
  onDelete: (idx: number[]) => void;
}

interface Menu { x: number; y: number; i: number }

const thumbZoom = (p: PageInfo) => Math.min(96 / p.width, 136 / p.height);

/** 왼쪽 쪽 목록: 끌어서 순서 바꾸기, 오른쪽 클릭 메뉴, 쪽 사이 + 단추, 파일 끌어다 넣기 */
export function PageRail(props: Props) {
  const { client, pages, rev, cur, sel, onThumb, targetsFor } = props;
  const [drag, setDrag] = useState<number[] | null>(null);
  /** 끼워 넣을 자리: 0이면 맨 앞, n이면 n번째 쪽 뒤 */
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const rail = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); window.removeEventListener('resize', close); };
  }, [menu]);

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
    const files = [...e.dataTransfer.types].includes('Files');
    if (!drag && !files) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = files ? 'copy' : 'move';
    setFileOver(files);
    setDropAt(slotAt(e));
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const at = dropAt ?? pages.length;
    setDropAt(null);
    setFileOver(false);
    if (drag) {
      const moving = drag;
      setDrag(null);
      const rest = pages.map((_, i) => i).filter((i) => !moving.includes(i));
      const before = moving.filter((i) => i < at).length;
      rest.splice(at - before, 0, ...moving);
      if (rest.some((v, i) => v !== i)) props.onReorder(rest);
      return;
    }
    const files = [...e.dataTransfer.files].filter((f) => fileKind(f));
    if (files.length) props.onInsertFiles(at, await Promise.all(files.map(readDropped)));
  };

  const item = (icon: string, label: string, run: () => void, danger = false) => (
    <button role="menuitem" className={danger ? 'danger' : ''} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setMenu(null); run(); }}>
      <Icon name={icon} size={16} />{label}
    </button>
  );

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
            className={`thumb${sel.has(i) ? ' sel' : ''}${cur === i ? ' cur' : ''}${drag?.includes(i) ? ' dragging' : ''}`}
            draggable
            onDragStart={(e) => {
              const t = sel.has(i) ? [...sel].sort((a, b) => a - b) : [i];
              setDrag(t);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', t.join(','));
            }}
            onDragEnd={() => { setDrag(null); setDropAt(null); }}
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

      {menu && (() => {
        const t = targetsFor(menu.i);
        const many = t.length > 1 ? `${t.length}쪽 ` : '';
        return (
          <div role="menu" className="ctxmenu" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 330) }} onPointerDown={(e) => e.stopPropagation()}>
            {item('plus', '뒤에 빈 쪽 넣기', () => props.onInsertBlank(menu.i + 1))}
            {item('merge', '뒤에 파일에서 쪽 넣기…', () => props.onPickFiles(menu.i + 1))}
            {item('pages', `${many}복제`, () => props.onDuplicate(t))}
            <hr />
            {item('rotl', '왼쪽으로 돌리기', () => props.onRotate(t, -90))}
            {item('rotr', '오른쪽으로 돌리기', () => props.onRotate(t, 90))}
            <hr />
            {item('save', `${many}새 PDF로 저장…`, () => props.onExtract(t))}
            {item('trash', `${many}지우기`, () => props.onDelete(t), true)}
          </div>
        );
      })()}
    </aside>
  );
}
