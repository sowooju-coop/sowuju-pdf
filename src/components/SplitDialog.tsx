import { useMemo, useState } from 'react';
import { chunks, groupLabel, parseRanges } from '../lib/ranges';

type How = 'each' | 'every' | 'ranges';

/** PDF 나누기: 한 쪽씩 / n쪽씩 / 직접 쓴 범위대로 여러 파일로 */
export function SplitDialog({ total, selected, onClose, onSplit }: {
  total: number;
  selected: number[];
  onClose: () => void;
  onSplit: (groups: number[][]) => void;
}) {
  const [how, setHow] = useState<How>('each');
  const [n, setN] = useState(2);
  const [text, setText] = useState(() => (selected.length ? selected.map((i) => i + 1).join(', ') : `1-${Math.ceil(total / 2)}, ${Math.ceil(total / 2) + 1}-${total}`));
  const res = useMemo(() => {
    if (how === 'each') return { groups: chunks(total, 1) };
    if (how === 'every') return { groups: chunks(total, Math.max(1, Math.floor(n) || 1)) };
    return parseRanges(text, total);
  }, [how, n, text, total]);
  const ok = !res.error && res.groups.length > 0;
  const shown = res.groups.slice(0, 6).map(groupLabel);
  const opt = (id: How, title: string, sub: React.ReactNode) => (
    <label className={`opt${how === id ? ' on' : ''}`}>
      <input type="radio" name="split" checked={how === id} onChange={() => setHow(id)} />
      <span><b>{title}</b><small>{sub}</small></span>
    </label>
  );
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg wide">
        <h3>PDF 나누기</h3>
        <p>지금 문서({total}쪽)를 여러 개의 PDF로 나눠서 한 폴더에 저장해요. 지금 문서는 그대로예요.</p>
        <fieldset>
          <legend>어떻게 나눌까요</legend>
          <div className="opts">
            {opt('each', '한 쪽씩', `${total}개 파일`)}
            {opt('every', '몇 쪽씩', <span className="splitn"><input type="number" min={1} max={total} value={n} onChange={(e) => { setN(Number(e.target.value)); setHow('every'); }} onClick={() => setHow('every')} aria-label="몇 쪽씩" />쪽씩</span>)}
            {opt('ranges', '직접 나누기', '쪽 범위를 써서')}
          </div>
        </fieldset>
        {how === 'ranges' && (
          <label className="splitrange">
            <span>쉼표로 파일을 나눠요. 예) <code>1-3, 4-10, 11-</code></span>
            <input value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="쪽 범위" />
          </label>
        )}
        <div className={`splitres${ok ? '' : ' bad'}`} role="status">
          {res.error ? res.error : ok ? <><b>파일 {res.groups.length}개</b><span>{shown.join(' · ')}{res.groups.length > 6 ? ' …' : ''}</span></> : '나눌 쪽을 써 주세요.'}
        </div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="button" className="btn navy" disabled={!ok} onClick={() => onSplit(res.groups)}>폴더 골라 저장</button>
        </div>
      </div>
    </div>
  );
}
