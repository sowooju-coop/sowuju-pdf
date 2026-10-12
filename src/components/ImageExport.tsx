import { useState } from 'react';
import { parseRanges } from '../lib/ranges';

export interface ImageExportOptions { pages: number[]; format: 'png' | 'jpg'; dpi: number }
type Which = 'current' | 'all' | 'selected' | 'custom';

/** 쪽을 그림(PNG·JPG)으로 내보내기 */
export function ImageExportDialog({ total, current, selected, onClose, onExport }: {
  total: number; current: number; selected: number[];
  onClose: () => void;
  onExport: (o: ImageExportOptions) => void;
}) {
  const [which, setWhich] = useState<Which>(selected.length ? 'selected' : 'current');
  const [format, setFormat] = useState<'png' | 'jpg'>('jpg');
  const [dpi, setDpi] = useState(150);
  const [text, setText] = useState('');
  const parsed = parseRanges(text, total);
  const pages = which === 'current' ? [current] : which === 'all' ? Array.from({ length: total }, (_, i) => i) : which === 'selected' ? selected : parsed.groups.flat();
  const bad = !pages.length || (which === 'custom' && !!parsed.error);
  const opt = <T extends string | number>(name: string, value: T, cur: T, set: (v: T) => void, title: string, sub: string, disabled = false) => (
    <label className={`opt${cur === value ? ' on' : ''}${disabled ? ' dis' : ''}`}>
      <input type="radio" name={name} checked={cur === value} onChange={() => set(value)} disabled={disabled} />
      <span><b>{title}</b><small>{sub}</small></span>
    </label>
  );
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg wide" onSubmit={(e) => { e.preventDefault(); if (!bad) onExport({ pages, format, dpi }); }}>
        <h3>그림으로 저장</h3>
        <p>쪽을 사진 파일로 저장해요. 카카오톡·문자로 보내거나 한글·PPT에 넣을 때 좋아요.</p>
        <fieldset>
          <legend>어느 쪽을</legend>
          <div className="opts">
            {opt('which', 'current', which, setWhich, '지금 보는 쪽', `${current + 1}쪽`)}
            {opt('which', 'all', which, setWhich, '전체', `${total}쪽`)}
            {opt('which', 'selected', which, setWhich, '고른 쪽', selected.length ? `${selected.length}쪽` : '목록에서 먼저 고르세요', !selected.length)}
            {opt('which', 'custom', which, setWhich, '직접 쓰기', '예) 1-3, 7')}
          </div>
          {which === 'custom' && (
            <div className="printrange">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="1-3, 7" aria-label="저장할 쪽" autoFocus />
              <small className={parsed.error && text.trim() ? 'bad' : ''}>{text.trim() ? (parsed.error ?? `${pages.length}쪽`) : '쉼표로 여러 곳을 쓸 수 있어요'}</small>
            </div>
          )}
        </fieldset>
        <fieldset>
          <legend>파일 종류</legend>
          <div className="opts">
            {opt('fmt', 'jpg', format, setFormat, 'JPG', '파일이 작아 보내기 좋아요')}
            {opt('fmt', 'png', format, setFormat, 'PNG', '글자가 더 또렷해요')}
          </div>
        </fieldset>
        <fieldset>
          <legend>선명도</legend>
          <div className="opts">
            {opt('idpi', 100, dpi, setDpi, '화면용', '휴대폰으로 볼 때')}
            {opt('idpi', 150, dpi, setDpi, '보통', '대부분 알맞아요')}
            {opt('idpi', 300, dpi, setDpi, '인쇄용', '크게 뽑을 때')}
          </div>
        </fieldset>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn navy" disabled={bad}>{pages.length > 1 ? `${pages.length}개 폴더에 저장` : '저장'}</button>
        </div>
      </form>
    </div>
  );
}
