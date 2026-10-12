import { useRef, useState } from 'react';
import type { PageInfo } from '../lib/protocol';
import { PRIVACY_LABEL, type PrivacyHit, type PrivacyKind } from '../lib/privacy';
import { Icon } from './Icon';

type Rect = [number, number, number, number];

/** 개인정보 지우기 상태: 찾은 것, 고른 것, 직접 그린 상자 */
export interface PrivacyState {
  hits: PrivacyHit[];
  noText: number[];
  checked: Set<string>;
  manual: { id: string; page: number; rect: Rect }[];
  drawing: boolean;
  rrnBackOnly: boolean;
  clearInfo: boolean;
  search: string[];
}

export function privacyAreas(s: PrivacyState) {
  return [
    ...s.hits.filter((h) => s.checked.has(h.id)).map((h) => ({ page: h.page, rects: h.rects })),
    ...s.manual.map((m) => ({ page: m.page, rects: [m.rect] })),
  ];
}

const KIND_ORDER: PrivacyKind[] = ['rrn', 'mobile', 'phone', 'email', 'account', 'search'];

/** 오른쪽 칸: 찾은 개인정보 목록과 지우기 */
export function PrivacyPanel({ state, busy, onChange, onRescan, onGo, onApply, onClose }: {
  state: PrivacyState;
  busy: boolean;
  onChange: (patch: Partial<PrivacyState>) => void;
  onRescan: (patch: Partial<PrivacyState>) => void;
  onGo: (page: number) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const [word, setWord] = useState('');
  const count = state.hits.filter((h) => state.checked.has(h.id)).length + state.manual.length;
  const toggle = (ids: string[], on: boolean) => {
    const c = new Set(state.checked);
    ids.forEach((id) => (on ? c.add(id) : c.delete(id)));
    onChange({ checked: c });
  };
  const addWord = () => {
    const w = word.trim();
    if (!w || state.search.includes(w)) return;
    setWord('');
    onRescan({ search: [...state.search, w] });
  };
  return (
    <>
      <section className="privacy">
        <h2>개인정보 지우기</h2>
        <p className="small muted">주민번호·전화번호·이메일·계좌번호를 찾았어요. 고른 곳은 파일에서 글자를 완전히 지우고 검은 상자로 덮어요.</p>
        <label className="chk"><input type="checkbox" checked={state.rrnBackOnly} onChange={(e) => onRescan({ rrnBackOnly: e.target.checked })} />주민번호는 뒷자리만 가리기</label>
        <label className="chk"><input type="checkbox" checked={state.clearInfo} onChange={(e) => onChange({ clearInfo: e.target.checked })} />작성자 같은 문서 정보도 지우기</label>
        <form className="findrow" onSubmit={(e) => { e.preventDefault(); addWord(); }}>
          <input className="field" value={word} onChange={(e) => setWord(e.target.value)} placeholder="이름 등 더 찾을 글자" aria-label="더 찾을 글자" />
          <button className="btn sm" type="submit" disabled={!word.trim()}>찾기</button>
        </form>
        {state.search.length > 0 && (
          <div className="wordchips">
            {state.search.map((w) => (
              <span key={w} className="wchip">{w}<button aria-label={`${w} 빼기`} onClick={() => onRescan({ search: state.search.filter((x) => x !== w) })}><Icon name="close" size={12} /></button></span>
            ))}
          </div>
        )}
        <div className="hitlist">
          {KIND_ORDER.map((k) => {
            const list = state.hits.filter((h) => h.kind === k);
            if (!list.length) return null;
            const all = list.every((h) => state.checked.has(h.id));
            return (
              <div key={k} className="hitgroup">
                <label className="hithead"><input type="checkbox" checked={all} onChange={(e) => toggle(list.map((h) => h.id), e.target.checked)} /><b>{PRIVACY_LABEL[k]}</b><span className="muted">{list.length}곳</span></label>
                {list.map((h) => (
                  <div key={h.id} className="hit">
                    <input type="checkbox" checked={state.checked.has(h.id)} onChange={(e) => toggle([h.id], e.target.checked)} aria-label={`${h.text} 지우기`} />
                    <button className="hittext" onClick={() => onGo(h.page)} title="이 쪽으로 가기">{h.text}</button>
                    <span className="muted">{h.page + 1}쪽</span>
                  </div>
                ))}
              </div>
            );
          })}
          {!state.hits.length && <p className="small muted">찾은 개인정보가 없어요.</p>}
        </div>
        {state.noText.length > 0 && (
          <p className="note warn"><Icon name="help" size={16} />글자가 없는 쪽이 {state.noText.length}쪽 있어요(스캔한 문서 등). 이런 쪽은 아래 &lsquo;직접 가리기&rsquo;로 네모를 그려 가리세요.</p>
        )}
        <button className={`btn${state.drawing ? ' on' : ''}`} onClick={() => onChange({ drawing: !state.drawing })}>
          <Icon name="shape" size={16} />{state.drawing ? '네모 그리는 중 · 끝내기' : '직접 가리기 (네모 그리기)'}
        </button>
        {state.manual.length > 0 && <p className="small muted">직접 그린 상자 {state.manual.length}개 · 상자를 누르면 빠져요</p>}
        <button className="btn navy" disabled={!count || busy} onClick={onApply}>{count ? `${count}곳 지우기` : '지울 곳을 고르세요'}</button>
        <button className="btn" onClick={onClose}>닫기</button>
      </section>
      <p className="note"><Icon name="shieldCheck" size={16} />지운 글자는 복사하거나 검색해도 나오지 않아요. 저장하기 전에는 되돌리기로 되돌릴 수 있어요.</p>
    </>
  );
}

/** 쪽 위에 지울 곳을 미리 보여 주고, 직접 네모를 그린다 */
export function RedactLayer({ index, info, zoom, state, onToggle, onAddBox, onRemoveBox }: {
  index: number;
  info: PageInfo;
  zoom: number;
  state: PrivacyState;
  onToggle: (id: string) => void;
  onAddBox: (page: number, r: Rect) => void;
  onRemoveBox: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ a: [number, number]; b: [number, number]; pid: number } | null>(null);
  const pt = (e: React.PointerEvent): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(info.width, (e.clientX - r.left) / zoom)), Math.max(0, Math.min(info.height, (e.clientY - r.top) / zoom))];
  };
  const box = (r: Rect) => ({ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom });
  const norm = (a: [number, number], b: [number, number]): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  return (
    <div
      ref={el}
      className={`redactlayer${state.drawing ? ' drawing' : ''}`}
      style={{ width: info.width * zoom, height: info.height * zoom }}
      onPointerDown={(e) => {
        if (!state.drawing || e.button !== 0 || e.target !== e.currentTarget) return;
        e.preventDefault();
        el.current!.setPointerCapture(e.pointerId);
        const p = pt(e);
        setDraft({ a: p, b: p, pid: e.pointerId });
      }}
      onPointerMove={(e) => { if (draft?.pid === e.pointerId) setDraft({ ...draft, b: pt(e) }); }}
      onPointerUp={(e) => {
        if (draft?.pid !== e.pointerId) return;
        const r = norm(draft.a, draft.b);
        setDraft(null);
        if (r[2] - r[0] > 3 && r[3] - r[1] > 3) onAddBox(index, r);
      }}
    >
      {state.hits.filter((h) => h.page === index).map((h) => h.rects.map((r, k) => (
        <button key={h.id + k} className={`rbox${state.checked.has(h.id) ? ' on' : ''}`} style={box(r)} onClick={() => onToggle(h.id)} title={state.checked.has(h.id) ? '누르면 지우지 않아요' : '누르면 지워요'} aria-label={h.text} />
      )))}
      {state.manual.filter((m) => m.page === index).map((m) => (
        <button key={m.id} className="rbox on manual" style={box(m.rect)} onClick={() => onRemoveBox(m.id)} title="누르면 빠져요" aria-label="직접 그린 상자" />
      ))}
      {draft && <div className="rbox on draft" style={box(norm(draft.a, draft.b))} />}
    </div>
  );
}

