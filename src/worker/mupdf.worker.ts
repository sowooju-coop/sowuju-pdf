/// <reference lib="webworker" />
// MuPDF는 무거운 작업이라 화면이 멈추지 않도록 별도 작업 스레드(Web Worker)에서 돌린다.
import * as mupdf from 'mupdf';
import type { Bookmark, FormField, NewShape, NewText, OcrWord, PageInfo, PageNumberOptions, WatermarkOptions, ReplaceRequest, WorkerRequest, WorkerResponse } from '../lib/protocol';
import { addTexts, readLines, replaceText } from './textEdit';
import { drawShapes } from './shapes';
import { origFont } from './origFont';
import { listFields, setField } from './forms';
import { clearFindCache, findText, pageWords } from './find';
import { addPageNumbers, addWatermark } from './pageStamp';
import { addOcrText, textlessPages } from './ocrText';
import { autoOutline, getOutline, pageTitle, setOutline } from './outline';
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
  clearFindCache(d);
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

/**
 * 모아 찍기: 여러 쪽을 A4 한 장에 그린다 (2쪽: 가로 용지에 나란히, 4쪽: 세로 용지에 2×2).
 * 인쇄는 세로 용지 기준이라 2쪽 모아 찍기는 다 그린 뒤 90도 돌려서 넘긴다
 */
