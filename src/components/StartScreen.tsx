import { useEffect, useState } from 'react';
import { Icon, Logo } from './Icon';
import { VersionInfo } from './UpdateBar';
import { isApp, recentList, type RecentFile } from '../lib/host';

export type QuickAction = 'edit' | 'sign' | 'merge' | 'pages' | 'print' | 'privacy';

interface Props {
  easy: boolean;
  easyScale: number;
  onEasy: (on: boolean) => void;
  onEasyScale: (s: number) => void;
  onOpen: (then?: QuickAction) => void;
  onOpenRecent: (r: RecentFile) => void;
  onHelp: () => void;
}

const QUICK: { id: QuickAction; icon: string; title: string; sub: string; ready: boolean }[] = [
  { id: 'edit', icon: 'edit', title: '글자 고치기', sub: '원래 모양 그대로', ready: true },
  { id: 'sign', icon: 'sign', title: '서명·직인', sub: '한 번 그리면 계속', ready: true },
  { id: 'merge', icon: 'merge', title: '합치기', sub: 'PDF·사진을 하나로', ready: true },
  { id: 'pages', icon: 'pages', title: '페이지 정리', sub: '순서·회전·삭제', ready: true },
  { id: 'print', icon: 'print', title: '인쇄', sub: '선명하게, 원하는 쪽만', ready: true },
  { id: 'privacy', icon: 'shield', title: '개인정보 지우기', sub: '흔적 없이 완전히', ready: true },
];

function when(t: number) {
  const d = new Date(t), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay) return `오늘 ${d.getHours() < 12 ? '오전' : '오후'} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === y.toDateString()) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function StartScreen({ easy, easyScale, onEasy, onEasyScale, onOpen, onOpenRecent, onHelp }: Props) {
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => { recentList().then(setRecent); }, []);
  const shown = recent.filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase())).slice(0, 4);

  if (easy) {
    return (
      <div className="start easy">
        <header className="easybar">
          <Logo size={40} />
          <span className="easybrand">소우주 PDF</span>
          <span className="easytag">쉬운 모드</span>
          <div className="easyright">
            <div role="group" aria-label="글씨 크기" className="seg big">
              {[1, 1.15, 1.3].map((s, i) => (
                <button key={s} aria-pressed={easyScale === s} className={easyScale === s ? 'on' : ''} style={{ fontSize: 18 + i * 4 }} onClick={() => onEasyScale(s)} aria-label={['글씨 보통', '글씨 크게', '글씨 아주 크게'][i]}>가</button>
              ))}
            </div>
            <button className="btn xl" onClick={onHelp}><Icon name="help" size={22} />도움말</button>
            <button className="btn xl" onClick={() => onEasy(false)}>일반 화면으로</button>
          </div>
        </header>
        <main className="easymain">
          <div className="easyhead">
            <h1>무엇을 도와드릴까요?</h1>
            <p>아래에서 하고 싶은 일을 하나 눌러 주세요.</p>
          </div>
          <div className="easygrid">
            {(['edit', 'print', 'pages', 'sign'] as QuickAction[]).map((id) => QUICK.find((q) => q.id === id)!).map((q, i) => (
              <button key={q.id} className={`easytile${i === 0 ? ' primary' : ''}`} onClick={() => onOpen(q.id)} disabled={!q.ready}>
                <span className="easyicon"><Icon name={q.icon} size={58} /></span>
                <span className="easyt">{q.title}</span>
                <span className="easys">{q.ready ? q.sub : '다음 버전에서 쓸 수 있어요'}</span>
              </button>
            ))}
          </div>
          <ol className="steps" aria-label="진행 순서">
            <li className="on"><span>1</span>할 일 고르기</li><li className="ln" aria-hidden="true" />
            <li><span>2</span>파일 고르기</li><li className="ln" aria-hidden="true" />
            <li><span>3</span>고치기</li><li className="ln" aria-hidden="true" />
            <li><span>4</span>저장 또는 인쇄</li>
          </ol>
          <div className="easyhelp">
            <span>실수해도 <b>되돌리기</b>로 다시 고칠 수 있어요. 파일은 이 컴퓨터 밖으로 나가지 않아요.</span>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="start">
      <header className="startbar">
        <div className="brandrow"><Logo size={28} /><span>소우주 PDF</span></div>
        <label className="search">
          <Icon name="search" size={17} />
          <input type="search" placeholder="최근 문서 찾기" aria-label="최근 문서 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="startright">
          <button className="pill" onClick={onHelp} title="도움말 (F1)"><Icon name="help" size={16} />도움말</button>
          <button className="pill" onClick={() => onEasy(true)} aria-pressed={false}>
            쉬운 모드<span className="switch" aria-hidden="true"><span /></span>
          </button>
        </div>
      </header>

      <main className="startmain">
        <section className="hero">
          <div className="herotext">
            <span className="eyebrow">광고 없이, 내 컴퓨터 안에서</span>
            <h1>어떤 문서를<br />열어 볼까요?</h1>
            <p>고칠 글자만 골라 원래 모양 그대로 바꾸고, 페이지를 정리하고, 선명하게 인쇄까지 한곳에서 끝낼 수 있어요.</p>
            <div className="heroacts">
              <button className="btn primary lg" onClick={() => onOpen()}><Icon name="open" />PDF 열기</button>
            </div>
          </div>
          <button className="dropzone" onClick={() => onOpen()} aria-label="PDF 열기 (파일을 끌어다 놓아도 돼요)">
            <span className="stack" aria-hidden="true">
              <span className="s1" /><span className="s2" />
              <span className="s3"><i className="l1" /><i /><i className="l3" /><i className="l4" /><i className="l5" /></span>
            </span>
            <span className="dzt">여기에 파일을 끌어다 놓으세요</span>
            <span className="dzs">{isApp ? 'PDF·한글·워드·엑셀 파일을 놓으면 바로 열려요' : 'PDF 파일을 놓으면 바로 열려요'}</span>
          </button>
        </section>

        <section aria-labelledby="quick" className="block">
          <h2 id="quick">바로 시작하기</h2>
          <div className="quick">
            {QUICK.map((q) => (
              <button key={q.id} className="qtile" onClick={() => onOpen(q.id)} disabled={!q.ready} title={q.ready ? undefined : '다음 버전에서 추가돼요'}>
                <Icon name={q.icon} size={26} />
                <span><b>{q.title}</b><small>{q.ready ? q.sub : '곧 추가돼요'}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="recent" className="block">
          <h2 id="recent">최근 문서</h2>
          {shown.length ? (
            <div className="recent">
              {shown.map((r) => (
                <button key={r.path} className="rcard" onClick={() => onOpenRecent(r)} title={r.path}>
                  <span className="mini" aria-hidden="true"><i className="t" /><i className="b" /><i /><i className="s" /></span>
                  <span className="rtext"><b>{r.name.replace(/\.pdf$/i, '')}</b><small>{r.pages ? `${r.pages}쪽 · ` : ''}{when(r.openedAt)}</small></span>
                </button>
              ))}
            </div>
          ) : (
            <p className="emptynote">{isApp ? (query ? '찾는 문서가 없어요.' : '아직 연 문서가 없어요. PDF를 열면 여기에 보여요.') : '최근 문서는 설치형 프로그램에서 보여요.'}</p>
          )}
        </section>

        <footer className="startfoot"><Icon name="shield" size={14} />광고 없음 · 회원가입 없음 · 파일은 이 컴퓨터 밖으로 나가지 않아요 · 소우주사회적협동조합이 만든 공개 소프트웨어<VersionInfo /></footer>
      </main>
    </div>
  );
}
