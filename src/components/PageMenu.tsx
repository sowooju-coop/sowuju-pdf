import { useEffect } from 'react';
import { Icon } from './Icon';

export interface PageMenuState { x: number; y: number; i: number }

export interface PageActions {
  targetsFor: (i: number) => number[];
  onInsertBlank: (at: number) => void;
  onPickFiles: (at: number) => void;
  onDuplicate: (idx: number[]) => void;
  onRotate: (idx: number[], delta: number) => void;
  onExtract: (idx: number[]) => void;
  onDelete: (idx: number[]) => void;
}

/** 쪽 위에서 마우스 오른쪽 단추를 눌렀을 때 뜨는 메뉴 */
export function PageMenu({ menu, onClose, actions }: { menu: PageMenuState | null; onClose: () => void; actions: PageActions }) {
  useEffect(() => {
    if (!menu) return;
    window.addEventListener('pointerdown', onClose);
    window.addEventListener('keydown', onClose);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('pointerdown', onClose); window.removeEventListener('keydown', onClose); window.removeEventListener('resize', onClose); };
  }, [menu, onClose]);
  if (!menu) return null;
  const t = actions.targetsFor(menu.i);
  const many = t.length > 1 ? `${t.length}쪽 ` : '';
  const item = (icon: string, label: string, run: () => void, danger = false) => (
    <button role="menuitem" className={danger ? 'danger' : ''} onPointerDown={(e) => e.stopPropagation()} onClick={() => { onClose(); run(); }}>
      <Icon name={icon} size={16} />{label}
    </button>
  );
  return (
    <div role="menu" className="ctxmenu" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 330) }} onPointerDown={(e) => e.stopPropagation()}>
      {item('plus', '뒤에 빈 쪽 넣기', () => actions.onInsertBlank(menu.i + 1))}
      {item('merge', '뒤에 파일에서 쪽 넣기…', () => actions.onPickFiles(menu.i + 1))}
      {item('pages', `${many}복제`, () => actions.onDuplicate(t))}
      <hr />
      {item('rotl', '왼쪽으로 돌리기', () => actions.onRotate(t, -90))}
      {item('rotr', '오른쪽으로 돌리기', () => actions.onRotate(t, 90))}
      <hr />
      {item('save', `${many}새 PDF로 저장…`, () => actions.onExtract(t))}
      {item('trash', `${many}지우기`, () => actions.onDelete(t), true)}
    </div>
  );
}
