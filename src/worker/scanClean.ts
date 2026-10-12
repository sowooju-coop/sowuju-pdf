// 스캔 깨끗하게: 기울기 바로 세우기, 회색 바탕을 하얗게, 흑백·회색조·컬러, 가장자리 검은 테두리 지우기.
// 쪽을 그림으로 다시 그려 그 그림 한 장으로 쪽 내용을 바꾼다 (쪽 크기·보이는 방향은 그대로)
import * as mupdf from 'mupdf';
import type { CleanOptions } from '../lib/protocol';
import { num } from './pdfUtil';

type Img = { w: number; h: number; ch: 1 | 3; px: Uint8Array };

function render(page: mupdf.PDFPage, dpi: number, color: boolean): Img {
  const s = dpi / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(s, s), color ? mupdf.ColorSpace.DeviceRGB : mupdf.ColorSpace.DeviceGray, false, true);
  const w = pix.getWidth(), h = pix.getHeight(), st = pix.getStride(), ch = color ? 3 : 1;
  const src = pix.getPixels(), px = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) px.set(src.subarray(y * st, y * st + w * ch), y * w * ch);
  pix.destroy();
  return { w, h, ch: ch as 1 | 3, px };
}

const lumOf = (img: Img) => {
  if (img.ch === 1) return img.px;
  const g = new Uint8Array(img.w * img.h);
  for (let i = 0, j = 0; i < g.length; i++, j += 3) g[i] = (img.px[j] * 77 + img.px[j + 1] * 150 + img.px[j + 2] * 29) >> 8;
  return g;
};

/** 기울기(도): 잉크 점들을 여러 각도로 돌려 가로줄 모양이 가장 또렷한 각도 */
function skewAngle(g: Uint8Array, w: number, h: number): number {
  const pts: number[] = [];
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 400000)));
  // 가장자리 5%는 빼고 (스캔 테두리·그림자)
  for (let y = Math.round(h * 0.05); y < h * 0.95; y += step) for (let x = Math.round(w * 0.05); x < w * 0.95; x += step) if (g[y * w + x] < 128) pts.push(x, y);
  if (pts.length < 200) return 0;
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a);
    // 칸 높이는 점을 뽑은 간격 이상 (작으면 뽑은 줄만 차서 0°가 늘 이긴다)
    const bh = Math.max(2, step);
    const bins = new Float64Array(Math.ceil(h / bh) + Math.ceil(w / bh) + 4);
    const off = Math.ceil(w / bh) + 2;
    for (let i = 0; i < pts.length; i += 2) { const yy = (pts[i + 1] * c - pts[i] * s) / bh + off; bins[yy | 0]++; }
    let v = 0; for (let i = 1; i < bins.length; i++) { const d = bins[i] - bins[i - 1]; v += d * d; }
    return v;
  };
  let best = 0, bs = -1;
  for (let d = -5; d <= 5; d += 0.25) { const v = score(d); if (v > bs) { bs = v; best = d; } }
  for (let d = best - 0.25; d <= best + 0.25; d += 0.05) { const v = score(d); if (v > bs) { bs = v; best = d; } }
  return Math.abs(best) < 0.1 ? 0 : best;
}

/** 가운데를 기준으로 deg만큼 돌린다 (빈 곳은 흰색) */
function rotate(img: Img, deg: number): Img {
  const { w, h, ch, px } = img;
  const a = (-deg * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a), cx = w / 2, cy = h / 2;
  const out = new Uint8Array(px.length).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = c * (x - cx) - s * (y - cy) + cx, sy = s * (x - cx) + c * (y - cy) + cy;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
    const fx = sx - x0, fy = sy - y0;
    for (let k = 0; k < ch; k++) {
      const i00 = (y0 * w + x0) * ch + k, i10 = i00 + ch, i01 = i00 + w * ch, i11 = i01 + ch;
      out[(y * w + x) * ch + k] = (px[i00] * (1 - fx) + px[i10] * fx) * (1 - fy) + (px[i01] * (1 - fx) + px[i11] * fx) * fy;
    }
  }
  return { w, h, ch, px: out };
}