/** 암호 걸기 / 풀기 */
export function PasswordDialog({ encrypted, onClose, onSave }: { encrypted: boolean; onClose: () => void; onSave: (password: string, printOnly: boolean) => void }) {
  const [mode, setMode] = useState<'set' | 'remove'>('set');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [printOnly, setPrintOnly] = useState(false);
  const [show, setShow] = useState(false);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ok = mode === 'remove' || (pw.length >= 4 && pw === pw2);
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg wide" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(mode === 'remove' ? '' : pw, printOnly); }}>
        <h3>암호 걸기</h3>
        {encrypted && (
          <div className="seg tabs" role="radiogroup" aria-label="할 일">
            <button type="button" role="radio" aria-checked={mode === 'set'} className={mode === 'set' ? 'on' : ''} onClick={() => setMode('set')}>새 암호 걸기</button>
            <button type="button" role="radio" aria-checked={mode === 'remove'} className={mode === 'remove' ? 'on' : ''} onClick={() => setMode('remove')}>암호 풀기</button>
          </div>
        )}
        {mode === 'set' ? (
          <>
            <p>이 문서를 열 때 암호를 묻는 파일로 따로 저장해요. 지금 보고 있는 문서는 그대로예요.</p>
            <div className="fieldcol">
              <label className="fieldlabel" htmlFor="pw1">암호 (4자 이상)</label>
              <input id="pw1" className="field" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password" />
            </div>
            <div className="fieldcol">
              <label className="fieldlabel" htmlFor="pw2">한 번 더</label>
              <input id="pw2" className="field" type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              {mismatch && <small className="err">두 암호가 달라요.</small>}
            </div>
            <label className="chk"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />암호 보이기</label>
            <label className="chk"><input type="checkbox" checked={printOnly} onChange={(e) => setPrintOnly(e.target.checked)} />인쇄만 허락하고 글자 복사·수정은 막기</label>
            <p className="note warn"><Icon name="lock" size={16} />암호를 잊으면 이 파일은 누구도 열 수 없어요. 암호는 따로 적어 두세요.</p>
          </>
        ) : (
          <p>암호를 없앤 파일로 따로 저장해요. 받는 사람이 암호 없이 열 수 있어요.</p>
        )}
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn navy" disabled={!ok}>{mode === 'set' ? '암호 걸어 저장' : '암호 풀어 저장'}</button>
        </div>
      </form>
    </div>
  );
}

