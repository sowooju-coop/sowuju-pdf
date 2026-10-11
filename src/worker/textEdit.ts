// 글자 읽기와 글자 바꾸기. 원래 글자는 redaction으로 파일에서 진짜로 지우고, 같은 자리에 새 글자를 쓴다.
import * as mupdf from 'mupdf';
import type { TextLine, ReplaceRequest } from '../lib/protocol';

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

async function pdfFont(doc: mupdf.PDFDocument, file: string) {
  let m = fontCache.get(doc);
  if (!m) fontCache.set(doc, (m = new Map()));
  if (!m.has(file)) {
    const font = new mupdf.Font(file.replace(/\.ttf$/, ''), new Uint8Array(await loadFontBytes(file)).slice());
    m.set(file, { ref: doc.addFont(font), font });
  }
  return m.get(file)!;
}

const apply = (m: mupdf.Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const n = (v: number) => (Math.abs(v) < 1e-6 ? '0' : String(+v.toFixed(4)));

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

/** 페이지 내용 끝에 글자를 쓰는 내용 스트림을 덧붙인다 */
function appendText(doc: mupdf.PDFDocument, page: mupdf.PDFPage, fontRef: mupdf.PDFObject, font: mupdf.Font, req: ReplaceRequest) {
  const obj = page.getObject();
  let res = obj.get('Resources');
  if (res.isNull()) {
    const inh = obj.getInheritable('Resources');
    res = inh.isNull() ? doc.addObject(doc.newDictionary()) : inh;
    obj.put('Resources', res);
  }
  let fonts = res.get('Font');
  if (fonts.isNull()) {
    fonts = doc.newDictionary();
    res.put('Font', fonts);
  }
  let k = 1;
  while (!fonts.get(`SowujuF${k}`).isNull()) k++;
  const key = `SowujuF${k}`;
  fonts.put(key, fontRef);

  // 화면 좌표(위가 0)를 PDF 좌표로 바꾸고, 원래 줄 방향 그대로 쓴다 (회전된 페이지 포함)
  const inv = mupdf.Matrix.invert(page.getTransform());
  const [ox, oy] = apply(inv, req.x, req.y);
  const [dx0, dy0] = apply(inv, req.x + req.dir[0], req.y + req.dir[1]);
  let ux = dx0 - ox, uy = dy0 - oy;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;
  const hex = [...req.text].map((ch) => font.encodeCharacter(ch.codePointAt(0)!).toString(16).padStart(4, '0')).join('');
  const [r, g, b] = req.color;
  const stream =
    `q BT /${key} ${n(req.size)} Tf ${n(r)} ${n(g)} ${n(b)} rg ${n(req.spacing)} Tc ` +
    `${n(ux)} ${n(uy)} ${n(-uy)} ${n(ux)} ${n(ox)} ${n(oy)} Tm <${hex}> Tj ET Q`;

  // 원래 내용이 남긴 그래픽 상태가 새 글자에 영향을 주지 않도록 q … Q 로 감싼다
  const contents = obj.get('Contents');
  const arr = doc.newArray();
  arr.push(doc.addStream('q\n', doc.newDictionary()));
  if (contents.isArray()) for (let i = 0; i < contents.length; i++) arr.push(contents.get(i));
  else if (!contents.isNull()) arr.push(contents);
  arr.push(doc.addStream('\nQ\n', doc.newDictionary()));
  arr.push(doc.addStream(stream, doc.newDictionary()));
  obj.put('Contents', arr);
}

export async function replaceText(doc: mupdf.PDFDocument, req: ReplaceRequest) {
  const page = doc.loadPage(req.page);
  redact(page, req.remove);
  if (req.text.trim()) {
    const { ref, font } = await pdfFont(doc, req.fontFile);
    appendText(doc, page, ref, font, req);
  }
  page.destroy();
}
