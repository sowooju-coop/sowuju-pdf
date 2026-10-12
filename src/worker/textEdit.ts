// 글자 읽기와 글자 바꾸기. 원래 글자는 redaction으로 파일에서 진짜로 지우고, 같은 자리에 새 글자를 쓴다.
import * as mupdf from 'mupdf';
import type { NewText, TextLine, ReplaceRequest } from '../lib/protocol';
import { addResource, appendContent, applyMatrix, num } from './pdfUtil';
import { origByKey } from './origFont';

/** 페이지의 글자를 줄 단위로, 글자마다 정확한 위치와 함께 읽는다 (좌표: 화면과 같은 페이지 공간, pt, 위가 0) */
export function readLines(doc: mupdf.PDFDocument, index: number): TextLine[] {
  const page = doc.loadPage(index);
  const st = page.toStructuredText('preserve-whitespace');
  const lines: TextLine[] = [];
  let cur: TextLine | null = null;
  st.walk({
    beginLine(bbox, _wmode, dir) {
      cur = { bbox: [...bbox] as mupdf.Rect, dir: [dir[0], dir[1]], chars: [] };
    },
    onChar(c, origin, font, size, quad, color) {
      cur?.chars.push({
        c, x: origin[0], y: origin[1], size, quad: [...quad] as mupdf.Quad,
        color: toRgb(color), font: font.getName(), bold: font.isBold(), serif: font.isSerif(),
      });
    },
    endLine() {
      if (cur && cur.chars.some((ch) => ch.c.trim())) lines.push(cur);
      cur = null;
    },
  });
  st.destroy();
  page.destroy();
  return lines;
}

function toRgb(c: mupdf.Color): [number, number, number] {
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 3) return [c[0], c[1], c[2]];
  const [C, M, Y, K] = c as [number, number, number, number];
  return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)];
}

const fontCache = new WeakMap<mupdf.PDFDocument, Map<string, { ref: mupdf.PDFObject; font: mupdf.Font }>>();
const fontBytes = new Map<string, Promise<ArrayBuffer>>();

function loadFontBytes(file: string) {
  if (!fontBytes.has(file)) {
    fontBytes.set(file, fetch(new URL(`/fonts/${file}`, self.location.href)).then((r) => {
      if (!r.ok) throw new Error(`글꼴을 불러오지 못했어요 (${file})`);
      return r.arrayBuffer();
    }));
  }
  return fontBytes.get(file)!;
}

export async function pdfFont(doc: mupdf.PDFDocument, file: string) {
  let m = fontCache.get(doc);
  if (!m) fontCache.set(doc, (m = new Map()));
  if (!m.has(file)) {
    const font = new mupdf.Font(file.replace(/\.ttf$/, ''), new Uint8Array(await loadFontBytes(file)).slice());
    m.set(file, { ref: doc.addFont(font), font });
  }
  return m.get(file)!;
}

/** 지울 글자 상자들을 redaction으로 지운다. 표 선·그림은 그대로 둔다 */
function redact(page: mupdf.PDFPage, quads: mupdf.Quad[]) {
  if (!quads.length) return;
  const annot = page.createAnnotation('Redact');
  // 이웃 글자나 윗줄·아랫줄이 함께 지워지지 않도록 상자를 안쪽으로 조금 줄인다
  const shrunk = quads.map((q): mupdf.Quad => {
    const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const dx = (x1 - x0) * 0.2, dy = (y1 - y0) * 0.25;
    return [x0 + dx, y0 + dy, x1 - dx, y0 + dy, x0 + dx, y1 - dy, x1 - dx, y1 - dy];
  });
  annot.setQuadPoints(shrunk);
  annot.update();
  page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
}

/**
 * 페이지 내용 끝에 글자를 쓰는 내용 스트림을 덧붙인다.
 * 원래 글꼴이 있으면 그 글꼴에 있는 글자는 원래 글꼴로, 없는 글자만 우리 글꼴로 쓴다 (한 줄 안에서 글꼴을 바꿔 가며).
 */
