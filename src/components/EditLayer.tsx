import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PdfClient } from '../lib/pdfClient';
import type { PageInfo, ReplaceRequest, TextLine } from '../lib/protocol';
import { FONTS, guessFamily, type FontFamily } from '../lib/fonts';
import { buildReplace, selectedText, type EditStyle } from '../lib/textDiff';

interface Props {
  client: PdfClient;
  index: number;
  info: PageInfo;
  zoom: number;
  rev: number;
  onReplace: (req: ReplaceRequest) => void;
  onMessage: (m: string) => void;
  /** 고친 글자의 글꼴을 바꿀 수 있도록 바깥 막대에 알린다 */
  onEditing: (s: EditingState | null) => void;
  /** 입력 중인 글자 (오른쪽 패널의 "고치는 글자" 표시용) */
  onText: (t: string) => void;
  styleOverride: EditStyle | null;
  onStyle: (s: EditStyle) => void;
}

export interface EditingState {
  page: number;
  style: EditStyle;
  original: string;
  size: number;
  fontName: string;
}

interface Sel { li: number; i0: number; i1: number; style: EditStyle }

const quadBox = (q: number[]) => {
  const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

/** 글꼴 기준선 위치 계산용 (line-height:1 일 때 위쪽에서 기준선까지 비율) */
const metricCtx = document.createElement('canvas').getContext('2d')!;
function baselineRatio(family: FontFamily) {
  metricCtx.font = `400 100px ${FONTS[family].css}`;
  const m = metricCtx.measureText('가Hg');
  const A = (m.fontBoundingBoxAscent || 93) / 100, D = (m.fontBoundingBoxDescent || 24) / 100;
  return (1 - (A + D)) / 2 + A;
}

/** 글자 수정 모드에서 페이지 위에 겹치는 층: 줄 표시, 고르기, 고치는 입력칸 */
export function EditLayer({ client, index, info, zoom, rev, onReplace, onMessage, onEditing, onText, styleOverride, onStyle }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<TextLine[] | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [bg, setBg] = useState('#ffffff');
  const done = useRef(false);

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 화면에 보이는 페이지만 글자 정보를 읽는다
  useEffect(() => {
    if (!visible) return;
    let off = false;
    setSel(null);
    client.lines(index).then((l) => { if (!off) setLines(l); }).catch(() => setLines([]));
    return () => { off = true; };
  }, [client, index, rev, visible]);

  const style = sel ? styleOverride ?? sel.style : null;

  useEffect(() => {
    if (!sel || !lines) { onEditing(null); return; }
    const ref = lines[sel.li].chars[sel.i0];
    onEditing({ page: index, style: sel.style, original: selectedText(lines[sel.li], sel.i0, sel.i1), size: ref.size, fontName: ref.font.replace(/^[A-Z]{6}\+/, '').replace(/-\d{3,}$/, '') });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // 입력칸이 열리면 글자를 모두 고른 상태로 둔다
  useLayoutEffect(() => {
    const el = editor.current;
    if (!sel || !el) return;
    done.current = false;
    el.textContent = selectedText(lines![sel.li], sel.i0, sel.i1);
    onText(el.textContent);
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  }, [sel?.li, sel?.i0, sel?.i1]); // eslint-disable-line react-hooks/exhaustive-deps

  const pt = (e: React.PointerEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  /** 고른 글자 주변 배경색을 화면 그림에서 읽는다 (입력하는 동안 원래 글자를 가리는 용도) */
  const sampleBg = (box: { x0: number; y0: number; x1: number; y1: number }) => {
    const c = layer.current?.parentElement?.querySelector('canvas');
    if (!c || !c.width) return '#ffffff';
    const s = c.width / info.width;
    try {
      const d = c.getContext('2d')!.getImageData(Math.max(0, box.x0 * s - 3), Math.max(0, box.y0 * s - 3), Math.max(1, (box.x1 - box.x0) * s + 6), Math.max(1, (box.y1 - box.y0) * s + 6)).data;
      const hist = new Map<number, number>();
      let best = 0, bc = 0;
      for (let i = 0; i < d.length; i += 4) {
        const k = (d[i] >> 3 << 10) | (d[i + 1] >> 3 << 5) | (d[i + 2] >> 3);
        const v = (hist.get(k) || 0) + 1;
        hist.set(k, v);
        if (v > bc) { bc = v; best = k; }
      }
      const r = ((best >> 10) & 31) * 8 + 4, g = ((best >> 5) & 31) * 8 + 4, b = (best & 31) * 8 + 4;
      return `rgb(${r},${g},${b})`;
    } catch {
      return '#ffffff';
    }
  };

  const choose = (li: number, i0: number, i1: number) => {
    const line = lines![li];
    while (i0 <= i1 && !line.chars[i0].c.trim()) i0++;
    while (i1 >= i0 && !line.chars[i1].c.trim()) i1--;
    if (i1 < i0) return;
    const ref = line.chars[i0];
    const g = guessFamily(ref.font, ref.serif, ref.bold);
    const boxes = line.chars.slice(i0, i1 + 1).map((c) => quadBox(c.quad));
    setBg(sampleBg({ x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) }));
    setSel({ li, i0, i1, style: { family: g.family, bold: g.bold } });
  };

  const onDown = (e: React.PointerEvent) => {
    if (sel || !lines || e.button > 0) return;
    const p = pt(e);
    layer.current!.setPointerCapture(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pt(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (!drag || !lines) return;
    const d = drag;
    setDrag(null);
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    const isClick = (x1 - x0) * zoom < 5 && (y1 - y0) * zoom < 5;
    if (isClick) {
      const li = lines.findIndex((l) => d.x0 >= l.bbox[0] - 1 && d.x0 <= l.bbox[2] + 1 && d.y0 >= l.bbox[1] - 1 && d.y0 <= l.bbox[3] + 1);
      if (li < 0) { onMessage(lines.length ? '점선 상자로 표시된 글자를 누르거나 끌어서 골라 주세요.' : '이 페이지는 글자 정보가 없어요. 스캔한 문서일 수 있어요.'); return; }
      choose(li, 0, lines[li].chars.length - 1);
      return;
    }
    // 끌어서 고르기: 상자에 40% 이상 덮인 글자만 고른다
    let best = -1, bestCount = 0, bi0 = 0, bi1 = 0;
    lines.forEach((l, li) => {
      const hit: number[] = [];
      l.chars.forEach((c, i) => {
        const b = quadBox(c.quad);
        const ox = Math.max(0, Math.min(x1, b.x1) - Math.max(x0, b.x0)), oy = Math.max(0, Math.min(y1, b.y1) - Math.max(y0, b.y0));
        const area = Math.max(0.01, (b.x1 - b.x0) * (b.y1 - b.y0));
        if ((ox * oy) / area >= 0.4) hit.push(i);
      });
      if (hit.length > bestCount) { best = li; bestCount = hit.length; bi0 = hit[0]; bi1 = hit[hit.length - 1]; }
    });
    if (best < 0) { onMessage('고를 글자가 없어요. 글자 위를 끌어 주세요.'); return; }
    choose(best, bi0, bi1);
  };

  const finish = (commit: boolean) => {
    if (!sel || done.current) return;
    done.current = true;
    const text = (editor.current?.innerText ?? '').replace(/\n/g, ' ');
    const s = sel;
    setSel(null);
    if (!commit) return;
    const req = buildReplace(index, lines![s.li], s.i0, s.i1, text, styleOverride ?? s.style);
    if (req) onReplace(req);
  };

  const line = sel && lines ? lines[sel.li] : null;
  const start = line ? line.chars[sel!.i0] : null;
  const angle = line ? (Math.atan2(line.dir[1], line.dir[0]) * 180) / Math.PI : 0;
  const cover = line ? line.chars.slice(sel!.i0, sel!.i1 + 1).map((c) => quadBox(c.quad)) : [];

  return (
    <div
      ref={layer}
      className={`editlayer${sel ? ' editing' : ''}`}
      style={{ width: info.width * zoom, height: info.height * zoom }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {!sel && lines?.map((l, i) => (
        <div key={i} className="tline" style={{ left: l.bbox[0] * zoom, top: l.bbox[1] * zoom, width: (l.bbox[2] - l.bbox[0]) * zoom, height: (l.bbox[3] - l.bbox[1]) * zoom }} />
      ))}
      {drag && (
        <div className="dragbox" style={{ left: Math.min(drag.x0, drag.x1) * zoom, top: Math.min(drag.y0, drag.y1) * zoom, width: Math.abs(drag.x1 - drag.x0) * zoom, height: Math.abs(drag.y1 - drag.y0) * zoom }} />
      )}
      {cover.map((b, i) => (
        <div key={i} className="ecover" style={{ left: b.x0 * zoom - 1, top: b.y0 * zoom - 1, width: (b.x1 - b.x0) * zoom + 2, height: (b.y1 - b.y0) * zoom + 2, background: bg }} />
      ))}
      {start && style && (
        <span
          ref={editor}
          className="editor"
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck={false}
          style={{
            left: start.x * zoom,
            top: start.y * zoom,
            fontFamily: FONTS[style.family].css,
            fontWeight: style.bold ? 700 : 400,
            fontSize: start.size * zoom,
            color: `rgb(${start.color.map((v) => Math.round(v * 255)).join(',')})`,
            transform: `rotate(${angle}deg) translateY(${-baselineRatio(style.family) * start.size * zoom}px)`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onInput={(e) => onText((e.currentTarget as HTMLElement).innerText)}
          onKeyDown={(e) => {
            // 한글 입력 중(글자 조합 중)에 누른 Enter는 조합을 끝내는 키라서 적용하지 않는다.
            // 이걸 막지 않으면 마지막 글자가 빠지거나 두 번 들어간다
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
          }}
          onBlur={() => finish(true)}
        />
      )}
      {start && style && (
        <div
          className="minibar"
          role="toolbar"
          aria-label="고친 글자 모양"
          style={{ left: start.x * zoom, top: Math.max(4, (start.y - start.size * 1.1) * zoom - 50) }}
          onPointerDown={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="seg" role="radiogroup" aria-label="글꼴">
            {(Object.keys(FONTS) as FontFamily[]).map((f) => (
              <button key={f} role="radio" aria-checked={style.family === f} className={style.family === f ? 'on' : ''} style={{ fontFamily: FONTS[f].css }} onClick={() => onStyle({ ...style, family: f })}>{FONTS[f].label}</button>
            ))}
          </div>
          <button className={`mb-b${style.bold ? ' on' : ''}`} aria-pressed={style.bold} aria-label="굵게" onClick={() => onStyle({ ...style, bold: !style.bold })}>B</button>
          <span className="mb-sep" aria-hidden="true" />
          <button className="mb-ok" onClick={() => finish(true)}>적용<small>Enter</small></button>
          <button className="mb-no" onClick={() => finish(false)}>취소<small>Esc</small></button>
        </div>
      )}
    </div>
  );
}
