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

export function renderForOcr(doc: mupdf.PDFDocument, index: number, scale: number): { png: Uint8Array; table: boolean } {
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
  // 글자는 회색조 그대로 두고(흑백으로 바꾸면 흐린 스캔의 획이 깨진다) 표 선과 그 바로 옆만 하얗게
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const near = erase[i] || (x > 0 && erase[i - 1]) || (x < w - 1 && erase[i + 1]) || (y > 0 && erase[i - w]) || (y < h - 1 && erase[i + w]);
    dst[y * os + x] = near ? 255 : g[i];
  }
  out.setResolution(Math.round(72 * scale), Math.round(72 * scale));
  const png = out.asPNG().slice();
  out.destroy(); pix.destroy();
  // 지운 선이 조금이라도 있으면 표가 있는 쪽
  let lines = 0;
  for (let i = 0; i < erase.length; i += 7) lines += erase[i];
  return { png, table: lines * 7 > w * 2 };
}
