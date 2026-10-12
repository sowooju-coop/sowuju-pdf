// 쪽 크기 바꾸기(내용을 새 크기에 맞춰 줄이거나 늘려 가운데에), 여백 자르기(CropBox)
import * as mupdf from 'mupdf';
import type { CropOptions, ResizeOptions } from '../lib/protocol';
import { applyMatrix, num } from './pdfUtil';

const boxOf = (o: mupdf.PDFObject): [number, number, number, number] | null => {
  if (!o.isArray() || o.length < 4) return null;
  const v = [0, 1, 2, 3].map((i) => o.get(i).asNumber());
  return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
};
const arr = (doc: mupdf.PDFDocument, v: number[]) => { const a = doc.newArray(); v.forEach((x) => a.push(Number(num(x)))); return a; };

export function resizePages(doc: mupdf.PDFDocument, o: ResizeOptions) {
  for (const i of o.pages) {
    const page = doc.loadPage(i);
    const obj = page.getObject();
    const media = boxOf(obj.getInheritable('MediaBox')) ?? [0, 0, 595, 842];
    const src = boxOf(obj.getInheritable('CropBox')) ?? media;
    const rot = ((obj.getInheritable('Rotate').isNumber() ? obj.getInheritable('Rotate').asNumber() : 0) % 360 + 360) % 360;
    const sideways = rot === 90 || rot === 270;
    const W = src[2] - src[0], H = src[3] - src[1];
    // 보이는 방향 기준으로 세로/가로를 정한 뒤, 돌려 놓은 쪽이면 PDF 안쪽 크기는 뒤바꾼다
    const visW = sideways ? H : W, visH = sideways ? W : H;
    let tw = o.width, th = o.height;
    const wantLand = o.orient === 'landscape' || (o.orient === 'keep' && visW > visH);
    if (wantLand !== tw > th) [tw, th] = [th, tw];
    if (sideways) [tw, th] = [th, tw];
    const s = Math.min(tw / W, th / H);
    const tx = (tw - W * s) / 2 - src[0] * s, ty = (th - H * s) / 2 - src[1] * s;
    const pre = doc.addStream(`q ${num(s)} 0 0 ${num(s)} ${num(tx)} ${num(ty)} cm\n`, doc.newDictionary());
    const post = doc.addStream('\nQ\n', doc.newDictionary());
    const contents = obj.get('Contents');
    const list = doc.newArray();
    list.push(pre);
    if (contents.isArray()) for (let k = 0; k < contents.length; k++) list.push(contents.get(k));
    else if (!contents.isNull()) list.push(contents);
    list.push(post);
    obj.put('Contents', list);
    obj.put('MediaBox', arr(doc, [0, 0, tw, th]));
    for (const k of ['CropBox', 'TrimBox', 'BleedBox', 'ArtBox']) obj.delete(k);
    // 입력칸·메모 같은 주석 자리도 같이 옮긴다
    const annots = obj.get('Annots');
    if (annots.isArray()) for (let k = 0; k < annots.length; k++) {
      const a = annots.get(k).resolve();
      const r = boxOf(a.get('Rect'));
      if (r) a.put('Rect', arr(doc, [r[0] * s + tx, r[1] * s + ty, r[2] * s + tx, r[3] * s + ty]));
    }
    page.destroy();
  }
}

/** 쪽에서 내용(흰색이 아닌 것)이 있는 범위 (화면 좌표 pt) */
function contentBox(page: mupdf.PDFPage): [number, number, number, number] | null {
  const s = 50 / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceGray, false, true);
  const w = pix.getWidth(), h = pix.getHeight(), st = pix.getStride(), px = pix.getPixels();
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * st + x] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  pix.destroy();
  return x1 < 0 ? null : [x0 / s, y0 / s, (x1 + 1) / s, (y1 + 1) / s];
}

export function cropPages(doc: mupdf.PDFDocument, o: CropOptions) {
  for (const i of o.pages) {
    const page = doc.loadPage(i);
    const obj = page.getObject();
    if (o.reset) { obj.delete('CropBox'); page.destroy(); continue; }
    const [bx0, by0, bx1, by1] = page.getBounds();
    let r = o.auto ? contentBox(page) : o.rect ?? null;
    if (!r) { page.destroy(); continue; }
    const m = o.auto ? o.margin : 0;
    r = [Math.max(bx0, r[0] - m), Math.max(by0, r[1] - m), Math.min(bx1, r[2] + m), Math.min(by1, r[3] + m)];
    if (r[2] - r[0] < 20 || r[3] - r[1] < 20) { page.destroy(); continue; }
    // 화면 좌표 → PDF 좌표 (돌려 놓은 쪽 포함)
    const inv = mupdf.Matrix.invert(page.getTransform());
    const pts = [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]].map(([x, y]) => applyMatrix(inv, x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    obj.put('CropBox', arr(doc, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]));
    page.destroy();
  }
}
