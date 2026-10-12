// 서명·직인 보관함과 이미지 다듬기 도구
export type MarkKind = 'sign' | 'stamp' | 'image';

/** 화면에 쓰는 이름 */
export const markName = (k: MarkKind) => (k === 'sign' ? '서명' : k === 'stamp' ? '직인' : '그림');

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

/** 도장 글꼴 (모두 OFL). weight 는 글꼴에 굵은 꼴이 있을 때만 */
// 한글 글꼴에는 한자가 없어서, 한자는 명조 계열이면 본명조, 고딕 계열이면 본고딕(상용 한자 4,888자만 담은 것)으로 그린다
const HANJA_SERIF = "'NotoHanjaSerif'", HANJA_SANS = "'NotoHanjaSans'";
export const STAMP_FONTS: { id: string; label: string; css: string; weight: number; hanja: string }[] = [
  { id: 'myeongjo', label: '명조', css: "'NanumMyeongjo'", weight: 700, hanja: HANJA_SERIF },
  { id: 'songmyung', label: '붓 명조', css: "'SongMyung'", weight: 400, hanja: HANJA_SERIF },
  { id: 'blackhan', label: '굵은 고딕', css: "'BlackHanSans'", weight: 400, hanja: HANJA_SANS },
  { id: 'dohyeon', label: '인장체', css: "'DoHyeon'", weight: 400, hanja: HANJA_SANS },
];

let stampFont = STAMP_FONTS[0];

export async function loadStampFonts() {
  await Promise.all([
    ...STAMP_FONTS.map((f) => document.fonts.load(`${f.weight} 40px ${f.css}`, '인감')),
    document.fonts.load(`700 40px ${HANJA_SERIF}`, '理'),
    document.fonts.load(`700 40px ${HANJA_SANS}`, '理'),
  ]).catch(() => undefined);
}

/** 가운데 글자로 자주 쓰는 직함 (한글, 한자) */
export const STAMP_TITLES: [string, string][] = [
  ['대표이사', '代表理事'], ['이사장', '理事長'], ['대표', '代表'], ['원장', '院長'], ['관장', '館長'], ['회장', '會長'],
];

/** 기관 이름에 맞는 기본 직함: 협동조합 등 조합은 이사장, 그 밖에는 대표이사 */
export function titleFor(name: string, hanja: boolean) {
  const t = STAMP_TITLES[/조합/.test(name) ? 1 : 0];
  return hanja ? t[1] : t[0];
}

