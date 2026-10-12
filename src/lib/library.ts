// 서명·직인 보관함과 이미지 다듬기 도구
export type MarkKind = 'sign' | 'stamp';

export interface Mark {
  id: string;
  kind: MarkKind;
  /** 투명 배경 PNG */
  src: string;
  /** 넣을 때 기본 크기 (pt) */
  w: number;
  h: number;
  label?: string;
}

const KEY = 'sowuju.marks';
const MAX = 12;

export function loadMarks(): Mark[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function saveMark(m: Mark) {
  const list = [m, ...loadMarks().filter((x) => x.id !== m.id && x.src !== m.src)];
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* 저장 공간이 꽉 차도 이번에는 쓸 수 있다 */ }
}
export function removeMark(id: string) {
  try { localStorage.setItem(KEY, JSON.stringify(loadMarks().filter((x) => x.id !== id))); } catch { /* 무시 */ }
}
export const newId = () => Math.random().toString(36).slice(2, 10);

/** 투명하지 않은 부분만 남기고 잘라낸다 */
export function trimCanvas(c: HTMLCanvasElement, margin = 8): HTMLCanvasElement | null {
  const x = c.getContext('2d')!;
  const { width: W, height: H } = c;
  const d = x.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) if (d[(y * W + i) * 4 + 3] > 10) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin); x1 = Math.min(W - 1, x1 + margin); y1 = Math.min(H - 1, y1 + margin);
  const o = document.createElement('canvas');
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d')!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

export type CleanMode = 'white' | 'red' | 'none';

/** 배경이 이미 투명한 그림인지 (투명하거나 반투명한 부분이 2% 넘게 있으면) */
export function hasTransparency(img: HTMLImageElement): boolean {
  const s = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0, c.width, c.height);
  const a = x.getImageData(0, 0, c.width, c.height).data;
  let t = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] < 200) t++;
  return t / (a.length / 4) > 0.02;
}

/** 사진에서 배경 지우기: 흰 배경을 투명하게, 또는 빨간 인주만 남기기 */
export function cleanImage(img: HTMLImageElement, mode: CleanMode, maxSide = 1400): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0, c.width, c.height);
  if (mode === 'none') return c;
  const id = x.getImageData(0, 0, c.width, c.height), a = id.data;
  // 종이 밝기는 사진마다 달라서, 가장 밝은 쪽 값을 기준으로 삼는다
  let bright = 0;
  for (let i = 0; i < a.length; i += 16) bright = Math.max(bright, (a[i] + a[i + 1] + a[i + 2]) / 3);
  const paper = Math.max(160, bright - 18);
  for (let i = 0; i < a.length; i += 4) {
    const r = a[i], g = a[i + 1], b = a[i + 2], l = (r + g + b) / 3;
    if (mode === 'white') {
      if (l >= paper) a[i + 3] = 0;
      else if (l > paper - 50) a[i + 3] = Math.round(a[i + 3] * (paper - l) / 50);
    } else {
      const red = r - Math.max(g, b);
      if (red < 35) a[i + 3] = 0;
      else {
        a[i + 3] = Math.min(255, Math.round((red - 35) * 3.2));
        // 인주 색을 고르게: 빨강은 살리고 어두운 얼룩은 줄인다
        a[i] = Math.max(r, 190); a[i + 1] = Math.min(g, 40); a[i + 2] = Math.min(b, 45);
      }
    }
  }
  x.putImageData(id, 0, 0);
  return c;
}

export const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
export const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
export function dataUrlBytes(u: string) {
  const b = atob(u.split(',')[1]), a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}

export const STAMP_RED = '#C8102E';

/** 서명 만들기에 쓰는 손글씨 글꼴 */
export const SIGN_FONTS: { id: string; label: string; css: string; scale: number }[] = [
  { id: 'pen', label: '펜글씨', css: "'NanumPenScript'", scale: 1.15 },
  { id: 'brush', label: '붓글씨', css: "'NanumBrushScript'", scale: 1.15 },
  { id: 'gaegu', label: '또박또박', css: "'Gaegu'", scale: 1 },
  { id: 'dokdo', label: '힘찬 글씨', css: "'EastSeaDokdo'", scale: 1.25 },
];

