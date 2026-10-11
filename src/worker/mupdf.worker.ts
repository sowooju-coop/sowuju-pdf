/// <reference lib="webworker" />
// MuPDF는 무거운 작업이라 화면이 멈추지 않도록 별도 작업 스레드(Web Worker)에서 돌린다.
import * as mupdf from 'mupdf';
import type { PageInfo, ReplaceRequest, WorkerRequest, WorkerResponse } from '../lib/protocol';
import { readLines, replaceText } from './textEdit';

let doc: mupdf.PDFDocument | null = null;
/** 실행 취소용: 바꾸기 직전 문서를 통째로 저장해 둔다 */
const undoStack: Uint8Array[] = [];
const redoStack: Uint8Array[] = [];
const MAX_HISTORY = 30;

function snapshot() {
  return requireDoc().saveToBuffer('').asUint8Array().slice();
}
function remember() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}
function reopen(bytes: Uint8Array) {
  doc?.destroy();
  doc = mupdf.Document.openDocument(bytes, 'application/pdf') as mupdf.PDFDocument;
}
const history = () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

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
    undoStack.length = 0;
    redoStack.length = 0;
    return { pages: pageInfos() };
  },
  pages: () => pageInfos(),
  render: ({ index, scale, rotate }) => render(index, scale, rotate),
  renderPng: ({ index, scale, rotate }) => renderPng(index, scale, rotate),
  rotate: ({ indices, delta }) => { remember(); rotatePages(indices, delta); return { pages: pageInfos(), ...history() }; },
  delete: ({ indices }) => { remember(); deletePages(indices); return { pages: pageInfos(), ...history() }; },
  move: ({ order }: { order: number[] }) => { remember(); requireDoc().rearrangePages(order); return { pages: pageInfos(), ...history() }; },
  lines: ({ index }) => readLines(requireDoc(), index),
  replace: async (req: ReplaceRequest) => { remember(); await replaceText(requireDoc(), req); return { pages: pageInfos(), ...history() }; },
  undo: () => { const b = undoStack.pop(); if (b) { redoStack.push(snapshot()); reopen(b); } return { pages: pageInfos(), ...history() }; },
  redo: () => { const b = redoStack.pop(); if (b) { undoStack.push(snapshot()); reopen(b); } return { pages: pageInfos(), ...history() }; },
  save: () => {
    // 저장할 때 새로 넣은 글꼴은 쓴 글자만 남겨 파일 크기를 줄인다. 작업 중인 문서는 그대로 두고 사본으로 처리
    const work = mupdf.Document.openDocument(snapshot(), 'application/pdf') as mupdf.PDFDocument;
    try { work.subsetFonts(); } catch { /* 부분 내장이 안 되는 글꼴은 그대로 둔다 */ }
    const out = work.saveToBuffer('garbage,compress').asUint8Array().slice();
    work.destroy();
    return out;
  },
};

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, op, args } = e.data;
  let res: WorkerResponse;
  const transfer: Transferable[] = [];
  try {
    const result = await handlers[op](args);
    if (result?.pixels) transfer.push(result.pixels.buffer);
    else if (result instanceof Uint8Array) transfer.push(result.buffer);
    res = { id, ok: true, result };
  } catch (err) {
    res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer);
};
