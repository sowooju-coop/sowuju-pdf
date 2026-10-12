import { useState } from 'react';
import { Icon } from './Icon';
import { describePageNumbers } from './PageMarks';

export interface Recipe {
  name: string;
  pageNumbers: boolean;
  watermark: string;
  clearInfo: boolean;
  shrink: 'light' | 'normal' | 'strong' | null;
  lock: boolean;
  printOnly: boolean;
  suffix: string;
}
export interface RecipeRun { recipe: Recipe; password: string; target: 'current' | 'files' }

const BUILTIN: Recipe[] = [
  { name: '제출용', pageNumbers: true, watermark: '', clearInfo: true, shrink: 'normal', lock: false, printOnly: false, suffix: '_제출용' },
  { name: '외부 공유용', pageNumbers: false, watermark: '사본', clearInfo: true, shrink: null, lock: true, printOnly: true, suffix: '_공유용' },
  { name: '메일 첨부용', pageNumbers: false, watermark: '', clearInfo: false, shrink: 'normal', lock: false, printOnly: false, suffix: '_메일용' },
];
const KEY = 'sowuju.recipes';
const load = (): Recipe[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return Array.isArray(v) ? v : []; } catch { return []; } };
const store = (l: Recipe[]) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* 괜찮음 */ } };

/**
 * 한 번에 처리: 쪽 번호·워터마크·문서 정보 지우기·용량 줄이기·암호를 골라 묶어 두고,
 * 지금 문서나 여러 PDF에 한 번에 해서 새 파일로 저장한다. 묶음은 이름을 붙여 저장해 둘 수 있다 (암호는 저장하지 않음)
 */
export function RecipeDialog({ onClose, onRun }: { onClose: () => void; onRun: (r: RecipeRun) => void }) {
  const [mine, setMine] = useState<Recipe[]>(load);
  const all = [...BUILTIN, ...mine];
  const [r, setR] = useState<Recipe>(() => ({ ...(all.find((x) => x.name === localStorage.getItem('sowuju.recipe.last')) ?? BUILTIN[0]) }));
  const [password, setPassword] = useState('');
  const [target, setTarget] = useState<'current' | 'files'>('current');
  const set = (p: Partial<Recipe>) => setR((x) => ({ ...x, ...p }));
  const steps = [r.pageNumbers, !!r.watermark.trim(), r.clearInfo, !!r.shrink, r.lock].filter(Boolean).length;
  const bad = !steps || (r.lock && password.length < 4);
  const saveAs = () => {
    const name = window.prompt('이 묶음의 이름을 정해 주세요 (예: 교육청 제출용)', BUILTIN.some((b) => b.name === r.name) ? '' : r.name)?.trim();
    if (!name) return;
    const next = [...mine.filter((m) => m.name !== name), { ...r, name }];
    setMine(next); store(next); set({ name });
  };
  const removeMine = (name: string) => { const next = mine.filter((m) => m.name !== name); setMine(next); store(next); };
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg wide rcpdlg" onSubmit={(e) => {
        e.preventDefault();
        if (bad) return;
        try { localStorage.setItem('sowuju.recipe.last', r.name); } catch { /* 괜찮음 */ }
        onRun({ recipe: r, password, target });
      }}>
        <h3>한 번에 처리</h3>
        <p>자주 하는 일을 묶어서 한 번에 하고 새 파일로 저장해요. 지금 문서 말고 여러 PDF에도 똑같이 할 수 있어요.</p>
        <div className="rcpchips" role="group" aria-label="묶음">
          {all.map((x) => (
            <span key={x.name} className={`chip${r.name === x.name ? ' on' : ''}`}>
              <button type="button" onClick={() => setR({ ...x })}>{x.name}</button>
              {mine.includes(x) && <button type="button" className="x" aria-label={`${x.name} 묶음 지우기`} onClick={() => removeMine(x.name)}><Icon name="close" size={11} /></button>}
            </span>
          ))}
        </div>
        <div className="rcpsteps">
          <label className="pmcheck"><input type="checkbox" checked={r.pageNumbers} onChange={(e) => set({ pageNumbers: e.target.checked })} />쪽 번호 넣기 <small>({describePageNumbers()})</small></label>
          <label className="pmcheck"><input type="checkbox" checked={!!r.watermark} onChange={(e) => set({ watermark: e.target.checked ? '사본' : '' })} />워터마크
            {!!r.watermark && <input className="rcpin" value={r.watermark} maxLength={30} onChange={(e) => set({ watermark: e.target.value })} aria-label="워터마크 글자" />}
          </label>
          <label className="pmcheck"><input type="checkbox" checked={r.clearInfo} onChange={(e) => set({ clearInfo: e.target.checked })} />작성자 등 문서 정보 지우기</label>
          <label className="pmcheck"><input type="checkbox" checked={!!r.shrink} onChange={(e) => set({ shrink: e.target.checked ? 'normal' : null })} />용량 줄이기
            {r.shrink && (
              <span className="seg" role="group" aria-label="얼마나">
                {([['light', '조금'], ['normal', '보통'], ['strong', '많이']] as const).map(([v, t]) => <button key={v} type="button" className={r.shrink === v ? 'on' : ''} onClick={() => set({ shrink: v })}>{t}</button>)}
              </span>
            )}
          </label>
          <label className="pmcheck"><input type="checkbox" checked={r.lock} onChange={(e) => set({ lock: e.target.checked })} />암호 걸기
            {r.lock && <input className="rcpin" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="암호 (4자 이상)" aria-label="암호" autoComplete="new-password" />}
          </label>
          {r.lock && <label className="pmcheck sub"><input type="checkbox" checked={r.printOnly} onChange={(e) => set({ printOnly: e.target.checked })} />암호를 넣고 열어도 인쇄만 되고 글자 복사·수정은 막기</label>}
        </div>
        <fieldset>
          <legend>어디에</legend>
          <div className="opts">
            <label className={`opt${target === 'current' ? ' on' : ''}`}><input type="radio" name="rt" checked={target === 'current'} onChange={() => setTarget('current')} /><span><b>지금 문서</b><small>새 이름으로 저장</small></span></label>
            <label className={`opt${target === 'files' ? ' on' : ''}`}><input type="radio" name="rt" checked={target === 'files'} onChange={() => setTarget('files')} /><span><b>여러 PDF 파일</b><small>골라서 한 폴더에 저장</small></span></label>
          </div>
        </fieldset>
        <label className="pmrow"><span>파일 이름 끝</span><input className="pmtext" value={r.suffix} maxLength={20} onChange={(e) => set({ suffix: e.target.value })} aria-label="파일 이름 끝에 붙일 말" /></label>
        <div className="acts">
          <button type="button" className="btn ghost" onClick={saveAs} disabled={!steps}>이 묶음 이름 붙여 두기</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn navy" disabled={bad}>{steps ? `${steps}가지 한 번에 하기` : '할 일을 고르세요'}</button>
        </div>
      </form>
    </div>
  );
}
