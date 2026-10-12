// 인증서 전자서명: 공동인증서·인증서 파일(.pfx)·직접 만든 인증서로 PDF에 전자서명을 넣는다.
// 개인키와 암호는 이 창 안에서만 쓰고 어디에도 저장하거나 보내지 않는다
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { PageInfo, SignPrepare, SignState } from '../lib/protocol';
import { npkiList, saveFile, type NpkiEntry } from '../lib/host';
import type { CertInfo, SignCert } from '../lib/sign/certs';
import { Icon } from './Icon';

type Source =
  | { kind: 'npki'; entry: NpkiEntry; info: CertInfo }
  | { kind: 'pfx'; name: string; bytes: Uint8Array }
  | { kind: 'pair'; name: string; cert: Uint8Array; key: Uint8Array; info: CertInfo | null }
  | { kind: 'new' };

type Pos = 'br' | 'bl' | 'tr' | 'bc';
const POS: { id: Pos; label: string }[] = [
  { id: 'br', label: '오른쪽 아래' }, { id: 'bc', label: '가운데 아래' }, { id: 'bl', label: '왼쪽 아래' }, { id: 'tr', label: '오른쪽 위' },
];
const REASONS = ['', '내용을 확인했어요', '계약에 동의해요', '승인해요'];

const day = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
const stamp = (d: Date) => `${day(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

async function readFile(f: File) { return new Uint8Array(await f.arrayBuffer()); }

export function CertSignDialog({ client, pages, current, state, onClose, onSign }: {
  client: PdfClient;
  pages: PageInfo[];
  current: number;
  state: SignState | null;
  onClose: () => void;
  onSign: (sc: SignCert, o: SignPrepare, selfMade: boolean) => Promise<boolean>;
}) {
  const [found, setFound] = useState<{ entry: NpkiEntry; info: CertInfo }[] | null>(null);
  const [src, setSrc] = useState<Source | null>(null);
  const [pw, setPw] = useState('');
  const [newName, setNewName] = useState('');
  const [newOrg, setNewOrg] = useState('');
  const [pw2, setPw2] = useState('');
  const [visible, setVisible] = useState(true);
  const [where, setWhere] = useState<'cur' | 'first' | 'last'>('last');
  const [pos, setPos] = useState<Pos>('br');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await npkiList();
      const { peekCert } = await import('../lib/sign/certs');
      const rows = list.map((entry) => ({ entry, info: peekCert(entry.cert) })).filter((r): r is { entry: NpkiEntry; info: CertInfo } => !!r.info);
      rows.sort((a, b) => Number(a.info.expired) - Number(b.info.expired) || b.info.until.getTime() - a.info.until.getTime());
      if (alive) { setFound(rows); if (rows.length && !rows[0].info.expired) setSrc({ kind: 'npki', ...rows[0] }); }
    })();
    return () => { alive = false; };
  }, []);

  const pickFiles = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pfx,.p12,.der,.key';
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      setErr('');
      const pfx = files.find((f) => /\.(pfx|p12)$/i.test(f.name));
      if (pfx) { setSrc({ kind: 'pfx', name: pfx.name, bytes: await readFile(pfx) }); setPw(''); return; }
      const cert = files.find((f) => /\.der$/i.test(f.name)), key = files.find((f) => /\.key$/i.test(f.name));
      if (cert && key) {
        const { peekCert } = await import('../lib/sign/certs');
        const c = await readFile(cert);
        setSrc({ kind: 'pair', name: cert.name, cert: c, key: await readFile(key), info: peekCert(c) });
        setPw('');
        return;
      }
      setErr('공동인증서는 signCert.der와 signPri.key 두 파일을 함께 골라 주세요. 인증서 파일은 .pfx나 .p12예요.');
    };
    input.click();
  };

  const signer = src?.kind === 'npki' ? src.info.name : src?.kind === 'pair' ? src.info?.name ?? '' : src?.kind === 'new' ? newName.trim() : '';
  const now = useMemo(() => new Date(), []);
  const lines = [`전자서명: ${signer || '(인증서 이름)'}`, `일시: ${stamp(now)}`, ...(reason.trim() ? [`사유: ${reason.trim()}`] : [])];
  const page = where === 'cur' ? current : where === 'first' ? 0 : pages.length - 1;
  const info = pages[page] ?? pages[0];
  const bw = 190, bh = reason.trim() ? 62 : 50;
  const preset = (p: Pos): [number, number] => {
    const m = 30;
    return [p === 'bl' ? m : p === 'bc' ? (info.width - bw) / 2 : info.width - bw - m, p === 'tr' ? m : info.height - bh - m];
  };
  const [at, setAt] = useState<[number, number]>(() => preset('br'));
  useEffect(() => { setAt(preset(pos)); }, [pos, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (x: number, y: number): [number, number] => [Math.max(0, Math.min(info.width - bw, x)), Math.max(0, Math.min(info.height - bh, y))];
  const rect = (): [number, number, number, number] => { const [x, y] = clamp(at[0], at[1]); return [x, y, bw, bh]; };

  // 서명 상자를 놓을 쪽 미리 보기 (끌어서 자리 옮기기)
  const PH = 300, scale = PH / info.height;
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    let url = '';
    setImg(null);
    client.renderPng(page, scale * 2).then((b) => { url = URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' })); setImg(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [client, page, scale, visible]);
  const drag = useRef<{ dx: number; dy: number; pid: number } | null>(null);
  const prevBox = useRef<HTMLDivElement>(null);
  const local = (e: React.PointerEvent): [number, number] => {
    const r = prevBox.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  const ready = !!src && (src.kind === 'new' ? newName.trim() && pw.length >= 4 && pw === pw2 : pw.length > 0);

  const submit = async () => {
    if (!src || !ready) return;
    setBusy(true);
    setErr('');
    try {
      const certs = await import('../lib/sign/certs');
      let sc: SignCert;
      let name = signer;
      if (src.kind === 'npki') sc = certs.loadNpki(src.entry.cert, src.entry.key, pw);
      else if (src.kind === 'pair') sc = certs.loadNpki(src.cert, src.key, pw);
      else if (src.kind === 'pfx') { sc = certs.loadPfx(src.bytes, pw); name = certs.certInfo(sc.cert).name; }
      else {
        // 새로 만든 인증서는 다음에도 쓰도록 .pfx로 먼저 저장해 둔다
        await new Promise((r) => setTimeout(r, 30)); // "만드는 중" 안내가 먼저 보이게
        const made = certs.createSelfSigned(newName.trim(), newOrg.trim(), pw);
        const saved = await saveFile(`${newName.trim()}_서명용인증서.pfx`, made.pfx);
        if (!saved) { setBusy(false); return; }
        sc = made.sc;
      }
      const ci = certs.certInfo(sc.cert);
      if (ci.expired) throw new Error(`이 인증서는 ${day(ci.until)}에 기간이 끝났어요. 새 인증서로 서명해 주세요.`);
      const shown = [`전자서명: ${name || ci.name}`, ...lines.slice(1)];
      const ok = await onSign(sc, {
        page,
        rect: visible ? rect() : undefined,
        lines: shown,
        name: name || ci.name,
        reason: reason.trim() || undefined,
      }, src.kind === 'new');
      if (ok) onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const row = (key: string, on: boolean, title: string, sub: string, pick: () => void, dis = false) => (
    <label key={key} className={`opt${on ? ' on' : ''}${dis ? ' dis' : ''}`}>
      <input type="radio" name="cert" checked={on} disabled={dis} onChange={pick} />
      <span><b>{title}</b><small>{sub}</small></span>
    </label>
  );

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="dlg wide certdlg" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h3>인증서로 전자서명</h3>
        <p>인증서로 서명한 파일은 누가 서명했는지, 서명한 뒤에 바뀌지 않았는지를 받는 사람이 확인할 수 있어요. 서명한 파일은 따로 저장하고, 지금 문서는 그대로예요.</p>

        <fieldset>
          <legend>어떤 인증서로 서명할까요</legend>
          <div className="certlist">
            {found === null && <small className="muted">이 컴퓨터의 공동인증서를 찾는 중…</small>}
            {found?.map((r, i) => row(`n${i}`, src?.kind === 'npki' && src.entry === r.entry, r.info.name, `${r.info.issuer} · ${r.info.expired ? '기간 끝남' : `${day(r.info.until)}까지`}`, () => { setSrc({ kind: 'npki', ...r }); setPw(''); setErr(''); }, r.info.expired))}
            {src?.kind === 'pfx' && row('pfx', true, src.name, '인증서 파일', () => undefined)}
            {src?.kind === 'pair' && row('pair', true, src.info?.name ?? src.name, src.info ? `${src.info.issuer} · ${day(src.info.until)}까지` : '공동인증서 파일', () => undefined)}
            {row('new', src?.kind === 'new', '서명용 인증서 새로 만들기', '공동인증서가 없을 때. 기관 안에서 주고받는 문서에 알맞아요', () => { setSrc({ kind: 'new' }); setPw(''); setPw2(''); setErr(''); })}
          </div>
          <button type="button" className="btn pickcert" onClick={pickFiles}><Icon name="open" size={16} />인증서 파일 고르기</button>
          {found?.length === 0 && <small className="muted">이 컴퓨터에서 공동인증서를 찾지 못했어요. USB에 있다면 꽂은 뒤 다시 열거나, 파일을 직접 골라 주세요 (NPKI 폴더 안의 signCert.der, signPri.key).</small>}
        </fieldset>

        {src?.kind === 'new' ? (
          <div className="grid2">
            <div className="fieldcol">
              <label className="fieldlabel" htmlFor="cn">서명할 사람 이름</label>
              <input id="cn" className="field" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </div>
            <div className="fieldcol">
              <label className="fieldlabel" htmlFor="co">소속 (적지 않아도 돼요)</label>
              <input id="co" className="field" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} />
            </div>
            <div className="fieldcol">
              <label className="fieldlabel" htmlFor="cp1">인증서 암호 (4자 이상)</label>
              <input id="cp1" className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="fieldcol">
              <label className="fieldlabel" htmlFor="cp2">한 번 더</label>
              <input id="cp2" className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              {pw2 && pw !== pw2 && <small className="err">두 암호가 달라요.</small>}
            </div>
          </div>
        ) : src ? (
          <div className="fieldcol">
            <label className="fieldlabel" htmlFor="cpw">인증서 암호</label>
            <input id="cpw" className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="off" />
          </div>
        ) : null}

        <fieldset>
          <legend>서명 표시</legend>
          <div className="seg wide" role="radiogroup">
            <button type="button" role="radio" aria-checked={visible} className={visible ? 'on' : ''} onClick={() => setVisible(true)}>쪽에 서명 상자 보이기</button>
            <button type="button" role="radio" aria-checked={!visible} className={!visible ? 'on' : ''} onClick={() => setVisible(false)}>보이지 않게</button>
          </div>
          {visible && (
            <>
              <div className="grid2">
                <label className="fieldcol"><span className="fieldlabel">쪽</span>
                  <select className="field" value={where} onChange={(e) => setWhere(e.target.value as typeof where)}>
                    <option value="last">마지막 쪽</option><option value="first">첫 쪽</option><option value="cur">지금 보는 쪽 ({current + 1}쪽)</option>
                  </select>
                </label>
                <label className="fieldcol"><span className="fieldlabel">자리</span>
                  <select className="field" value={pos} onChange={(e) => setPos(e.target.value as Pos)}>
                    {POS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
              </div>
              <div
                ref={prevBox}
                className="signpage"
                style={{ width: info.width * scale, height: PH, backgroundImage: img ? `url(${img})` : undefined }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  prevBox.current!.setPointerCapture(e.pointerId);
                  const [x, y] = local(e);
                  const [ax, ay] = clamp(at[0], at[1]);
                  const inside = x >= ax && x <= ax + bw && y >= ay && y <= ay + bh;
                  // 상자를 잡으면 그대로 옮기고, 빈 곳을 누르면 그 자리로 상자를 옮긴다
                  const dx = inside ? x - ax : bw / 2, dy = inside ? y - ay : bh / 2;
                  drag.current = { dx, dy, pid: e.pointerId };
                  setAt(clamp(x - dx, y - dy));
                }}
                onPointerMove={(e) => { const d = drag.current; if (!d || d.pid !== e.pointerId) return; const [x, y] = local(e); setAt(clamp(x - d.dx, y - d.dy)); }}
                onPointerUp={() => { drag.current = null; }}
              >
                <div className="signbox" style={{ left: rect()[0] * scale, top: rect()[1] * scale, width: bw * scale, height: bh * scale, fontSize: Math.max(5, 9.5 * scale) }}>
                  {lines.map((l, i) => <span key={i} className={i === 0 ? 'b' : ''}>{l}</span>)}
                </div>
              </div>
              <small className="muted signhint">미리 보기에서 상자를 끌거나 놓을 곳을 눌러 자리를 옮길 수 있어요.</small>
            </>
          )}
          <label className="fieldcol"><span className="fieldlabel">서명 사유 (적지 않아도 돼요)</span>
            <input className="field" list="sign-reasons" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 40))} placeholder="예: 내용을 확인했어요" />
            <datalist id="sign-reasons">{REASONS.filter(Boolean).map((r) => <option key={r} value={r} />)}</datalist>
          </label>
        </fieldset>

        <p className="note warn"><Icon name="lock" size={16} />서명한 뒤에 파일을 고치면 서명이 깨져요. 고칠 것을 모두 마친 다음 마지막에 서명해 주세요.</p>
        {state && state.signatures > 0 && state.edited && <p className="note warn"><Icon name="shield" size={16} />이 문서에 이미 있던 서명 {state.signatures}개는 고친 내용 때문에 깨져요. 다른 사람의 서명을 지키려면 아무것도 고치지 않은 채로 서명해 주세요.</p>}
        {src?.kind === 'new' && <p className="note">새로 만든 인증서는 공인된 기관이 확인한 것이 아니어서, 받는 쪽 프로그램(아크로뱃 등)에서 "신원 확인 안 됨"으로 보일 수 있어요. 서명 뒤 문서가 바뀌지 않았는지는 그대로 확인돼요. 만든 인증서는 .pfx 파일로 먼저 저장해 두고 다음에 "인증서 파일 고르기"로 다시 써요.</p>}
        {err && <p className="err" role="alert">{err}</p>}

        <div className="acts">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>취소</button>
          <button type="submit" className="btn navy" disabled={!ready || busy}>{busy ? (src?.kind === 'new' ? '인증서 만드는 중…' : '서명하는 중…') : '서명하고 저장'}</button>
        </div>
      </form>
    </div>
  );
}
