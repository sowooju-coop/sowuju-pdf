/// <reference lib="webworker" />
// MuPDF는 무거운 작업이라 화면이 멈추지 않도록 별도 작업 스레드(Web Worker)에서 돌린다.
import * as mupdf from 'mupdf';
import type { NewShape, NewText, PageInfo, ReplaceRequest, WorkerRequest, WorkerResponse } from '../lib/protocol';
import { addTexts, readLines, replaceText } from './textEdit';
import { drawShapes } from './shapes';
import { clearDocInfo, encryptOptions, findPrivate, redactAreas, shrinkImages, type ShrinkLevel } from './protect';
import { addResource, appendContent, rectToImageMatrix } from './pdfUtil';

let doc: mupdf.PDFDocument | null = null;
/** 실행 취소용: 바꾸기 직전 문서를 통째로 저장해 둔다 */
/**
 * 되돌리기는 MuPDF 작업 기록(journal)으로 한다. 바뀐 객체만 기록하므로
 * 편집할 때마다 문서 전체를 복사하던 것보다 훨씬 빠르고 메모리도 적게 쓴다.
 */
function startJournal(d: mupdf.PDFDocument) {
  d.enableJournal();
}
async function edit<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const d = requireDoc();
  d.beginOperation(name);
  try {
    const r = await fn();
    d.endOperation();
    return r;
  } catch (e) {
    d.abandonOperation();
    throw e;
  }
}
/** 새로 넣은 글꼴이 있을 때만 저장할 때 글꼴 줄이기를 한다 */
let fontsAdded = false;
function snapshot() {
  return requireDoc().saveToBuffer('').asUint8Array().slice();
}
/**
 * 저장용 바이트. 새로 넣은 글꼴은 쓴 글자만 남겨 파일 크기를 줄인다.
 * 사본을 만드는 대신 작업 기록 안에서 줄이고 저장한 뒤 그 작업을 버려서 원래대로 돌린다.
 * 다시 하기가 남아 있으면 새 작업을 시작하는 순간 사라지므로 그때만 사본으로 처리
 */
function saveBytes(opts: string) {
  const d = requireDoc();
  if (!fontsAdded) return d.saveToBuffer(opts).asUint8Array().slice();
  if (d.canRedo()) {
    const work = mupdf.Document.openDocument(snapshot(), 'application/pdf') as mupdf.PDFDocument;
    try { work.subsetFonts(); } catch { /* 그대로 둔다 */ }
    const out = work.saveToBuffer(opts).asUint8Array().slice();
    work.destroy();
    return out;
  }
  d.beginOperation('저장용 글꼴 줄이기');
  try {
    try { d.subsetFonts(); } catch { /* 부분 내장이 안 되는 글꼴은 그대로 둔다 */ }
    return d.saveToBuffer(opts).asUint8Array().slice();
  } finally {
    d.abandonOperation();
  }
}
const history = () => ({ canUndo: requireDoc().canUndo(), canRedo: requireDoc().canRedo() });

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