const fmt = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

/** 용량 줄이기: 단계를 골라 줄여 보고, 결과를 확인한 뒤 저장 */
export function ShrinkDialog({ size, onClose, onRun, onSave }: {
  size: number;
  onClose: () => void;
  onRun: (level: 'light' | 'normal' | 'strong') => Promise<{ bytes: Uint8Array; images: number } | null>;
  onSave: (bytes: Uint8Array) => void;
}) {
  const [level, setLevel] = useState<'light' | 'normal' | 'strong'>('normal');
  const [result, setResult] = useState<{ bytes: Uint8Array; images: number; level: string } | null>(null);
  const [running, setRunning] = useState(false);
  const opt = (id: 'light' | 'normal' | 'strong', title: string, sub: string) => (
    <label className={`opt${level === id ? ' on' : ''}`}>
      <input type="radio" name="lv" checked={level === id} onChange={() => { setLevel(id); setResult(null); }} />
      <span><b>{title}</b><small>{sub}</small></span>
    </label>
  );
  const run = async () => {
    setRunning(true);
    try { const r = await onRun(level); if (r) setResult({ ...r, level }); } finally { setRunning(false); }
  };
  const smaller = result && result.bytes.length < size;
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg wide">
        <h3>용량 줄이기</h3>
        <p>사진·스캔 그림을 알맞은 크기로 줄이고 다시 압축해요. 글자는 그대로예요. 지금 문서는 그대로 두고 줄인 파일을 따로 저장해요.</p>
        <fieldset>
          <legend>얼마나 줄일까요</legend>
          <div className="opts">
            {opt('light', '조금', '인쇄용, 화질 거의 그대로')}
            {opt('normal', '보통', '메일·제출용 (추천)')}
            {opt('strong', '많이', '화면으로 볼 때만')}
          </div>
        </fieldset>
        {result && (
          <div className={`shrinkres${smaller ? '' : ' same'}`}>
            {smaller ? (
              <><b>{fmt(size)} → {fmt(result.bytes.length)}</b><span>{Math.round((1 - result.bytes.length / size) * 100)}% 줄었어요{result.images ? ` · 그림 ${result.images}개 줄임` : ''}</span></>
            ) : (
              <><b>더 줄이지 못했어요</b><span>이미 작게 압축된 문서예요.</span></>
            )}
          </div>
        )}
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>{result ? '닫기' : '취소'}</button>
          {result && smaller && result.level === level
            ? <button className="btn navy" onClick={() => onSave(result.bytes)}>줄인 파일 저장</button>
            : <button className="btn navy" onClick={run} disabled={running}>{running ? '줄이는 중…' : '줄여 보기'}</button>}
        </div>
      </div>
    </div>
  );
}
