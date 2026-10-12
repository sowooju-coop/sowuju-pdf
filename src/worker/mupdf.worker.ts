/// <reference lib="webworker" />
// MuPDF는 무거운 작업이라 화면이 멈추지 않도록 별도 작업 스레드(Web Worker)에서 돌린다.
import * as mupdf from 'mupdf';
import type { NewShape, NewText, PageInfo, ReplaceRequest, WorkerRequest, WorkerResponse } from '../lib/protocol';
import { addTexts, readLines, replaceText } from './textEdit';
import { drawShapes } from './shapes';
import { addResource, appendContent, rectToImageMatrix } from './pdfUtil';

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

/** 넣을 자리를 0 ~ 쪽수 사이로 맞춘다 (쪽수 = 맨 뒤) */
const clampAt = (at: number) => Math.max(0, Math.min(Math.floor(at), requireDoc().countPages()));

/** 지금 보는 쪽과 같은 크기의 빈 쪽을 at 자리에 넣는다 */
function insertBlank(at: number, width: number, height: number) {
  const d = requireDoc();
  const obj = d.addPage([0, 0, width, height], 0, d.newDictionary(), '');
  d.insertPage(at, obj);
}

/** 다른 PDF의 모든 쪽을 at 자리부터 넣는다 */
function insertPdf(at: number, bytes: Uint8Array) {
  const d = requireDoc();
  const src = mupdf.Document.openDocument(bytes, 'application/pdf');
  if (src.needsPassword()) { src.destroy(); return { needsPassword: true, count: 0 }; }
  const pdf = src as mupdf.PDFDocument;
  const n = pdf.countPages();
  const map = d.newGraftMap();
  for (let i = 0; i < n; i++) map.graftPage(at + i, pdf, i);
  map.destroy();
  pdf.destroy();
  return { count: n };
}

/** 사진 한 장을 A4 한 쪽으로 넣는다 (사진 방향에 맞춰 세로·가로, 여백 없이 가운데) */
function insertImage(at: number, bytes: Uint8Array) {
  const d = requireDoc();
  const img = new mupdf.Image(bytes);
  const iw = img.getWidth(), ih = img.getHeight();
  const land = iw > ih;
  const W = land ? 842 : 595, H = land ? 595 : 842;
  const s = Math.min(W / iw, H / ih), w = iw * s, h = ih * s;
  const ref = d.addImage(img);
  const xo = d.newDictionary();
  xo.put('Im0', ref);
  const res = d.newDictionary();
  res.put('XObject', xo);
  const f = (v: number) => v.toFixed(3);
  const obj = d.addPage([0, 0, W, H], 0, res, `q ${f(w)} 0 0 ${f(h)} ${f((W - w) / 2)} ${f((H - h) / 2)} cm /Im0 Do Q`);
  d.insertPage(at, obj);
  img.destroy();
}

/** 고른 쪽들을 마지막 고른 쪽 바로 뒤에 복사한다 */
function duplicatePages(indices: number[]) {
  const d = requireDoc();
  const copy = mupdf.Document.openDocument(snapshot(), 'application/pdf') as mupdf.PDFDocument;
  const sorted = [...indices].sort((a, b) => a - b);
  const at = sorted[sorted.length - 1] + 1;
  const map = d.newGraftMap();
  sorted.forEach((idx, k) => map.graftPage(at + k, copy, idx));
  map.destroy();
  copy.destroy();
}

/** 서명·직인 그림을 쪽에 고정해 넣는다 (x, y, w, h: 화면 좌표 pt) */
function placeImage(index: number, x: number, y: number, w: number, h: number, png: Uint8Array) {
  const d = requireDoc();
  const page = d.loadPage(index);
  const img = new mupdf.Image(png);
  const key = addResource(d, page, 'XObject', 'SowujuIm', d.addImage(img));
  appendContent(d, page, `q ${rectToImageMatrix(page, x, y, w, h)} cm /${key} Do Q`);
  img.destroy();
  page.destroy();
}

/** 고른 쪽만 새 PDF로 */
function extractPages(indices: number[]) {
  const out = new mupdf.PDFDocument();
  const map = out.newGraftMap();
  [...indices].sort((a, b) => a - b).forEach((idx) => map.graftPage(-1, requireDoc(), idx));
  map.destroy();
  const bytes = out.saveToBuffer('garbage,compress').asUint8Array().slice();
  out.destroy();
  return bytes;
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
  /** 빈 새 문서 (사진만으로 PDF를 만들 때) */
  newDoc: () => { doc?.destroy(); doc = new mupdf.PDFDocument(); undoStack.length = 0; redoStack.length = 0; return { pages: pageInfos() }; },
  pages: () => pageInfos(),
  render: ({ index, scale, rotate }) => render(index, scale, rotate),
  renderPng: ({ index, scale, rotate }) => renderPng(index, scale, rotate),
  rotate: ({ indices, delta }) => { remember(); rotatePages(indices, delta); return { pages: pageInfos(), ...history() }; },
  delete: ({ indices }) => { remember(); deletePages(indices); return { pages: pageInfos(), ...history() }; },
  move: ({ order }: { order: number[] }) => { remember(); requireDoc().rearrangePages(order); return { pages: pageInfos(), ...history() }; },
  insertBlank: ({ at, width, height }) => { remember(); insertBlank(clampAt(at), width, height); return { pages: pageInfos(), ...history() }; },
  insertFile: ({ at: want, bytes, kind }: { at: number; bytes: Uint8Array; kind: 'pdf' | 'image' }) => {
    const at = clampAt(want);
    const before = snapshot();
    let count = 1;
    if (kind === 'pdf') {
      const r = insertPdf(at, bytes);
      if (r.needsPassword) return { needsPassword: true, pages: pageInfos(), ...history() };
      count = r.count;
    } else insertImage(at, bytes);
    undoStack.push(before);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    return { count, at, pages: pageInfos(), ...history() };
  },
  duplicate: ({ indices }) => { remember(); duplicatePages(indices); return { pages: pageInfos(), ...history() }; },
  extract: ({ indices }) => extractPages(indices),
  // 서명·직인 그림과 새 글자를 한 번에 넣는다 (되돌리기 한 번에 모두 빠지게)
  place: async ({ items, texts = [], shapes = [] }: { items: { page: number; x: number; y: number; w: number; h: number; png: Uint8Array }[]; texts?: NewText[]; shapes?: NewShape[] }) => {
    remember();
    // 형광펜은 맨 아래, 그다음 그림·글자, 펜·도형은 위에
    drawShapes(requireDoc(), shapes.filter((s) => s.kind === 'highlight'));
    for (const it of items) placeImage(it.page, it.x, it.y, it.w, it.h, it.png);
    drawShapes(requireDoc(), shapes.filter((s) => s.kind !== 'highlight'));
    await addTexts(requireDoc(), texts);
    return { pages: pageInfos(), ...history() };
  },
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

// 여기까지 왔으면 MuPDF(WebAssembly)를 다 불러온 것. 그 전에 온 요청은 받지 못하므로 준비됐다고 알린다
(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: 0, ok: true, result: 'ready' } satisfies WorkerResponse);
