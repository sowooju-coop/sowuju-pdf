import { useEffect, useRef, useState } from 'react';
import { parseRanges } from '../lib/ranges';

export interface OcrProgress { done: number; total: number; stopping: boolean }
type Which = 'textless' | 'current' | 'all' | 'custom';

/** 스캔 문서 글자 읽기(OCR) 창: 고르기 → 읽는 중(진행 막대, 그만두기) */
export function OcrDialog({ total, current, textless, progress, onClose, onRun, onStop }: {
  total: number; current: number;
  /** 글자가 없는 쪽 (아직 모르면 null) */
  textless: number[] | null;
  progress: OcrProgress | null;
  onClose: () => void;
  onRun: (pages: number[]) => void;
  onStop: () => void;
}) {
  const [which, setWhich] = useState<Which>(() => (textless && textless.length ? 'textless' : 'current'));
  const [text, setText] = useState('');
  // 글자 없는 쪽을 늦게 알게 되면, 아직 고르지 않았을 때 그쪽으로 고른다
  const touched = useRef(false);
  useEffect(() => { if (!touched.current && textless?.length) setWhich('textless'); }, [textless]);
  const parsed = parseRanges(text, total);
  const pages = which === 'textless' ? textless ?? [] : which === 'current' ? [current] : which === 'all' ? Array.from({ length: total }, (_, i) => i) : parsed.groups.flat();
  const bad = !pages.length || (which === 'custom' && !!parsed.error);
  const opt = (value: Which, title: string, sub: string, disabled = false) => (
    <label className={`opt${which === value ? ' on' : ''}${disabled ? ' dis' : ''}`}>
      <input type="radio" name="ocrw" checked={which === value} onChange={() => { touched.current = true; setWhich(value); }} disabled={disabled} />
      <span><b>{title}</b><small>{sub}</small></span>
    </label>
  );
  if (progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="modal">
        <div className="dlg">
          <h3>글자 읽는 중…</h3>
          <p>{progress.stopping ? '지금 쪽까지 읽고 멈춰요. 읽은 쪽은 그대로 넣어요.' : progress.done ? `${progress.total}쪽 중 ${progress.done}쪽을 읽었어요. 쪽이 많으면 시간이 걸려요.` : '글자 읽기를 준비하고 첫 쪽을 읽고 있어요…'}</p>
          <div className="ocrbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(3, pct)}%` }} /></div>
          <div className="acts">
            <button type="button" className="btn" onClick={onStop} disabled={progress.stopping}>그만두기</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg wide" onSubmit={(e) => { e.preventDefault(); if (!bad) onRun(pages); }}>
        <h3>글자 읽기 (스캔 문서)</h3>
        <p>스캔하거나 사진으로 찍은 쪽의 글자를 읽어서 문서에 넣어요. 보이는 모양은 그대로이고, 그다음부터 <b>찾기·복사·글자 고르기</b>가 돼요. 이 컴퓨터 안에서만 읽어요.</p>
        <fieldset>
          <legend>어느 쪽을 읽을까요</legend>
          <div className="opts">
            {opt('textless', '글자가 없는 쪽', textless === null ? '찾는 중…' : textless.length ? `${textless.length}쪽 (추천)` : '없어요', !textless?.length)}
            {opt('current', '지금 보는 쪽', `${current + 1}쪽`)}
            {opt('all', '전체', `${total}쪽`)}
            {opt('custom', '직접 쓰기', '예) 1-3, 7')}
          </div>
          {which === 'custom' && (
            <div className="printrange">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="1-3, 7" aria-label="읽을 쪽" autoFocus />
              <small className={parsed.error && text.trim() ? 'bad' : ''}>{text.trim() ? (parsed.error ?? `${pages.length}쪽`) : '쉼표로 여러 곳을 쓸 수 있어요'}</small>
            </div>
          )}
        </fieldset>
        <p className="pmnote">한글과 영어를 읽어요. 흐리거나 기울어진 스캔은 틀리게 읽을 수 있어요. 이미 글자가 있는 쪽을 다시 읽으면 찾기에서 두 번 나올 수 있어요.</p>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn navy" disabled={bad}>{pages.length ? `${pages.length}쪽 읽기` : '읽기'}</button>
        </div>
      </form>
    </div>
  );
}