function appendText(doc: mupdf.PDFDocument, page: mupdf.PDFPage, fontRef: mupdf.PDFObject | null, font: mupdf.Font | null, req: ReplaceRequest) {
  const key = fontRef ? addResource(doc, page, 'Font', 'SowujuF', fontRef) : '';
  const orig = req.origFont ? origByKey(doc, req.origFont) : null;
  const okey = orig ? sameResource(doc, page, req.origFont!) : null;
  // 화면 좌표(위가 0)를 PDF 좌표로 바꾸고, 원래 줄 방향 그대로 쓴다 (회전된 페이지 포함)
  const inv = mupdf.Matrix.invert(page.getTransform());
  const [ox, oy] = applyMatrix(inv, req.x, req.y);
  const [dx0, dy0] = applyMatrix(inv, req.x + req.dir[0], req.y + req.dir[1]);
  let ux = dx0 - ox, uy = dy0 - oy;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;
  const n = num;
  // 같은 글꼴이 이어지는 글자끼리 묶는다
  const runs: { k: string; hex: string }[] = [];
  for (const ch of req.text) {
    const cp = ch.codePointAt(0)!;
    const cid = orig?.uni2cid.get(cp);
    const useOrig = cid !== undefined && !!okey;
    if (!useOrig && !font) continue;
    const k = useOrig ? okey! : key;
    const code = useOrig ? cid! : font!.encodeCharacter(cp);
    const hex = code.toString(16).padStart(4, '0');
    const last = runs[runs.length - 1];
    if (last && last.k === k) last.hex += hex; else runs.push({ k, hex });
  }
  const [r, g, b] = req.color.map((v) => (Number.isFinite(v) ? v : 0));
  const body = runs.map((x) => `/${x.k} ${n(req.size)} Tf <${x.hex}> Tj`).join(' ');
  appendContent(doc, page,
    `q BT ${n(r)} ${n(g)} ${n(b)} rg ${n(req.spacing)} Tc ` +
    `${n(ux)} ${n(uy)} ${n(-uy)} ${n(ux)} ${n(ox)} ${n(oy)} Tm ${body} ET Q`);
}

/** 원래 글꼴 객체를 이 쪽의 Font 자원에 이름으로 올린다 (이미 있으면 그 이름) */
function sameResource(doc: mupdf.PDFDocument, page: mupdf.PDFPage, objNum: number) {
  const res = page.getObject().get('Resources');
  const fonts = res.isNull() ? null : res.get('Font');
  let name: string | null = null;
  if (fonts && fonts.isDictionary()) fonts.forEach((v, k) => { if (!name && v.isIndirect() && v.asIndirect() === objNum) name = String(k); });
  return name ?? addResource(doc, page, 'Font', 'SowujuO', doc.newIndirect(objNum));
}

export async function replaceText(doc: mupdf.PDFDocument, req: ReplaceRequest) {
  const page = doc.loadPage(req.page);
  redact(page, req.remove);
  if (req.text.trim()) {
    // 원래 글꼴로 모두 쓸 수 있으면 우리 글꼴은 아예 넣지 않는다 (파일이 커지지 않게)
    const orig = req.origFont ? origByKey(doc, req.origFont) : null;
    const allOrig = !!orig && [...req.text].every((ch) => orig.uni2cid.has(ch.codePointAt(0)!));
    const fb = allOrig ? null : await pdfFont(doc, req.fontFile);
    appendText(doc, page, fb?.ref ?? null, fb?.font ?? null, req);
  }
  page.destroy();
}

/** 빈 곳에 새 글자를 쓴다 (글자 추가, 날짜) */
export async function addTexts(doc: mupdf.PDFDocument, items: NewText[]) {
  for (const it of items) {
    if (!it.text.trim()) continue;
    const page = doc.loadPage(it.page);
    const { ref, font } = await pdfFont(doc, it.fontFile);
    appendText(doc, page, ref, font, { ...it, remove: [], dir: [1, 0], spacing: 0 });
    page.destroy();
  }
}