export async function loadSignFonts() {
  await Promise.all([...SIGN_FONTS.map((f) => document.fonts.load(`80px ${f.css}`)), document.fonts.load("700 40px 'NanumMyeongjo'")]).catch(() => undefined);
}

/** 입력한 이름을 손글씨 서명으로 그린다 (살짝 기울여 손으로 쓴 느낌) */
export function drawTypedSign(name: string, fontCss: string, scale: number, color: string): HTMLCanvasElement | null {
  const text = name.trim();
  if (!text) return null;
  const c = document.createElement('canvas');
  c.width = 1400; c.height = 480;
  const x = c.getContext('2d')!;
  const size = 220 * scale;
  x.font = `${size}px ${fontCss}, cursive`;
  const w = x.measureText(text).width;
  const fit = Math.min(1, 1250 / w);
  x.translate(700, 290);
  x.rotate(-0.06);
  x.scale(fit, fit);
  x.fillStyle = color;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 0, 0);
  return trimCanvas(c, 12);
}

export type StampStyle = 'corp' | 'corpFilled' | 'square' | 'round';

export const STAMP_STYLES: { id: StampStyle; label: string; hint: string }[] = [
  { id: 'corp', label: '법인 원형 인감', hint: '테두리에 기관 이름, 가운데에 직함' },
  { id: 'corpFilled', label: '원형 인감 (채움)', hint: '빨간 바탕에 흰 글자' },
  { id: 'square', label: '네모 직인', hint: '기관 이름을 세로로' },
  { id: 'round', label: '개인 도장', hint: '이름 두세 글자' },
];

const STAMP_FONT = "'NanumMyeongjo', serif";

