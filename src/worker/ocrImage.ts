// 글자 읽기(OCR) 앞처리: 회색조로 그리고 표 선(긴 가로·세로 줄)을 지운다.
// 표가 많은 계약서·신청서에서 표 선 때문에 글자 자리를 못 찾는 일을 줄인다
import * as mupdf from 'mupdf';

/** Otsu 방식 문턱값 (글자와 바탕을 가장 잘 가르는 밝기) */
function otsu(px: Uint8Array) {
  const hist = new Float64Array(256);
  for (let i = 0; i < px.length; i++) hist[px[i]]++;
  const total = px.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  return th;
}

/**
 * 표 칸: 표 선으로 둘러싸인 네모 칸 중 글자가 있는 것 (그림 픽셀 좌표).
 * 칸마다 따로 다시 읽으면 띄엄띄엄 쓴 표 글자를 훨씬 잘 읽는다
 */
function tableCells(erase: Uint8Array, ink: Uint8Array, w: number, h: number): [number, number, number, number][] {
  // 선을 2픽셀 두껍게 해서 칸을 확실히 닫는다
  const wall = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x;
    if (erase[i] || erase[i - 1] || erase[i + 1] || erase[i - w] || erase[i + w] || erase[i - 2] || erase[i + 2] || erase[i - 2 * w] || erase[i + 2 * w]) wall[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const out: [number, number, number, number][] = [];
  const stack: number[] = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (wall[s0] || seen[s0]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0, inkN = 0, edge = false;
    stack.push(s0); seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      n++; if (ink[i]) inkN++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && !wall[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !wall[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !wall[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !wall[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (edge || n < bw * bh * 0.85 || bw < 30 || bh < 20 || bh > h / 4 || bw > w * 0.95 || inkN < 30) continue;
    out.push([x0, y0, x1 + 1, y1 + 1]);
  }
  return out;
}

export function renderForOcr(doc: mupdf.PDFDocument, index: number, scale: number): { png: Uint8Array; table: boolean; cells: [number, number, number, number][] } {
  const page = doc.loadPage(index);
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false, true);
  page.destroy();
  const w = pix.getWidth(), h = pix.getHeight(), stride = pix.getStride();
  const src = pix.getPixels();
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) g.set(src.subarray(y * stride, y * stride + w), y * w);
  // 흑백: 문턱값보다 조금 밝게 잡아 흐린 글자도 살린다
  const th = Math.min(200, otsu(g) + 10);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) ink[i] = g[i] < th ? 1 : 0;
  // 표 선: 쪽 폭의 1/12 넘게 이어진 가로줄, 높이의 1/12 넘게 이어진 세로줄 (글자 획은 이렇게 길지 않다)
  const minH = Math.round(w / 12), minV = Math.round(h / 12);
  const erase = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && ink[y * w + x]) { run++; continue; }
      if (run >= minH) for (let k = x - run; k < x; k++) erase[y * w + k] = 1;
      run = 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && ink[y * w + x]) { run++; continue; }
      if (run >= minV) for (let k = y - run; k < y; k++) erase[k * w + x] = 1;
      run = 0;
    }
  }
  const out = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, w, h], false);
  const dst = out.getPixels();
  const os = out.getStride();
  // 글자는 회색조 그대로 두고(흑백으로 바꾸면 흐린 스캔의 획이 깨진다) 표 선과 그 바로 옆만 하얗게.
  // 잡티는 3×3 가운데값으로 지우고, 밝기를 늘려 바탕은 하얗게·글자는 진하게 (틀린 글자가 15%→12%로 줄었다)
  const clean = new Uint8Array(w * h);
  const win = new Uint8Array(9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const near = erase[i] || (x > 0 && erase[i - 1]) || (x < w - 1 && erase[i + 1]) || (y > 0 && erase[i - w]) || (y < h - 1 && erase[i + w]);
    if (near) { clean[i] = 255; continue; }
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { clean[i] = g[i]; continue; }
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) win[k++] = g[i + dy * w + dx];
    win.sort();
    clean[i] = win[4];
  }
  const hist = new Uint32Array(256);
  for (let i = 0; i < clean.length; i++) hist[clean[i]]++;
  const pct = (q: number) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= clean.length * q) return v; } return 255; };
  const lo = pct(0.01), hi = Math.max(lo + 40, pct(0.6));
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = v <= lo ? 0 : v >= hi ? 255 : Math.round(((v - lo) / (hi - lo)) * 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[y * os + x] = lut[clean[y * w + x]];
  out.setResolution(Math.round(72 * scale), Math.round(72 * scale));
  const cells = tableCells(erase, ink, w, h);
  const png = out.asPNG().slice();
  out.destroy(); pix.destroy();
  // 지운 선이 조금이라도 있으면 표가 있는 쪽
  let lines = 0;
  for (let i = 0; i < erase.length; i += 7) lines += erase[i];
  return { png, table: lines * 7 > w * 2, cells };
}