async function renderSheet(indices: number[], per: 2 | 4, dpi: number, border: boolean) {
  const s = dpi / 72;
  const land = per === 2;
  const W = land ? 842 : 595, H = land ? 595 : 842;
  const cols = 2, rows = per / 2;
  const margin = 18, gap = 12;
  const cw = (W - margin * 2 - gap * (cols - 1)) / cols, ch = (H - margin * 2 - gap * (rows - 1)) / rows;
  const sheet = new OffscreenCanvas(Math.round(W * s), Math.round(H * s));
  const g = sheet.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (let k = 0; k < indices.length && k < per; k++) {
    const page = requireDoc().loadPage(indices[k]);
    const [x0, y0, x1, y1] = page.getBounds();
    page.destroy();
    const pw = x1 - x0, ph = y1 - y0;
    const f = Math.min(cw / pw, ch / ph);
    const { bitmap } = await render(indices[k], f * s);
    const cx = margin + (k % cols) * (cw + gap), cy = margin + Math.floor(k / cols) * (ch + gap);
    const dx = (cx + (cw - pw * f) / 2) * s, dy = (cy + (ch - ph * f) / 2) * s;
    g.drawImage(bitmap, dx, dy, pw * f * s, ph * f * s);
    if (border) {
      g.strokeStyle = '#9AA3AD';
      g.lineWidth = Math.max(1, s * 0.5);
      g.strokeRect(dx, dy, pw * f * s, ph * f * s);
    }
    bitmap.close();
  }
  let out = sheet;
  if (land) {
    out = new OffscreenCanvas(sheet.height, sheet.width);
    const r = out.getContext('2d')!;
    r.translate(out.width, 0);
    r.rotate(Math.PI / 2);
    r.drawImage(sheet, 0, 0);
  }
  const blob = await out.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/** 그림으로 내보내기: 흰 바탕, PNG 또는 JPG */
function renderImage(index: number, dpi: number, format: 'png' | 'jpg') {
  const page = requireDoc().loadPage(index);
  const pix = page.toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
  pix.setResolution(dpi, dpi);
  const out = (format === 'jpg' ? pix.asJPEG(90) : pix.asPNG()).slice();
  pix.destroy(); page.destroy();
  return out;
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
  // 새로 넣은 글꼴은 쓴 글자만 남긴다 (쪽마다 나눠 저장할 때 파일이 커지지 않게)
  if (fontsAdded) try { out.subsetFonts(); } catch { /* 그대로 둔다 */ }
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
  renderImage: ({ index, dpi, format }) => renderImage(index, dpi, format),
  renderSheet: ({ indices, per, dpi, border }) => renderSheet(indices, per, dpi, border),
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
  textless: () => textlessPages(requireDoc()),
  outline: () => getOutline(requireDoc()),
  setOutline: async ({ list }: { list: Bookmark[] }) => {
    await edit('목차', () => setOutline(requireDoc(), list));
    return { ...history() };
  },
  autoOutline: () => autoOutline(requireDoc()),
  pageTitle: ({ index }: { index: number }) => pageTitle(requireDoc(), index),
  /** 여러 쪽의 글자 읽기 결과를 한 번의 작업(되돌리기 한 번)으로 넣는다 */
  ocrText: async ({ pages }: { pages: { index: number; scale: number; words: OcrWord[] }[] }) => {
    await edit('글자 읽기', async () => { for (const p of pages) await addOcrText(requireDoc(), p.index, p.scale, p.words); });
    fontsAdded = true;
    return { ...history() };
  },
  pageNumbers: async (o: PageNumberOptions) => {
    await edit('쪽 번호', () => addPageNumbers(requireDoc(), o));
    fontsAdded = true;
    return { ...history() };
  },
  watermark: async (o: WatermarkOptions) => {
    await edit('워터마크', () => addWatermark(requireDoc(), o));
    fontsAdded = true;
    return { ...history() };
  },
  lines: ({ index }) => readLines(requireDoc(), index),
  /** 양식 입력칸: 문서 전체 개수 (입력칸이 없는 문서는 빨리 0) */
  fieldCount: () => {
    const d = requireDoc();
    const fields = d.getTrailer().get('Root').get('AcroForm').get('Fields');
    if (!fields.isArray() || !fields.length) return 0;
    let n = 0;
    for (let i = 0; i < d.countPages(); i++) { const pg = d.loadPage(i); n += pg.getWidgets().filter((w) => !w.isReadOnly() && w.getFieldType() !== 'signature' && w.getFieldType() !== 'button').length; pg.destroy(); }
    return n;
  },
  fields: ({ index }: { index: number }): FormField[] => listFields(requireDoc(), index),
  find: ({ query }: { query: string }) => findText(requireDoc(), query),
  words: () => pageWords(requireDoc()),
  setField: async ({ index, id, value }: { index: number; id: number; value: string }) => {
    const usedFont = await edit('입력칸 채우기', () => setField(requireDoc(), index, id, value));
    if (usedFont) fontsAdded = true;
    return { ...history() };
  },
  /** 고치는 줄의 원래 글꼴을 브라우저용으로 (쓸 수 없는 글꼴이면 null) */
  origFont: ({ index, name }: { index: number; name: string }) => {
    const e = origFont(requireDoc(), index, name);
    return e ? { ...e.info, bytes: e.info.bytes.slice() } : null;
  },
  replace: async (req: ReplaceRequest) => { await edit('글자 고치기', () => replaceText(requireDoc(), req)); if (req.text.trim()) fontsAdded = true; return { ...history() }; },
  undo: () => { const d = requireDoc(); clearFindCache(d); if (d.canUndo()) d.undo(); return { pages: pageInfos(), ...history() }; },
  redo: () => { const d = requireDoc(); clearFindCache(d); if (d.canRedo()) d.redo(); return { pages: pageInfos(), ...history() }; },
  save: () => saveBytes('garbage,compress'),
  /** 암호를 걸어 저장한 파일 (작업 중인 문서는 그대로) */
  saveProtected: ({ password, printOnly }: { password: string; printOnly: boolean }) => saveBytes(`garbage,compress,${password ? encryptOptions(password, printOnly) : 'encrypt=none'}`),
  /** 그림을 줄이고 압축한 사본 */
  shrink: ({ level }: { level: ShrinkLevel }) => {
    // 비교 기준: 지금 문서를 그냥 저장했을 때 크기
    const before = saveBytes('garbage,compress').length;
    const work = mupdf.Document.openDocument(snapshot(), 'application/pdf') as mupdf.PDFDocument;
    try {
      const images = shrinkImages(work, level);
      try { work.subsetFonts(); } catch { /* 그대로 둔다 */ }
      const bytes = work.saveToBuffer('garbage=deduplicate,compress,compress-fonts,compress-images').asUint8Array().slice();
      return { bytes, images, before };
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
