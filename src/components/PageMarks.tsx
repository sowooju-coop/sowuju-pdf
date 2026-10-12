import { useState } from 'react';
import { FONTS, fontFile, type FontFamily } from '../lib/fonts';
import type { PageInfo, PageNumberOptions, WatermarkOptions } from '../lib/protocol';

const readJson = <T,>(k: string, d: T): T => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) ?? '{}') }; } catch { return d; } };
const writeJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 괜찮음 */ } };

function Seg<T extends string | number | boolean>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, t]) => <button key={String(v)} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

/** 쪽 모양 미리보기 (첫 쪽 비율) */
function Sheet({ info, children }: { info: PageInfo; children: React.ReactNode }) {
  const h = 190, w = Math.round(h * info.width / info.height);
  return <div className="pmsheet" style={{ width: w, height: h }} aria-hidden="true"><i /><i /><i /><i /><i />{children}</div>;
}

const NUM_FORMATS: [PageNumberOptions['format'], string][] = [['plain', '1'], ['dash', '- 1 -'], ['slash', '1 / 10'], ['kor', '1쪽']];
const label = (f: PageNumberOptions['format'], n: number, total: number) => (f === 'dash' ? `- ${n} -` : f === 'slash' ? `${n} / ${total}` : f === 'kor' ? `${n}쪽` : String(n));

interface NumPrefs { pos: string; format: PageNumberOptions['format']; size: number; family: FontFamily; skipFirst: boolean; mirror: boolean; start: number }
const NUM_DEFAULT: NumPrefs = { pos: 'bc', format: 'dash', size: 10, family: 'sans', skipFirst: false, mirror: false, start: 1 };

export function PageNumberDialog({ info, total, onClose, onApply }: { info: PageInfo; total: number; onClose: () => void; onApply: (o: PageNumberOptions) => void }) {
  const [p, setP] = useState<NumPrefs>(() => readJson('sowuju.pagenum', NUM_DEFAULT));
  const set = (patch: Partial<NumPrefs>) => setP((x) => ({ ...x, ...patch }));
  const last = p.start + (p.skipFirst ? total - 2 : total - 1);
  const apply = () => {
    writeJson('sowuju.pagenum', p);
    onApply({ position: [p.pos[0] as 't' | 'b', p.pos[1] as 'l' | 'c' | 'r'], format: p.format, start: Math.max(0, Math.round(p.start) || 1), skipFirst: p.skipFirst, mirror: p.mirror, size: p.size, margin: 28, color: [0.15, 0.15, 0.15], fontFile: fontFile(p.family, false) });
  };
  const s = 190 / info.height;
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg wide pmdlg">
        <h3>쪽 번호 넣기</h3>
        <div className="pmgrid">
          <div className="pmform">
            <label className="pmrow"><span>위치</span>
              <div className="pmpos" role="group" aria-label="위치">
                {['tl', 'tc', 'tr', 'bl', 'bc', 'br'].map((k) => (
                  <button key={k} type="button" className={p.pos === k ? 'on' : ''} aria-pressed={p.pos === k} aria-label={`${k[0] === 't' ? '위' : '아래'} ${k[1] === 'l' ? '왼쪽' : k[1] === 'c' ? '가운데' : '오른쪽'}`} onClick={() => set({ pos: k })}><i /></button>
                ))}
              </div>
            </label>
            <div className="pmrow"><span>모양</span><Seg label="모양" value={p.format} options={NUM_FORMATS} onChange={(format) => set({ format })} /></div>
            <div className="pmrow"><span>크기</span><Seg label="크기" value={p.size} options={[[9, '작게'], [10, '보통'], [12, '크게']]} onChange={(size) => set({ size })} /></div>
            <div className="pmrow"><span>글씨체</span><Seg label="글씨체" value={p.family} options={[['sans', FONTS.sans.label], ['serif', FONTS.serif.label]]} onChange={(family) => set({ family })} /></div>
            <label className="pmrow"><span>시작 번호</span><input type="number" min={0} max={9999} value={p.start} onChange={(e) => set({ start: Number(e.target.value) })} className="pmnum" /></label>
            <label className="pmcheck"><input type="checkbox" checked={p.skipFirst} onChange={(e) => set({ skipFirst: e.target.checked })} />첫 쪽(표지)에는 넣지 않기</label>
            <label className="pmcheck"><input type="checkbox" checked={p.mirror} disabled={p.pos[1] === 'c'} onChange={(e) => set({ mirror: e.target.checked })} />양면 인쇄용 (짝수 쪽은 반대편에)</label>
          </div>
          <div className="pmprev">
            <Sheet info={info}>
              <span className="pmlabel" style={{
                fontSize: Math.max(7, p.size * s * 1.6), fontFamily: FONTS[p.family].css,
                [p.pos[0] === 't' ? 'top' : 'bottom']: 28 * s,
                ...(p.pos[1] === 'l' ? { left: 28 * s } : p.pos[1] === 'r' ? { right: 28 * s } : { left: 0, right: 0, textAlign: 'center' as const }),
              }}>{label(p.format, p.start, last)}</span>
            </Sheet>
            <small>{p.skipFirst ? `2쪽부터 ${p.start}번` : `1쪽이 ${p.start}번`} · 모두 {p.skipFirst ? total - 1 : total}쪽</small>
          </div>
        </div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="button" className="btn navy" onClick={apply}>넣기</button>
        </div>
      </div>
    </div>
  );
}

