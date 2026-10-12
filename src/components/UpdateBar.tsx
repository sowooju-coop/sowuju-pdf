import { printerApi, type PrinterStatus } from '../lib/host';
import { useEffect, useState } from 'react';
import type { UpdateState } from '../lib/host';
import { Icon } from './Icon';

/** 설치형 업데이트 상태를 받아 온다 (브라우저에서는 항상 null) */
function useUpdate() {
  const [st, setSt] = useState<UpdateState | null>(null);
  useEffect(() => {
    const host = window.sowuju;
    if (!host?.onUpdate) return;
    host.updateState().then(setSt);
    return host.onUpdate(setSt);
  }, []);
  return st;
}

/** 새 버전을 다 받았을 때 화면 아래에 뜨는 알림 */
export function UpdateBar() {
  const st = useUpdate();
  const [later, setLater] = useState<string | null>(null);
  if (!st) return null;
  if (st.status === 'downloading') {
    return <div className="updatebar quiet" role="status"><Icon name="save" size={15} />새 버전 {st.version} 받는 중 {st.percent}%</div>;
  }
  if (st.status !== 'ready' || later === st.version) return null;
  return (
    <div className="updatebar" role="alert">
      <Icon name="shieldCheck" size={18} />
      <span><b>새 버전 {st.version}을 받아 두었어요.</b> 다시 시작하면 바뀌어요.</span>
      <button className="btn sm navy" onClick={() => window.sowuju?.installUpdate()}>지금 다시 시작</button>
      <button className="btn sm" onClick={() => setLater(st.version)} title="프로그램을 끌 때 저절로 바뀌어요">나중에</button>
    </div>
  );
}

/** 시작 화면 아래: 지금 버전과 업데이트 확인 */
/** "소우주 PDF" 프린터 추가·빼기 (Windows 설치형만 보임) */
function PrinterSetting() {
  const [st, setSt] = useState<PrinterStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { printerApi.status().then(setSt).catch(() => {}); }, []);
  if (!st?.supported) return null;
  const run = async (fn: () => Promise<PrinterStatus | { error: string }>, ok: string) => {
    setBusy(true); setMsg('Windows 허용 창이 뜨면 "예"를 눌러 주세요…');
    try {
      const r = await fn();
      if ('error' in r && r.error && !('supported' in r)) setMsg(r.error);
      else { setSt(r as PrinterStatus); setMsg(ok); }
    } finally { setBusy(false); }
  };
  return (
    <span className="prnset" title="한글·워드·엑셀 등의 인쇄 창에서 '소우주 PDF'를 고르면 이 프로그램으로 열려요">
      {st.installed
        ? <>프린터 목록에 있어요 <button className="linkbtn" disabled={busy} onClick={() => run(printerApi.remove, '프린터 목록에서 뺐어요.')}>빼기</button></>
        : <button className="linkbtn" disabled={busy} onClick={() => run(printerApi.install, '이제 다른 프로그램의 인쇄 창에서 "소우주 PDF"를 고를 수 있어요.')}>프린터 목록에 '소우주 PDF' 넣기</button>}
      {msg && <span className="muted">{msg}</span>}
    </span>
  );
}

export function VersionInfo() {
  const st = useUpdate();
  const [ver, setVer] = useState('');
  const [asked, setAsked] = useState(false);
  const [auto, setAuto] = useState(true);
  useEffect(() => { window.sowuju?.appVersion?.().then(setVer); window.sowuju?.getAutoUpdate?.().then(setAuto); }, []);
  if (!window.sowuju?.appVersion) return null;
  const msg = !asked || !st ? '' :
    st.status === 'checking' ? '확인하는 중…' :
    st.status === 'latest' ? '지금이 최신 버전이에요.' :
    st.status === 'downloading' ? `새 버전 ${st.version} 받는 중 ${st.percent}%` :
    st.status === 'ready' ? `새 버전 ${st.version} 준비 완료` :
    st.status === 'error' ? '확인하지 못했어요. 인터넷 연결을 확인하세요.' :
    st.status === 'dev' ? '개발 중에는 확인하지 않아요.' : '';
  return (
    <span className="verinfo">
      버전 {ver}
      <button className="linkbtn" onClick={() => { setAsked(true); window.sowuju?.checkUpdate(); }}>업데이트 확인</button>
      <label className="autoupd" title="끄면 '업데이트 확인'을 누를 때만 새 버전을 확인해요">
        <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); window.sowuju?.setAutoUpdate(e.target.checked); }} />자동 확인
      </label>
      {msg && <span className="muted">{msg}</span>}
      <PrinterSetting />
    </span>
  );
}
