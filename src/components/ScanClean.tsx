import { useEffect, useRef, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { CleanOptions } from '../lib/protocol';
import { parseRanges } from '../lib/ranges';

type Which = 'textless' | 'current' | 'all' | 'custom';
const DEFAULT: CleanOptions = { mode: 'bw', deskew: true, borders: true, whiten: true };
const load = (): CleanOptions => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem('sowuju.clean') ?? '{}') }; } catch { return DEFAULT; } };

/** 스캔 깨끗하게: 고르기 + 지금 쪽 전·후 미리보기 */
export function ScanCleanDialog({ client, total, current, textless, onClose, onRun }: {
  client: PdfClient; total: number; current: number; textless: number[] | null;
  onClose: () => void;
  onRun: (pages: number[], o: CleanOptions, ocr: boolean) => void;
}) {
  const [o, setO] = useState<CleanOptions>(load);
  const [which, setWhich] = useState<Which>(() => (textless?.length ? 'textless' : 'current'));
  const [text, setText] = useState('');
  const [ocr, setOcr] = useState(true);
  // 스캔한 쪽을 늦게 알게 되면, 아직 고르지 않았을 때 그쪽으로
  const touched = useRef(false);
  useEffect(() => { if (!touched.current && textless?.length) setWhich('textless'); }, [textless]);
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<{ url: string; angle: number } | null>(null);
  const urls = useRef<string[]>([]);
  const mk = (b: Uint8Array) => { const u = URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' })); urls.current.push(u); return u; };
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);
  useEffect(() => { client.renderPng(current, 60 / 72).then((b) => setBefore(mk(b))).catch(() => {}); }, [client, current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let off = false;
    const t = setTimeout(() => client.cleanPreview(current, o).then((r) => { if (!off) setAfter({ url: mk(r.png), angle: r.angle }); }).catch(() => {}), 150);
    return () => { off = true; clearTimeout(t); };
  }, [client, current, o]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseRanges(text, total);
  const pages = which === 'textless' ? textless ?? [] : which === 'current' ? [current] : which === 'all' ? Array.from({ length: total }, (_, i) => i) : parsed.groups.flat();
  const bad = !pages.length || (which === 'custom' && !!parsed.error);
  const set = (p: Partial<CleanOptions>) => setO((x) => ({ ...x, ...p }));
  const radio = <T extends string>(name: string, v: T, cur: T, on: (v: T) => void, title: string, sub: string, disabled = false) => (
    <label className={`opt${cur === v ? ' on' : ''}${disabled ? ' dis' : ''}`}>
      <input type="radio" name={name} checked={cur === v} onChange={() => { if (name === 'cw') touched.current = true; on(v); }} disabled={disabled} />
      <span><b>{title}</b><small>{sub}</small></span>
    </label>
  );
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg wide cleandlg" onSubmit={(e) => {
        e.preventDefault();
        if (bad) return;
        try { localStorage.setItem('sowuju.clean', JSON.stringify(o)); } catch { /* 괜찮음 */ }
        onRun(pages, o, ocr);
      }}>
        <h3>스캔 깨끗하게</h3>
        <div className="cleangrid">
          <div className="cleanform">
            <fieldset>
              <legend>모양</legend>
              <div className="opts">
                {radio('cm', 'bw', o.mode, (mode) => set({ mode }), '흑백', '글자 문서 (가장 또렷, 작음)')}
                {radio('cm', 'gray', o.mode, (mode) => set({ mode }), '회색조', '사진·그림이 있을 때')}
                {radio('cm', 'color', o.mode, (mode) => set({ mode }), '컬러', '빨간 도장·컬러 표시')}
              </div>
            </fieldset>
            <div className="rcpsteps">
              <label className="pmcheck"><input type="checkbox" checked={o.deskew} onChange={(e) => set({ deskew: e.target.checked })} />기울어진 쪽 바로 세우기</label>
              <label className="pmcheck"><input type="checkbox" checked={o.whiten || o.mode === 'bw'} disabled={o.mode === 'bw'} onChange={(e) => set({ whiten: e.target.checked })} />회색 바탕을 하얗게, 글자는 진하게</label>
              <label className="pmcheck"><input type="checkbox" checked={o.borders} onChange={(e) => set({ borders: e.target.checked })} />가장자리 검은 테두리·그림자 지우기</label>
            </div>
            <fieldset>
              <legend>어느 쪽을</legend>
              <div className="opts">
                {radio('cw', 'textless', which, setWhich, '스캔한 쪽', textless === null ? '찾는 중…' : textless.length ? `${textless.length}쪽 (추천)` : '없어요', !textless?.length)}
                {radio('cw', 'current', which, setWhich, '지금 쪽', `${current + 1}쪽`)}
                {radio('cw', 'all', which, setWhich, '전체', `${total}쪽`)}
                {radio('cw', 'custom', which, setWhich, '직접 쓰기', '예) 1-3, 7')}
              </div>
              {which === 'custom' && (
                <div className="printrange">
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="1-3, 7" aria-label="깨끗하게 할 쪽" autoFocus />
                  <small className={parsed.error && text.trim() ? 'bad' : ''}>{text.trim() ? (parsed.error ?? `${pages.length}쪽`) : '쉼표로 여러 곳을 쓸 수 있어요'}</small>
                </div>
              )}
            </fieldset>
            <label className="pmcheck"><input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />끝나면 글자 읽기(OCR)도 하기 — 찾기·복사가 되게</label>
          </div>
          <div className="cleanprev" aria-label="미리보기">
            <figure>{before ? <img src={before} alt="지금 모습" /> : <span className="ph" />}<figcaption>지금</figcaption></figure>
            <figure>{after ? <img src={after.url} alt="깨끗하게 한 모습" /> : <span className="ph" />}<figcaption>깨끗하게{after?.angle ? ` · ${Math.abs(after.angle).toFixed(1)}° 바로 세움` : ''}</figcaption></figure>
          </div>
        </div>
        <p className="pmnote">쪽을 깨끗한 그림으로 바꿔요. 그 쪽에 있던 글자(이미 읽은 글자 포함)·입력칸·메모는 그림이 되므로 글자 문서에는 쓰지 마세요. 되돌리기로 원래대로 돌릴 수 있어요.</p>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn navy" disabled={bad}>{pages.length ? `${pages.length}쪽 깨끗하게` : '깨끗하게'}</button>
        </div>
      </form>
    </div>
  );
}