interface WmPrefs { text: string; diagonal: boolean; opacity: number; color: string; family: FontFamily; bold: boolean }
const WM_DEFAULT: WmPrefs = { text: '사본', diagonal: true, opacity: 0.15, color: '#6B7280', family: 'sans', bold: true };
const WM_PRESETS = ['사본', '대외비', '초안', '내부 검토용', '제출용', '견본'];
const WM_COLORS: [string, string][] = [['#6B7280', '회색'], ['#C8102E', '빨강'], ['#1D4ED8', '파랑']];
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

export function WatermarkDialog({ info, selected, onClose, onApply }: { info: PageInfo; selected: number[]; onClose: () => void; onApply: (o: WatermarkOptions) => void }) {
  const [p, setP] = useState<WmPrefs>(() => readJson('sowuju.watermark', WM_DEFAULT));
  const [onlySel, setOnlySel] = useState(false);
  const set = (patch: Partial<WmPrefs>) => setP((x) => ({ ...x, ...patch }));
  const apply = () => {
    if (!p.text.trim()) return;
    writeJson('sowuju.watermark', p);
    onApply({ text: p.text.trim(), size: 0, diagonal: p.diagonal, opacity: p.opacity, color: rgb(p.color), fontFile: fontFile(p.family, p.bold), pages: onlySel && selected.length ? selected : undefined });
  };
  const h = 190, w = h * info.width / info.height;
  const ang = p.diagonal ? Math.atan2(h, w) : 0;
  const span = p.diagonal ? Math.hypot(w, h) : w;
  // 실제 넣을 때와 같은 계산 (한글 한 글자 폭 ≈ 0.86, 영문·숫자 ≈ 0.55)
  const chars = [...p.text.trim()].reduce((a, c) => a + (/[\x20-\x7e]/.test(c) ? 0.55 : 0.86), 0) || 1;
  const fs = Math.min(span * 0.6 / chars, Math.min(w, h) * 0.3);
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg wide pmdlg">
        <h3>워터마크 넣기</h3>
        <div className="pmgrid">
          <div className="pmform">
            <label className="pmrow"><span>글자</span><input className="pmtext" value={p.text} maxLength={30} onChange={(e) => set({ text: e.target.value })} autoFocus /></label>
            <div className="pmchips">{WM_PRESETS.map((t) => <button key={t} type="button" className={`chip${p.text === t ? ' on' : ''}`} onClick={() => set({ text: t })}>{t}</button>)}</div>
            <div className="pmrow"><span>방향</span><Seg label="방향" value={p.diagonal} options={[[true, '비스듬히'], [false, '가로']]} onChange={(diagonal) => set({ diagonal })} /></div>
            <div className="pmrow"><span>진하기</span><Seg label="진하기" value={p.opacity} options={[[0.1, '연하게'], [0.15, '보통'], [0.25, '진하게']]} onChange={(opacity) => set({ opacity })} /></div>
            <div className="pmrow"><span>색</span><Seg label="색" value={p.color} options={WM_COLORS} onChange={(color) => set({ color })} /></div>
            <div className="pmrow"><span>글씨체</span><Seg label="글씨체" value={p.family} options={[['sans', FONTS.sans.label], ['serif', FONTS.serif.label]]} onChange={(family) => set({ family })} /></div>
            {selected.length > 0 && <label className="pmcheck"><input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} />고른 {selected.length}쪽에만 넣기</label>}
          </div>
          <div className="pmprev">
            <Sheet info={info}>
              <span className="pmwm" style={{ fontSize: fs, color: p.color, opacity: Math.min(1, p.opacity * 2.2), fontFamily: FONTS[p.family].css, fontWeight: p.bold ? 700 : 400, transform: `translate(-50%,-50%) rotate(${-ang}rad)` }}>{p.text.trim()}</span>
            </Sheet>
            <small>{onlySel && selected.length ? `고른 ${selected.length}쪽` : '모든 쪽'}에 넣어요</small>
          </div>
        </div>
        <p className="pmnote">워터마크는 문서 내용으로 들어가서 인쇄해도 나와요. 넣은 뒤에도 되돌리기로 뺄 수 있어요.</p>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="button" className="btn navy" onClick={apply} disabled={!p.text.trim()}>넣기</button>
        </div>
      </div>
    </div>
  );
}