/** 칸에 맞춰 가로·세로를 따로 늘려 글자 하나를 그린다 (도장 글씨 느낌) */
function fillChar(x: CanvasRenderingContext2D, chr: string, cx: number, cy: number, cw: number, ch: number) {
  x.font = `700 100px ${STAMP_FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  const m = x.measureText(chr);
  const gw = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || 100;
  const gh = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || 100;
  // 칸 모양대로 늘리되, 너무 납작하거나 홀쭉해지지 않게 한도를 둔다
  let sx = (cw * 0.9) / gw, sy = (ch * 0.9) / gh;
  if (sx > sy * 1.35) sx = sy * 1.35;
  if (sy > sx * 1.9) sy = sx * 1.9;
  x.save();
  x.translate(cx, cy);
  x.scale(sx, sy);
  x.fillText(chr, (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  x.restore();
}

/** 글자들을 칸으로 나눠 채운다. vertical: 오른쪽 줄부터 위→아래(전통 직인), 아니면 위 줄부터 왼→오른쪽 */
function fillGrid(x: CanvasRenderingContext2D, chars: string[], left: number, top: number, w: number, h: number, vertical: boolean) {
  const n = chars.length;
  if (!n) return;
  const lines = n <= 2 ? (vertical ? n : 1) : n === 3 ? (vertical ? 1 : 3) : Math.ceil(Math.sqrt(n));
  const per = Array.from({ length: lines }, (_, k) => Math.floor(n / lines) + (k < n % lines ? 1 : 0));
  let k = 0;
  per.forEach((cnt, line) => {
    for (let j = 0; j < cnt; j++, k++) {
      if (vertical) {
        const cw = w / lines, ch = h / cnt;
        fillChar(x, chars[k], left + w - cw * line - cw / 2, top + ch * j + ch / 2, cw, ch);
      } else {
        const ch = h / lines, cw = w / cnt;
        fillChar(x, chars[k], left + cw * j + cw / 2, top + ch * line + ch / 2, cw, ch);
      }
    }
  });
}

/** 둥근 테두리를 따라 글자를 놓는다. 맨 위(별 자리)를 비우고 시계 방향으로 */
function ringText(x: CanvasRenderingContext2D, chars: string[], cx: number, cy: number, r: number, size: number, color: string) {
  const n = chars.length;
  if (!n) return;
  const gap = 0.55; // 맨 위 비우는 각도(라디안)
  const span = Math.min(Math.PI * 2 - gap * 2, n * (size * 1.08) / r);
  const start = -Math.PI / 2 + gap + (Math.PI * 2 - gap * 2 - span) / 2;
  x.fillStyle = color;
  chars.forEach((chr, i) => {
    const a = start + span * ((i + 0.5) / n);
    x.save();
    x.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    x.rotate(a + Math.PI / 2);
    fillChar(x, chr, 0, 0, size * 0.92, size);
    x.restore();
  });
}

function star(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
    x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  x.closePath();
  x.fill();
}

/**
 * 직인 그리기.
 * corp: 법인 원형 인감(테두리에 기관 이름, 가운데 원에 직함), corpFilled: 같은 모양의 빨간 채움형,
 * square: 네모 직인(오른쪽 줄부터 세로), round: 개인 도장(동그라미).
 */
export function drawStamp(style: StampStyle, name: string, inner = '', color = STAMP_RED, size = 640): HTMLCanvasElement {
  const chars = [...name.replace(/\s+/g, '')];
  const innerChars = [...inner.replace(/\s+/g, '')];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  const mid = size / 2;
  x.fillStyle = color;
  x.strokeStyle = color;

  if (style === 'square') {
    const b = size * 0.055;
    x.lineWidth = b;
    x.strokeRect(b / 2 + 6, b / 2 + 6, size - b - 12, size - b - 12);
    const pad = b + size * 0.06;
    fillGrid(x, chars, pad, pad, size - pad * 2, size - pad * 2, true);
    return c;
  }
  if (style === 'round') {
    const b = size * 0.05;
    x.lineWidth = b;
    x.beginPath(); x.arc(mid, mid, mid - b / 2 - 6, 0, Math.PI * 2); x.stroke();
    const pad = size * 0.22;
    fillGrid(x, chars, pad, pad, size - pad * 2, size - pad * 2, true);
    return c;
  }
  // 법인 원형 인감
  const R = mid - 8;
  const filled = style === 'corpFilled';
  const ink = filled ? '#FFFFFF' : color;
  const innerR = R * 0.5;
  if (filled) {
    x.beginPath(); x.arc(mid, mid, R, 0, Math.PI * 2); x.fill();
    x.strokeStyle = ink; x.lineWidth = size * 0.012;
    x.beginPath(); x.arc(mid, mid, R * 0.93, 0, Math.PI * 2); x.stroke();
  } else {
    x.lineWidth = size * 0.035;
    x.beginPath(); x.arc(mid, mid, R - size * 0.0175, 0, Math.PI * 2); x.stroke();
  }
  x.strokeStyle = ink; x.fillStyle = ink;
  x.lineWidth = size * (filled ? 0.016 : 0.028);
  x.beginPath(); x.arc(mid, mid, innerR, 0, Math.PI * 2); x.stroke();
  // 테두리 글자: 바깥 원과 안쪽 원 사이 띠의 가운데
  const band = R * (filled ? 0.93 : 0.95) - innerR;
  const ringR = innerR + band / 2;
  const fontSize = Math.min(band * 0.62, (2 * Math.PI * ringR * 0.8) / Math.max(chars.length, 1) / 1.08);
  star(x, mid, mid - ringR, band * 0.2);
  ringText(x, chars, mid, mid, ringR, fontSize, ink);
  x.fillStyle = ink;
  const box = innerR * 1.25;
  fillGrid(x, innerChars, mid - box / 2, mid - box / 2, box, box, false);
  return c;
}
