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

/**
 * 직인 그리기. square: 기관·법인 직인(네모), round: 개인 도장(동그라미).
 * 글자는 실제 도장처럼 오른쪽 줄부터 위에서 아래로 읽히게 놓는다.
 */
export function drawStamp(text: string, shape: 'square' | 'round', color = STAMP_RED, size = 640): HTMLCanvasElement {
  const chars = [...text.replace(/\s+/g, '')];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  x.fillStyle = color;
  x.strokeStyle = color;
  const border = size * (shape === 'square' ? 0.055 : 0.05);
  if (shape === 'square') {
    x.lineWidth = border;
    x.strokeRect(border / 2 + 6, border / 2 + 6, size - border - 12, size - border - 12);
  } else {
    x.lineWidth = border;
    x.beginPath(); x.arc(size / 2, size / 2, size / 2 - border / 2 - 6, 0, Math.PI * 2); x.stroke();
  }
  if (!chars.length) return c;
  const n = chars.length;
  let cols: number, rows: number;
  if (shape === 'round') {
    cols = n <= 3 ? 1 : 2;
    rows = Math.ceil(n / cols);
  } else {
    cols = Math.ceil(Math.sqrt(n));
    rows = Math.ceil(n / cols);
  }
  void rows;
  const pad = shape === 'square' ? border + size * 0.06 : size * 0.2;
  const inner = size - pad * 2;
  const cw = inner / cols;
  // 줄마다 글자 수를 고르게 나누고(앞줄이 많게), 글자가 적은 줄은 세로로 늘려 줄을 꽉 채운다
  const perCol = Array.from({ length: cols }, (_, k) => Math.floor(n / cols) + (k < n % cols ? 1 : 0));
  const place: { col: number; row: number; rowsInCol: number }[] = [];
  perCol.forEach((cnt, col) => { for (let row = 0; row < cnt; row++) place.push({ col, row, rowsInCol: cnt }); });
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  const font = "700 100px 'NanumMyeongjo', serif";
  x.font = font;
  chars.forEach((chr, k) => {
    const { row, rowsInCol } = place[k];
    const col = cols - 1 - place[k].col;
    const ch = inner / rowsInCol;
    const m = x.measureText(chr);
    const gw = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || 100;
    const gh = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || 100;
    // 칸을 꽉 채우도록 가로·세로를 따로 늘린다 (도장 글씨 느낌)
    const sx = (cw * 0.9) / gw, sy = (ch * 0.9) / gh;
    const cx = pad + cw * col + cw / 2, cy = pad + ch * row + ch / 2;
    x.save();
    x.translate(cx, cy);
    x.scale(sx, sy);
    x.fillText(chr, (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
    x.restore();
  });
  return c;
}