/** 가장자리에서 이어진 어두운 부분(스캔 테두리·구멍 그림자)을 하얗게 */
function clearBorders(img: Img, g: Uint8Array) {
  const { w, h, ch, px } = img;
  const dark = (i: number) => g[i] < 110;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => { if (!seen[i] && dark(i)) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let n = 0;
  while (stack.length) {
    const i = stack.pop()!; n++;
    const x = i % w, y = (i / w) | 0;
    // 쪽 안쪽 깊숙이(가장자리에서 8% 넘게)는 들어가지 않는다 — 글자·표를 지우지 않게
    if (x > w * 0.08 && x < w * 0.92 && y > h * 0.08 && y < h * 0.92) continue;
    for (let k = 0; k < ch; k++) px[i * ch + k] = 255;
    g[i] = 255;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  return n;
}

/** 바탕을 하얗게, 글자를 진하게: 밝기 분포에서 바탕(밝은 쪽)과 잉크(어두운 쪽) 값을 찾아 늘린다 */
function levels(img: Img, g: Uint8Array) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const at = (q: number) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= g.length * q) return v; } return 255; };
  const bg = Math.max(140, at(0.5) - 12), ink = Math.min(bg - 60, at(0.01) + 10);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = v >= bg ? 255 : v <= ink ? 0 : Math.round(((v - ink) / (bg - ink)) ** 1.2 * 255);
  for (let i = 0; i < img.px.length; i++) img.px[i] = lut[img.px[i]];
  for (let i = 0; i < g.length; i++) g[i] = lut[g[i]];
}

/** 한 쪽을 깨끗하게 만든 그림 */
export function cleanImage(page: mupdf.PDFPage, o: CleanOptions, dpi: number): { img: Img; angle: number } {
  let img = render(page, dpi, o.mode === 'color');
  let g = lumOf(img);
  let angle = 0;
  // 테두리를 먼저 지워야 기울기를 테두리 선에 맞추지 않는다
  if (o.borders) clearBorders(img, g);
  if (o.deskew) {
    angle = skewAngle(g, img.w, img.h);
    if (angle) { img = rotate(img, -angle); g = lumOf(img); }
  }
  if (o.whiten || o.mode === 'bw') levels(img, g);
  if (o.mode === 'bw') for (let i = 0; i < img.px.length; i++) img.px[i] = img.px[i] < 150 ? 0 : 255;
  return { img, angle };
}

function toPixmap(img: Img) {
  const pix = new mupdf.Pixmap(img.ch === 3 ? mupdf.ColorSpace.DeviceRGB : mupdf.ColorSpace.DeviceGray, [0, 0, img.w, img.h], false);
  const dst = pix.getPixels(), st = pix.getStride();
  for (let y = 0; y < img.h; y++) dst.set(img.px.subarray(y * img.w * img.ch, (y + 1) * img.w * img.ch), y * st);
  return pix;
}

/** 미리보기용 PNG (작게) */
export function cleanPreview(doc: mupdf.PDFDocument, index: number, o: CleanOptions) {
  const page = doc.loadPage(index);
  const { img, angle } = cleanImage(page, o, 60);
  page.destroy();
  const pix = toPixmap(img);
  const png = pix.asPNG().slice();
  pix.destroy();
  return { png, angle };
}

/** 쪽 내용을 깨끗한 그림 한 장으로 바꾼다. 흑백은 PNG(작고 또렷), 회색조·컬러는 JPEG */
export function cleanPages(doc: mupdf.PDFDocument, pages: number[], o: CleanOptions) {
  const dpi = o.mode === 'bw' ? 300 : 200;
  const angles: number[] = [];
  for (const i of pages) {
    const page = doc.loadPage(i);
    const [bx0, by0, bx1, by1] = page.getBounds();
    const W = bx1 - bx0, H = by1 - by0;
    const { img, angle } = cleanImage(page, o, dpi);
    angles.push(angle);
    const pix = toPixmap(img);
    pix.setResolution(dpi, dpi);
    const bytes = (o.mode === 'bw' ? pix.asPNG() : pix.asJPEG(o.mode === 'gray' ? 80 : 82)).slice();
    pix.destroy();
    const image = new mupdf.Image(bytes);
    const ref = doc.addImage(image);
    image.destroy();
    // 보이는 그대로의 크기·방향으로 쪽을 새로 짠다 (돌림 0, 상자 하나)
    const obj = page.getObject();
    const box = doc.newArray(); [0, 0, Number(num(W)), Number(num(H))].forEach((v) => box.push(v));
    obj.put('MediaBox', box);
    obj.delete('CropBox'); obj.delete('TrimBox'); obj.delete('BleedBox'); obj.delete('ArtBox');
    obj.put('Rotate', 0);
    const xo = doc.newDictionary(); xo.put('SowujuScan', ref);
    const res = doc.newDictionary(); res.put('XObject', xo);
    obj.put('Resources', res);
    obj.put('Contents', doc.addStream(`q ${num(W)} 0 0 ${num(H)} 0 0 cm /SowujuScan Do Q`, doc.newDictionary()));
    obj.delete('Annots');
    page.destroy();
  }
  return angles;
}