/** 칸에 맞춰 가로·세로를 따로 늘려 글자 하나를 그린다 (도장 글씨 느낌) */
function fillChar(x: CanvasRenderingContext2D, chr: string, cx: number, cy: number, cw: number, ch: number, maxWide = 1.35): number {
  // (주)·(사) 같은 칸: 가운데 글자를 크게 그리고, 괄호는 그 바로 양옆에 가늘고 길게
  if (chr.length > 2 && chr[0] === '(') {
    const pw = cw * 0.16;
    const iw = fillChar(x, chr.slice(1, -1), cx, cy, cw - pw * 2, ch * 0.8, maxWide);
    const off = iw / 2 + pw * 0.55;
    fillChar(x, '(', cx - off, cy, pw, ch);
    fillChar(x, ')', cx + off, cy, pw, ch);
    return iw + pw * 2;
  }
  x.font = `${stampFont.weight} 100px ${stampFont.css}, ${stampFont.hanja}, serif`;
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  const m = x.measureText(chr);
  const gw = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || 100;
  const gh = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || 100;
  // 칸 모양대로 늘리되, 너무 납작하거나 홀쭉해지지 않게 한도를 둔다
  let sx = (cw * 0.9) / gw, sy = (ch * 0.9) / gh;
  if (sx > sy * maxWide) sx = sy * maxWide;
  if (sy > sx * 1.9) sy = sx * 1.9;
  x.save();
  x.translate(cx, cy);
  x.scale(sx, sy);
  x.fillText(chr, (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  x.restore();
  return gw * sx;
}

/** 글자들을 칸으로 나눠 채운다. vertical: 오른쪽 줄부터 위→아래(전통 직인), 아니면 위 줄부터 왼→오른쪽 */
function fillGrid(x: CanvasRenderingContext2D, chars: string[], left: number, top: number, w: number, h: number, vertical: boolean) {
  const n = chars.length;
  if (!n) return;
  const lines = n <= 2 ? (vertical ? n : 1) : n === 3 ? (vertical ? 2 : 1) : Math.ceil(Math.sqrt(n));
  // 세 글자 세로는 오른쪽 줄에 성 한 글자, 왼쪽 줄에 이름 두 글자 (도장 관례)
  const per = vertical && n === 3 ? [1, 2] : Array.from({ length: lines }, (_, k) => Math.floor(n / lines) + (k < n % lines ? 1 : 0));
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

/**
 * 둥근 테두리를 따라 글자를 놓는다. 맨 위는 별 자리로 비우고 시계 방향으로.
 * 글자 수와 상관없이 테두리를 한 바퀴 꽉 채우도록 간격과 글자 폭을 맞춘다.
 */
function ringText(x: CanvasRenderingContext2D, chars: string[], cx: number, cy: number, r: number, band: number, color: string) {
  const n = chars.length;
  if (!n) return;
  // (주)처럼 괄호로 묶은 칸은 1.5칸 폭을 준다
  const wt = chars.map((c) => (c.length > 2 ? 1.5 : 1));
  const total = wt.reduce((a, b) => a + b, 0);
  // 별도 글자 한 칸처럼 쳐서 고르게 나누되, 글자가 많아도 별 자리는 남긴다
  const starSlot = Math.max((Math.PI * 2) / (total + 1), (band * 0.75) / r);
  const pitch = (Math.PI * 2 - starSlot) / total;
  const h = band * 0.64;
  x.fillStyle = color;
  let at = -Math.PI / 2 + starSlot / 2;
  chars.forEach((chr, i) => {
    const a = at + (pitch * wt[i]) / 2;
    at += pitch * wt[i];
    // 글자가 적으면 옆으로 넓혀 빈틈을 줄인다
    const w = Math.min(pitch * wt[i] * r * 0.8, h * 1.8 * wt[i]);
    x.save();
    x.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    x.rotate(a + Math.PI / 2);
    fillChar(x, chr, 0, 0, w / 0.9, h / 0.9, 1.8);
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

/** 도장에 넣을 글자 단위로 나눈다. (주)·(사)·(재)처럼 괄호로 묶인 한두 글자는 한 칸으로 */
export function stampChars(text: string): string[] {
  return text.replace(/\s+/g, '').match(/\([^()]{1,2}\)|./gu) ?? [];
}

/**
 * 네모 직인·개인 도장은 칸을 짝수로 맞추는 게 관례라, 이름 글자 수가 홀수면 끝에 '인'을 붙이고
 * 짝수면 붙이지 않는다 (이름에 한자가 있으면 '印'). 이미 '인'을 써 넣었으면 그 앞까지를 이름으로 본다.
 * 예: 홍길동 → 홍길동인, 김구·남궁민수 → 그대로, 소우주협동조합인 → 소우주협동조합인
 */
export function evenStampName(name: string): { text: string; added: string | null } {
  const raw = name.trim();
  const base = /[인印]$/.test(raw) && stampChars(raw).length > 1 ? raw.slice(0, -1).trim() : raw;
  const n = stampChars(base).length;
  if (!n) return { text: raw, added: null };
  if (n % 2 === 0) return { text: base, added: base === raw ? null : '' };
  const mark = /[\u4E00-\u9FFF]/.test(base) ? '印' : '인';
  return { text: base + mark, added: base + mark === raw ? null : mark };
}

/**
 * 직인 그리기.
 * corp: 법인 원형 인감(테두리에 기관 이름, 가운데 원에 직함), corpFilled: 같은 모양의 빨간 채움형,
 * square: 네모 직인(오른쪽 줄부터 세로), round: 개인 도장(동그라미).
 */
export function drawStamp(style: StampStyle, name: string, inner = '', color = STAMP_RED, size = 640, font = STAMP_FONTS[0].id): HTMLCanvasElement {
  stampFont = STAMP_FONTS.find((f) => f.id === font) ?? STAMP_FONTS[0];
  const chars = stampChars(name);
  const innerChars = stampChars(inner);
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
  star(x, mid, mid - ringR, band * 0.2);
  ringText(x, chars, mid, mid, ringR, band, ink);
  x.fillStyle = ink;
  const box = innerR * 1.25;
  fillGrid(x, innerChars, mid - box / 2, mid - box / 2, box, box, false);
  return c;
}
