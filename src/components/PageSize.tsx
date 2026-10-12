import { useEffect, useRef, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { CropOptions, PageInfo, ResizeOptions } from '../lib/protocol';

type Scope = 'all' | 'current' | 'selected';
const mm = (v: number) => (v * 72) / 25.4;
export const PAPER: { id: string; label: string; w: number; h: number }[] = [
  { id: 'A4', label: 'A4', w: 595.28, h: 841.89 },
  { id: 'A3', label: 'A3', w: 841.89, h: 1190.55 },
  { id: 'A5', label: 'A5', w: 419.53, h: 595.28 },
  { id: 'B4', label: 'B4', w: mm(257), h: mm(364) },
  { id: 'B5', label: 'B5', w: mm(182), h: mm(257) },
  { id: 'Letter', label: '레터', w: 612, h: 792 },
];
const sizeName = (p: PageInfo) => {
  const a = Math.min(p.width, p.height), b = Math.max(p.width, p.height);
  const f = PAPER.find((x) => Math.abs(x.w - a) < 4 && Math.abs(x.h - b) < 4);
  return `${f ? f.label : `${Math.round((a * 25.4) / 72)}×${Math.round((b * 25.4) / 72)}mm`} ${p.width > p.height ? '가로' : '세로'}`;
};

function ScopePick({ scope, setScope, total, current, selected }: { scope: Scope; setScope: (s: Scope) => void; total: number; current: number; selected: number[] }) {
  const opt = (v: Scope, t: string, sub: string, dis = false) => (
    <label className={`opt${scope === v ? ' on' : ''}${dis ? ' dis' : ''}`}>
      <input type="radio" name="scope" checked={scope === v} disabled={dis} onChange={() => setScope(v)} />
      <span><b>{t}</b><small>{sub}</small></span>
    </label>
  );
  return (
    <fieldset>
      <legend>어느 쪽을</legend>
      <div className="opts">
        {opt('all', '전체', `${total}쪽`)}
        {opt('current', '지금 쪽', `${current + 1}쪽`)}
        {opt('selected', '고른 쪽', selected.length ? `${selected.length}쪽` : '목록에서 먼저 고르세요', !selected.length)}
      </div>
    </fieldset>
  );
}
const pagesOf = (scope: Scope, total: number, current: number, selected: number[]) => (scope === 'all' ? Array.from({ length: total }, (_, i) => i) : scope === 'current' ? [current] : selected);

/** 쪽 크기 바꾸기: 내용을 새 용지에 맞춰 줄이거나 늘려 가운데에 놓는다 */
export function ResizeDialog({ pages, current, selected, onClose, onRun }: { pages: PageInfo[]; current: number; selected: number[]; onClose: () => void; onRun: (o: ResizeOptions) => void }) {
  const [paper, setPaper] = useState('A4');
  const [orient, setOrient] = useState<ResizeOptions['orient']>('keep');
  const [scope, setScope] = useState<Scope>(selected.length ? 'selected' : 'all');
  const sizes = [...new Set(pages.map(sizeName))];
  const p = PAPER.find((x) => x.id === paper)!;
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg wide" onSubmit={(e) => { e.preventDefault(); onRun({ width: p.w, height: p.h, orient, pages: pagesOf(scope, pages.length, current, selected) }); }}>
        <h3>쪽 크기 바꾸기</h3>
        <p>지금: {sizes.slice(0, 3).join(', ')}{sizes.length > 3 ? ' 등' : ''}. 내용은 새 용지에 맞춰 비율 그대로 줄이거나 늘려 가운데에 놓아요.</p>
        <fieldset>
          <legend>새 용지</legend>
          <div className="seg wide" role="group" aria-label="용지">
            {PAPER.map((x) => <button key={x.id} type="button" className={paper === x.id ? 'on' : ''} onClick={() => setPaper(x.id)}>{x.label}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>방향</legend>
          <div className="seg wide" role="group" aria-label="방향">
            {([['keep', '원래 방향대로'], ['portrait', '모두 세로'], ['landscape', '모두 가로']] as const).map(([v, t]) => <button key={v} type="button" className={orient === v ? 'on' : ''} onClick={() => setOrient(v)}>{t}</button>)}
          </div>
        </fieldset>
        <ScopePick scope={scope} setScope={setScope} total={pages.length} current={current} selected={selected} />
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn navy">{p.label}로 바꾸기</button>
        </div>
      </form>
    </div>
  );
}

/** 여백 자르기: 지금 쪽 그림 위에서 남길 곳을 끌어 고르거나, 내용에 맞춰 자동으로 */
export function CropDialog({ client, pages, current, selected, onClose, onRun }: { client: PdfClient; pages: PageInfo[]; current: number; selected: number[]; onClose: () => void; onRun: (o: CropOptions) => void }) {
  const info = pages[current];
  const [auto, setAuto] = useState(true);
  const [margin, setMargin] = useState(mm(5));
  const [scope, setScope] = useState<Scope>('all');
  const [img, setImg] = useState<string | null>(null);
  const [rect, setRect] = useState<[number, number, number, number] | null>(null);
  const drag = useRef<{ a: [number, number]; pid: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const H = 360, scale = H / info.height, W = info.width * scale;
  useEffect(() => {
    let url = '';
    client.renderPng(current, scale * 2).then((b) => { url = URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' })); setImg(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [client, current, scale]);
  const pt = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(info.width, (e.clientX - r.left) / scale)), Math.max(0, Math.min(info.height, (e.clientY - r.top) / scale))];
  };
  const ok = auto || (!!rect && rect[2] - rect[0] > 20 && rect[3] - rect[1] > 20);
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg wide cropdlg" onSubmit={(e) => { e.preventDefault(); if (ok) onRun({ pages: pagesOf(scope, pages.length, current, selected), auto, margin, rect: auto ? undefined : rect! }); }}>
        <h3>여백 자르기</h3>
        <div className="cropgrid">
          <div className="cropform">
            <div className="opts">
              <label className={`opt${auto ? ' on' : ''}`}><input type="radio" name="cm" checked={auto} onChange={() => setAuto(true)} /><span><b>내용에 맞춰 자동으로</b><small>쪽마다 글자·그림 둘레만 남겨요</small></span></label>
              <label className={`opt${!auto ? ' on' : ''}`}><input type="radio" name="cm" checked={!auto} onChange={() => setAuto(false)} /><span><b>직접 고르기</b><small>오른쪽 그림에서 남길 곳을 끌어요</small></span></label>
            </div>
            {auto && (
              <div className="pmrow"><span>남길 여백</span>
                <div className="seg" role="group" aria-label="남길 여백">
                  {[0, 5, 10, 15].map((v) => <button key={v} type="button" className={Math.abs(margin - mm(v)) < 0.1 ? 'on' : ''} onClick={() => setMargin(mm(v))}>{v}mm</button>)}
                </div>
              </div>
            )}
            <ScopePick scope={scope} setScope={setScope} total={pages.length} current={current} selected={selected} />
            <p className="pmnote">자른 바깥 부분은 숨겨질 뿐 지워지지 않아요. 아래 <b>원래대로</b>로 되돌릴 수 있어요.</p>
          </div>
          <div
            ref={box}
            className={`cropbox${auto ? ' off' : ''}`}
            style={{ width: W, height: H, backgroundImage: img ? `url(${img})` : undefined }}
            onPointerDown={(e) => { if (auto) return; e.preventDefault(); box.current!.setPointerCapture(e.pointerId); const p = pt(e); drag.current = { a: p, pid: e.pointerId }; setRect([p[0], p[1], p[0], p[1]]); }}
            onPointerMove={(e) => { const d = drag.current; if (!d || d.pid !== e.pointerId) return; const p = pt(e); setRect([Math.min(d.a[0], p[0]), Math.min(d.a[1], p[1]), Math.max(d.a[0], p[0]), Math.max(d.a[1], p[1])]); }}
            onPointerUp={() => { drag.current = null; }}
          >
            {!auto && rect && <span className="cropsel" style={{ left: rect[0] * scale, top: rect[1] * scale, width: (rect[2] - rect[0]) * scale, height: (rect[3] - rect[1]) * scale }} />}
            {!auto && !rect && <span className="crophint">남길 곳을 끌어 주세요</span>}
          </div>
        </div>
        <div className="acts">
          <button type="button" className="btn ghost" onClick={() => onRun({ pages: pagesOf(scope, pages.length, current, selected), margin: 0, reset: true })}>원래대로</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn navy" disabled={!ok}>자르기</button>
        </div>
      </form>
    </div>
  );
}