/** 페이지를 흰 바탕에 그려 ImageBitmap으로 돌려준다. 배율 = scale (1 = 72dpi) */
async function render(index: number, scale: number, rotate = 0) {
  const page = requireDoc().loadPage(index);
  let m = mupdf.Matrix.scale(scale, scale);
  if (rotate) m = mupdf.Matrix.concat(m, mupdf.Matrix.rotate(rotate));
  const [x0, y0, x1, y1] = mupdf.Rect.transform(page.getBounds(), m);
  const bbox: mupdf.Rect = [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
  // 처음부터 RGBA 흰 바탕에 그려서, 픽셀을 하나하나 옮겨 담는 일을 없앤다
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(m, pix);
  page.run(dev, mupdf.Matrix.identity);
  dev.close();
  dev.destroy();
  const w = pix.getWidth(), h = pix.getHeight();
  const data = new ImageData(new Uint8ClampedArray(pix.getPixels()), w, h);
  pix.destroy(); page.destroy();
  // 화면에 올리기 좋은 그림으로 바꿔서 넘기면 화면 쪽에서 복사하는 일이 줄어든다
  const bitmap = await createImageBitmap(data);
  return { width: w, height: h, bitmap };
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

class NeedsPassword extends Error {}

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
    startJournal(doc);
    fontsAdded = false;
    return { pages: pageInfos() };
  },
  /** 빈 새 문서 (사진만으로 PDF를 만들 때) */
  newDoc: () => { doc?.destroy(); doc = new mupdf.PDFDocument(); startJournal(doc); fontsAdded = false; return { pages: pageInfos() }; },
  pages: () => pageInfos(),
  render: ({ index, scale, rotate }) => render(index, scale, rotate),
  renderPng: ({ index, scale, rotate }) => renderPng(index, scale, rotate),
  rotate: async ({ indices, delta }) => { await edit('돌리기', () => rotatePages(indices, delta)); return { pages: pageInfos(), ...history() }; },
  delete: async ({ indices }) => { await edit('지우기', () => deletePages(indices)); return { pages: pageInfos(), ...history() }; },
  move: async ({ order }: { order: number[] }) => { await edit('순서', () => requireDoc().rearrangePages(order)); return { pages: pageInfos(), ...history() }; },
  insertBlank: async ({ at, width, height }) => { await edit('빈 쪽', () => insertBlank(clampAt(at), width, height)); return { pages: pageInfos(), ...history() }; },
  insertFile: async ({ at: want, bytes, kind }: { at: number; bytes: Uint8Array; kind: 'pdf' | 'image' }) => {
    const at = clampAt(want);
    let count = 1;
    if (kind === 'pdf') {
      const r = await edit('파일 넣기', () => {
        const x = insertPdf(at, bytes);
        if (x.needsPassword) throw new NeedsPassword();
        return x;
      }).catch((e) => { if (e instanceof NeedsPassword) return null; throw e; });
      if (!r) return { needsPassword: true, pages: pageInfos(), ...history() };
      count = r.count;
    } else await edit('사진 넣기', () => insertImage(at, bytes));
    return { count, at, pages: pageInfos(), ...history() };
  },
  duplicate: async ({ indices }) => { await edit('복제', () => duplicatePages(indices)); return { pages: pageInfos(), ...history() }; },
  extract: ({ indices }) => extractPages(indices),
  // 서명·직인 그림과 새 글자를 한 번에 넣는다 (되돌리기 한 번에 모두 빠지게)
  place: async ({ items, texts = [], shapes = [] }: { items: { page: number; x: number; y: number; w: number; h: number; png: Uint8Array }[]; texts?: NewText[]; shapes?: NewShape[] }) => {
    await edit('넣기', async () => {
      // 형광펜은 맨 아래, 그다음 그림·글자, 펜·도형은 위에
      drawShapes(requireDoc(), shapes.filter((s) => s.kind === 'highlight'));
      for (const it of items) placeImage(it.page, it.x, it.y, it.w, it.h, it.png);
      drawShapes(requireDoc(), shapes.filter((s) => s.kind !== 'highlight'));
      if (texts.some((t) => t.text.trim())) fontsAdded = true;
      await addTexts(requireDoc(), texts);
    });
    // 쪽 크기는 그대로라 쪽 정보를 다시 읽지 않는다 (쪽이 많을 때 빨라진다)
    return { ...history() };
  },
  lines: ({ index }) => readLines(requireDoc(), index),
  replace: async (req: ReplaceRequest) => { await edit('글자 고치기', () => replaceText(requireDoc(), req)); if (req.text.trim()) fontsAdded = true; return { ...history() }; },
  undo: () => { const d = requireDoc(); if (d.canUndo()) d.undo(); return { pages: pageInfos(), ...history() }; },
  redo: () => { const d = requireDoc(); if (d.canRedo()) d.redo(); return { pages: pageInfos(), ...history() }; },
  save: () => saveBytes('garbage,compress'),
  /** 암호를 걸어 저장한 파일 (작업 중인 문서는 그대로) */
  saveProtected: ({ password, printOnly }: { password: string; printOnly: boolean }) => saveBytes(`garbage,compress,${password ? encryptOptions(password, printOnly) : 'encrypt=none'}`),
  /** 그림을 줄이고 압축한 사본 */
  shrink: ({ level }: { level: ShrinkLevel }) => {
    const work = mupdf.Document.openDocument(snapshot(), 'application/pdf') as mupdf.PDFDocument;
    try {
      const images = shrinkImages(work, level);
      try { work.subsetFonts(); } catch { /* 그대로 둔다 */ }
      const bytes = work.saveToBuffer('garbage=deduplicate,compress,compress-fonts,compress-images').asUint8Array().slice();
      return { bytes, images };
    } finally {
      work.destroy();
    }
  },
  findPrivate: ({ rrnBackOnly, search }: { rrnBackOnly: boolean; search: string[] }) => findPrivate(requireDoc(), rrnBackOnly, search),
  redact: async ({ areas, clearInfo }: { areas: { page: number; rects: [number, number, number, number][] }[]; clearInfo: boolean }) => {
    await edit('개인정보 지우기', () => { redactAreas(requireDoc(), areas); if (clearInfo) clearDocInfo(requireDoc()); });
    return { ...history() };
  },
  /** 문서 정보: 처음 열었을 때 암호가 걸려 있었는지, 작성자 등 */
  info: () => {
    const d = requireDoc();
    const get = (k: string) => { try { return d.getMetaData(k) || ''; } catch { return ''; } };
    return { encryption: get('encryption'), author: get('info:Author'), creator: get('info:Creator'), producer: get('info:Producer') };
  },
};

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, op, args } = e.data;
  let res: WorkerResponse;
  const transfer: Transferable[] = [];
  try {
    const result = await handlers[op](args);
    if (result?.bitmap) transfer.push(result.bitmap);
    else if (result?.bytes instanceof Uint8Array) transfer.push(result.bytes.buffer);
    else if (result instanceof Uint8Array) transfer.push(result.buffer);
    res = { id, ok: true, result };
  } catch (err) {
    res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer);
};

// 여기까지 왔으면 MuPDF(WebAssembly)를 다 불러온 것. 그 전에 온 요청은 받지 못하므로 준비됐다고 알린다
(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: 0, ok: true, result: 'ready' } satisfies WorkerResponse);
