import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { cleanImage, drawStamp, drawTypedSign, fileToDataUrl, hasTransparency, loadImage, loadMarks, loadSignFonts, loadStampFonts, newId, removeMark, saveMark, SIGN_FONTS, STAMP_FONTS, STAMP_RED, STAMP_STYLES, trimCanvas, type CleanMode, type Mark, type MarkKind, type StampStyle } from '../lib/library';

interface Props {
  kind: MarkKind;
  onClose: () => void;
  onPick: (m: Mark) => void;
}

const PT_PER_MM = 72 / 25.4;

/** 보관함: 전에 만든 서명·직인 */
function Library({ kind, onPick, version }: { kind: MarkKind; onPick: (m: Mark) => void; version: number }) {
  const [list, setList] = useState<Mark[]>([]);
  useEffect(() => { setList(loadMarks().filter((m) => m.kind === kind)); }, [kind, version]);
  if (!list.length) return null;
  return (
    <section className="lib">
      <h4>보관함 · 눌러서 바로 넣기</h4>
      <div className="libgrid">
        {list.map((m) => (
          <div key={m.id} className="libitem">
            <button className="libpick" onClick={() => onPick(m)} title={m.label || '이 서명 넣기'}><img src={m.src} alt={m.label || (kind === 'sign' ? '저장된 서명' : '저장된 직인')} /></button>
            <button className="libdel" aria-label="보관함에서 지우기" onClick={() => { removeMark(m.id); setList(loadMarks().filter((x) => x.kind === kind)); }}><Icon name="close" size={12} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 사진에서 서명·직인 가져오기 */
function FromPhoto({ kind, onReady }: { kind: MarkKind; onReady: (c: HTMLCanvasElement | null) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<CleanMode>(kind === 'stamp' ? 'red' : 'white');
  const [transparent, setTransparent] = useState(false);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState('');
  const input = useRef<HTMLInputElement>(null);
  /** 그림을 고르면 배경이 이미 투명한지 보고, 투명하면 손대지 않고 그대로 쓴다 */
  const take = async (f: File | undefined) => {
    if (!f || !/^image\/(png|jpeg|webp)$/.test(f.type)) return;
    const im = await loadImage(await fileToDataUrl(f));
    const t = hasTransparency(im);
    setTransparent(t);
    setMode(t ? 'none' : kind === 'stamp' ? 'red' : 'white');
    setImg(im);
  };
  useEffect(() => {
    if (!img) { onReady(null); return; }
    const c = trimCanvas(cleanImage(img, mode), 6);
    setPreview(c ? c.toDataURL('image/png') : '');
    onReady(c);
  }, [img, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="photo">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
      {preview ? (
        <div className="checker"><img src={preview} alt="배경을 지운 미리보기" /></div>
      ) : (
        <button
          className={`photodrop${over ? ' over' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        >
          <Icon name="photo" size={30} />
          <b>{kind === 'sign' ? '서명 사진이나 그림 파일 고르기' : '직인 사진이나 그림 파일 고르기'}</b>
          <small>JPG·PNG 모두 돼요. 배경이 투명한 PNG는 그대로 넣고, 종이 사진은 배경을 지워 드려요. 여기에 끌어다 놓아도 돼요</small>
        </button>
      )}
      {img && transparent && mode === 'none' && <p className="small">배경이 이미 투명한 그림이라 색과 모양을 그대로 넣어요.</p>}
      {img && (
        <div className="photoopts">
          <div className="seg" role="radiogroup" aria-label="배경 지우기 방식">
            <button role="radio" aria-checked={mode === 'white'} className={mode === 'white' ? 'on' : ''} onClick={() => setMode('white')}>흰 배경 지우기</button>
            <button role="radio" aria-checked={mode === 'red'} className={mode === 'red' ? 'on' : ''} onClick={() => setMode('red')}>빨간색만 남기기</button>
            <button role="radio" aria-checked={mode === 'none'} className={mode === 'none' ? 'on' : ''} onClick={() => setMode('none')}>그대로</button>
          </div>
          <button className="linkbtn" onClick={() => input.current?.click()}>다른 사진 고르기</button>
        </div>
      )}
    </div>
  );
}

/** 서명 그리기 패드 */
function DrawPad({ onReady }: { onReady: (c: HTMLCanvasElement | null) => void }) {
  const pad = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState('#111827');
  const [width, setWidth] = useState(6);
  const [empty, setEmpty] = useState(true);
  const last = useRef<[number, number] | null>(null);
  const pt = (e: React.PointerEvent): [number, number] => {
    const c = pad.current!, r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  };
  const clear = () => { pad.current!.getContext('2d')!.clearRect(0, 0, 1200, 480); setEmpty(true); onReady(null); };
  return (
    <div className="drawwrap">
      <canvas
        ref={pad} width={1200} height={480} className="sigpad" aria-label="서명을 그리는 칸"
        onPointerDown={(e) => {
          pad.current!.setPointerCapture(e.pointerId);
          const p = pt(e); last.current = p;
          const x = pad.current!.getContext('2d')!;
          x.fillStyle = color; x.beginPath(); x.arc(p[0], p[1], width / 2, 0, Math.PI * 2); x.fill();
          setEmpty(false);
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          const p = pt(e), x = pad.current!.getContext('2d')!;
          // 빨리 그을수록 조금 가늘게: 손글씨 느낌
          const dist = Math.hypot(p[0] - last.current[0], p[1] - last.current[1]);
          x.strokeStyle = color; x.lineCap = x.lineJoin = 'round';
          x.lineWidth = Math.max(width * 0.55, width * (1 - Math.min(dist, 60) / 140));
          x.beginPath(); x.moveTo(...last.current); x.lineTo(...p); x.stroke();
          last.current = p;
        }}
        onPointerUp={() => { last.current = null; onReady(trimCanvas(pad.current!, 10)); }}
        onPointerCancel={() => { last.current = null; }}
      />
      {empty && <span className="padhint">여기에 서명하세요</span>}
      <span className="padline" aria-hidden="true" />
      <div className="padtools">
        <div className="seg" role="radiogroup" aria-label="펜 색">
          {[['#111827', '검정'], ['#1D3FA8', '파랑']].map(([c, l]) => (
            <button key={c} role="radio" aria-checked={color === c} className={color === c ? 'on' : ''} onClick={() => setColor(c)}><span className="dotc" style={{ background: c }} />{l}</button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="펜 굵기">
          {[[4, '가늘게'], [6, '보통'], [9, '굵게']].map(([w, l]) => (
            <button key={w} role="radio" aria-checked={width === w} className={width === w ? 'on' : ''} onClick={() => setWidth(w as number)}>{l}</button>
          ))}
        </div>
        <button className="linkbtn" onClick={clear}>지우고 다시</button>
      </div>
    </div>
  );
}

/** 직인 만들기: 모양을 미리보기 목록에서 고른다 */
function MakeStamp({ onReady }: { onReady: (c: HTMLCanvasElement | null, style: StampStyle) => void }) {
  const [style, setStyle] = useState<StampStyle>('corp');
  const [name, setName] = useState('소우주사회적협동조합');
  const [inner, setInner] = useState('이사장');
  const [font, setFont] = useState(STAMP_FONTS[0].id);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { loadStampFonts().then(() => setFontsReady(true)); }, []);
  useEffect(() => {
    if (!fontsReady) return;
    const out: Record<string, string> = {};
    let chosen: HTMLCanvasElement | null = null;
    for (const st of STAMP_STYLES) {
      const c = drawStamp(st.id, name, inner, STAMP_RED, 400, font);
      out[st.id] = c.toDataURL('image/png');
      if (st.id === style) chosen = drawStamp(st.id, name, inner, STAMP_RED, 800, font);
    }
    setPreviews(out);
    onReady(name.trim() ? chosen : null, style);
  }, [name, inner, style, font, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const corp = style === 'corp' || style === 'corpFilled';
  return (
    <div className="makestamp2">
      <div className="stampfields">
        <div className="fieldcol">
          <label className="fieldlabel" htmlFor="stampname">{corp ? '테두리에 들어갈 기관 이름' : style === 'round' ? '도장에 들어갈 이름' : '직인에 들어갈 글자'}</label>
          <input id="stampname" className="field" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder={style === 'round' ? '예: 홍길동' : '예: 소우주사회적협동조합'} />
        </div>
        {corp && (
          <div className="fieldcol narrow">
            <label className="fieldlabel" htmlFor="stampinner">가운데 글자</label>
            <input id="stampinner" className="field" value={inner} maxLength={6} onChange={(e) => setInner(e.target.value)} placeholder="예: 대표이사" />
          </div>
        )}
      </div>
      <div className="stampfonts" role="radiogroup" aria-label="도장 글씨체">
        <span className="fieldlabel">글씨체</span>
        {STAMP_FONTS.map((f) => (
          <button key={f.id} role="radio" aria-checked={font === f.id} className={`fontchip${font === f.id ? ' on' : ''}`} style={{ fontFamily: f.css, fontWeight: f.weight }} onClick={() => setFont(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="stampgallery" role="radiogroup" aria-label="도장 모양">
        {STAMP_STYLES.map((st) => (
          <button key={st.id} role="radio" aria-checked={style === st.id} className={`stampcard${style === st.id ? ' on' : ''}`} onClick={() => setStyle(st.id)}>
            <span className="checker sc-prev">{previews[st.id] && <img src={previews[st.id]} alt="" />}</span>
            <b>{st.label}</b>
            <small>{st.hint}</small>
          </button>
        ))}
      </div>
      <p className="small warnnote">만든 직인은 문서 작성을 돕는 용도예요. 법적 효력이 필요한 서류에는 기관에 등록된 실제 인감을 쓰세요.</p>
    </div>
  );
}

/** 서명 만들기: 이름을 입력하면 손글씨 서명 후보를 보여 준다 */
function TypeSign({ onReady }: { onReady: (c: HTMLCanvasElement | null) => void }) {
  const [name, setName] = useState('');
  const [font, setFont] = useState(SIGN_FONTS[0].id);
  const [color, setColor] = useState('#111827');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { loadSignFonts().then(() => setFontsReady(true)); }, []);
  useEffect(() => {
    if (!fontsReady) return;
    const out: Record<string, string> = {};
    let chosen: HTMLCanvasElement | null = null;
    for (const f of SIGN_FONTS) {
      const c = drawTypedSign(name || '홍길동', f.css, f.scale, color);
      if (c) out[f.id] = c.toDataURL('image/png');
      if (f.id === font && name.trim()) chosen = c;
    }
    setPreviews(out);
    onReady(chosen);
  }, [name, font, color, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="typesign">
      <div className="stampfields">
        <div className="fieldcol">
          <label className="fieldlabel" htmlFor="signname">이름</label>
          <input id="signname" className="field" value={name} maxLength={16} autoFocus onChange={(e) => setName(e.target.value)} placeholder="이름을 입력하세요 (예: 홍길동)" />
        </div>
        <div className="fieldcol narrow">
          <span className="fieldlabel">색</span>
          <div className="seg" role="radiogroup" aria-label="글씨 색">
            {[['#111827', '검정'], ['#1D3FA8', '파랑']].map(([c, l]) => (
              <button key={c} role="radio" aria-checked={color === c} className={color === c ? 'on' : ''} onClick={() => setColor(c)}><span className="dotc" style={{ background: c }} />{l}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="signgallery" role="radiogroup" aria-label="글씨체">
        {SIGN_FONTS.map((f) => (
          <button key={f.id} role="radio" aria-checked={font === f.id} className={`signcard${font === f.id ? ' on' : ''}${name ? '' : ' sample'}`} onClick={() => setFont(f.id)}>
            <span className="sg-prev">{previews[f.id] && <img src={previews[f.id]} alt="" />}</span>
            <small>{f.label}</small>
          </button>
        ))}
      </div>
      {!name && <p className="small">이름을 입력하면 내 이름으로 바뀌어요. 마음에 드는 글씨체를 고르세요.</p>}
    </div>
  );
}

export function MarkDialog({ kind, onClose, onPick }: Props) {
  const tabs = kind === 'sign'
    ? [['draw', '직접 그리기'], ['type', '서명 만들기'], ['photo', '사진·그림 파일에서']]
    : [['make', '직인 만들기'], ['photo', '사진·그림 파일에서']];
  const [tab, setTab] = useState(tabs[0][0]);
  const [ready, setReady] = useState<HTMLCanvasElement | null>(null);
  const [style, setStyle] = useState<StampStyle>('corp');
  const [remember, setRemember] = useState(true);
  const [version] = useState(0);

  useEffect(() => { setReady(null); }, [tab]);

  const use = () => {
    if (!ready) return;
    const ratio = ready.height / ready.width;
    let w: number;
    if (kind === 'sign') w = 36 * PT_PER_MM;
    else if (tab === 'make') w = (style === 'round' ? 15 : style === 'square' ? 24 : 26) * PT_PER_MM;
    else w = 24 * PT_PER_MM;
    let h = w * ratio;
    if (kind === 'sign' && h > 18 * PT_PER_MM) { h = 18 * PT_PER_MM; w = h / ratio; }
    const m: Mark = { id: newId(), kind, src: ready.toDataURL('image/png'), w, h };
    if (remember) saveMark(m);
    onPick(m);
  };

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg markdlg" role="dialog" aria-labelledby="markdlg-t">
        <div className="dlghead">
          <h3 id="markdlg-t">{kind === 'sign' ? '서명 넣기' : '직인 넣기'}</h3>
          <button className="iconbtn" aria-label="닫기" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <Library kind={kind} onPick={onPick} version={version} />
        <div className="seg tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {tab === 'draw' && <DrawPad onReady={setReady} />}
        {tab === 'type' && <TypeSign onReady={setReady} />}
        {tab === 'make' && <MakeStamp onReady={(c, st) => { setReady(c); setStyle(st); }} />}
        {tab === 'photo' && <FromPhoto kind={kind} onReady={setReady} />}
        <div className="acts spread">
          <label className="chk"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 보관함에 저장해서 다음에도 쓰기</label>
          <div className="acts">
            <button className="btn" onClick={onClose}>취소</button>
            <button className="btn navy" onClick={use} disabled={!ready}>문서에 넣기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
