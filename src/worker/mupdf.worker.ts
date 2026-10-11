/// <reference lib="webworker" />
// MuPDF는 무거운 작업이라 화면이 멈추지 않도록 별도 작업 스레드(Web Worker)에서 돌린다.
import * as mupdf from 'mupdf';
import type { PageInfo, WorkerRequest, WorkerResponse } from '../lib/protocol';

let doc: mupdf.PDFDocument | null = null;

function requireDoc(): mupdf.PDFDocument {
  if (!doc) throw new Error('열린 문서가 없어요.');
  return doc;
}

function pageInfos(): PageInfo[] {
  const d = requireDoc();
  const out: PageInfo[] = [];
  for (let i = 0; i < d.countPages(); i++) {
    const page = d.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const rot = page.getObject().getInheritable('Rotate');
    out.push({ width: x1 - x0, height: y1 - y0, rotation: rot.isNumber() ? ((rot.asNumber() % 360) + 360) % 360 : 0 });
    page.destroy();
  }
  return out;
}

/** 페이지를 RGBA 픽셀로 그린다. dpi 기준 배율 = scale (1 = 72dpi) */
function render(index: number, scale: number, rotate = 0) {
  const page = requireDoc().loadPage(index);
  let m = mupdf.Matrix.scale(scale, scale);
  if (rotate) m = mupdf.Matrix.concat(m, mupdf.Matrix.rotate(rotate));
  const pix = page.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false, true);
  const w = pix.getWidth(), h = pix.getHeight(), n = pix.getNumberOfComponents(), stride = pix.getStride();
  const src = pix.getPixels();
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    let si = y * stride, di = y * w * 4;
    for (let x = 0; x < w; x++, si += n, di += 4) {
      rgba[di] = src[si]; rgba[di + 1] = src[si + 1]; rgba[di + 2] = src[si + 2]; rgba[di + 3] = 255;
    }
  }
  pix.destroy(); page.destroy();
  return { width: w, height: h, pixels: rgba };
}

function renderPng(index: number, scale: number, rotate = 0) {
  const page = requireDoc().loadPage(index);
  let m = mupdf.Matrix.scale(scale, scale);
  if (rotate) m = mupdf.Matrix.concat(m, mupdf.Matrix.rotate(rotate));
  const pix = page.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pix.asPNG().slice();
  pix.destroy(); page.destroy();
  return png;
}

function rotatePages(indices: number[], delta: number) {
  const d = requireDoc();
  for (const i of indices) {
    const page = d.loadPage(i);
    const obj = page.getObject();
    const cur = obj.getInheritable('Rotate');
    const next = ((((cur.isNumber() ? cur.asNumber() : 0) + delta) % 360) + 360) % 360;
    obj.put('Rotate', d.newInteger(next));
    page.destroy();
  }
}

function deletePages(indices: number[]) {
  const d = requireDoc();
  [...indices].sort((a, b) => b - a).forEach((i) => d.deletePage(i));
}

const handlers: Record<string, (args: any) => any> = {
  open({ bytes, password }: { bytes: Uint8Array; password?: string }) {
    const d = mupdf.Document.openDocument(bytes, 'application/pdf');
    if (d.needsPassword()) {
      if (!password) return { needsPassword: true };
      if (!d.authenticatePassword(password)) return { needsPassword: true, wrongPassword: true };
    }
    if (!d.isPDF()) throw new Error('PDF 문서가 아니에요.');
    doc?.destroy();
    doc = d as mupdf.PDFDocument;
    return { pages: pageInfos() };
  },
  pages: () => pageInfos(),
  render: ({ index, scale, rotate }) => render(index, scale, rotate),
  renderPng: ({ index, scale, rotate }) => renderPng(index, scale, rotate),
  rotate: ({ indices, delta }) => { rotatePages(indices, delta); return pageInfos(); },
  delete: ({ indices }) => { deletePages(indices); return pageInfos(); },
  move: ({ order }: { order: number[] }) => { requireDoc().rearrangePages(order); return pageInfos(); },
  save: () => requireDoc().saveToBuffer('garbage,compress').asUint8Array().slice(),
};

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, op, args } = e.data;
  let res: WorkerResponse;
  const transfer: Transferable[] = [];
  try {
    const result = handlers[op](args);
    if (result?.pixels) transfer.push(result.pixels.buffer);
    else if (result instanceof Uint8Array) transfer.push(result.buffer);
    res = { id, ok: true, result };
  } catch (err) {
    res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer);
};
