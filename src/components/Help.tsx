import { useEffect, useRef, useState } from 'react';
import { HELP_TOPICS, SHORTCUTS } from '../lib/helpContent';
import { Icon, Logo } from './Icon';

/** **굵게** 표시만 지원하는 아주 작은 글 꾸미기 */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p))}</>;
}

/** 도움말: 왼쪽에 할 일 목록과 찾기, 오른쪽에 순서대로 설명 */
export function HelpDialog({ topic, onClose }: { topic?: string; onClose: () => void }) {
  const [cur, setCur] = useState(topic ?? HELP_TOPICS[0].id);
  const [q, setQ] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const words = q.trim().split(/\s+/).filter(Boolean);
  const list = HELP_TOPICS.filter((t) => words.every((w) => (t.title + t.words + t.steps.join(' ')).includes(w)));
  const t = cur === 'keys' ? null : HELP_TOPICS.find((x) => x.id === cur) ?? HELP_TOPICS[0];
  useEffect(() => { body.current?.scrollTo(0, 0); }, [cur]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg helpdlg" role="dialog" aria-labelledby="help-t">
        <aside className="helpnav">
          <h3 id="help-t"><Icon name="help" size={20} />도움말</h3>
          <label className="helpsearch">
            <Icon name="search" size={16} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="무엇을 하고 싶으세요?" aria-label="도움말 찾기" autoFocus />
          </label>
          <nav aria-label="도움말 목록">
            {list.map((x) => (
              <button key={x.id} className={x.id === cur ? 'on' : ''} onClick={() => setCur(x.id)}><Icon name={x.icon} size={17} />{x.title}</button>
            ))}
            {!list.length && <p className="small muted">찾는 내용이 없어요. 다른 말로 찾아보세요.</p>}
            {!q && <button className={cur === 'keys' ? 'on' : ''} onClick={() => setCur('keys')}><Icon name="fit" size={17} />단축키</button>}
          </nav>
        </aside>
        <div className="helpbody" ref={body}>
          <button className="helpclose" aria-label="도움말 닫기" onClick={onClose}><Icon name="close" size={20} /></button>
          {t ? (
            <>
              <h2><span className="hicon"><Icon name={t.icon} size={24} /></span>{t.title}</h2>
              <ol className="helpsteps">
                {t.steps.map((s, i) => <li key={i}><span className="num">{i + 1}</span><span><Rich text={s} /></span></li>)}
              </ol>
              {t.tip && <p className="helptip"><Icon name="shieldCheck" size={18} /><span><Rich text={t.tip} /></span></p>}
            </>
          ) : (
            <>
              <h2><span className="hicon"><Icon name="fit" size={24} /></span>단축키</h2>
              <table className="keys">
                <tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody>
              </table>
            </>
          )}
          <p className="helpfoot">실수해도 괜찮아요. <b>되돌리기(↶)</b>로 언제든 돌아갈 수 있고, <b>저장</b>하기 전에는 원래 파일이 바뀌지 않아요.</p>
        </div>
      </div>
    </div>
  );
}

const WELCOME = [
  { icon: 'open', title: 'PDF 파일을 여세요', text: '‘PDF 열기’를 누르거나, 파일을 화면으로 끌어다 놓으세요. 파일은 이 컴퓨터 밖으로 나가지 않아요.' },
  { icon: 'edit', title: '하고 싶은 일을 누르세요', text: '글자 고치기, 서명·직인, 페이지 정리, 인쇄처럼 할 일을 누르면 화면 위에 다음에 할 일을 알려 드려요.' },
  { icon: 'save', title: '저장하면 끝이에요', text: '잘못 고쳐도 ‘되돌리기(↶)’로 돌아갈 수 있어요. 다 고쳤으면 ‘저장’을 누르세요.' },
];

/** 처음 켰을 때 한 번 보여 주는 3단계 안내 */
export function Welcome({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const [i, setI] = useState(0);
  const s = WELCOME[i];
  const last = i === WELCOME.length - 1;
  return (
    <div className="modal">
      <div className="dlg welcome" role="dialog" aria-labelledby="wel-t">
        <div className="welhead"><Logo size={30} /><span>소우주 PDF에 오신 것을 환영해요</span></div>
        <div className="welcard">
          <span className="welicon"><Icon name={s.icon} size={44} /></span>
          <span className="welstep">{i + 1} / {WELCOME.length}</span>
          <h3 id="wel-t">{s.title}</h3>
          <p>{s.text}</p>
        </div>
        <div className="weldots" aria-hidden="true">{WELCOME.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="acts">
          <button className="btn" onClick={onHelp}>도움말 보기</button>
          <span className="grow" />
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>이전</button>}
          <button className="btn navy" autoFocus onClick={() => (last ? onClose() : setI(i + 1))}>{last ? '시작하기' : '다음'}</button>
        </div>
        <p className="small muted welnote">도움말은 언제든 위쪽 <b>도움말</b> 버튼이나 키보드 <b>F1</b>로 열 수 있어요.</p>
      </div>
    </div>
  );
}
