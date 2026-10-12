// 인증서 전자서명 준비: 서명 칸(보이게/안 보이게)과 비워 둔 서명 자리를 넣은 PDF를 만든다.
// 실제 서명 값은 화면 쪽에서 이 파일의 나머지 바이트로 계산해 빈자리에 채운다.
import * as mupdf from 'mupdf';
import { SIG_SPACE, type SignPrepare } from '../lib/protocol';
import { applyMatrix, num } from './pdfUtil';
import { pdfFont } from './textEdit';

export function hasSignatures(doc: mupdf.PDFDocument) {
  const fields = doc.getTrailer().get('Root').get('AcroForm').get('Fields');
  if (!fields.isArray()) return 0;
  let n = 0;
  const walk = (f: mupdf.PDFObject, depth: number) => {
    if (depth > 20) return;
    if (f.get('FT').asName() === 'Sig' && !f.get('V').isNull()) n++;
    const kids = f.get('Kids');
    if (kids.isArray()) for (let i = 0; i < kids.length; i++) walk(kids.get(i), depth + 1);
  };
  for (let i = 0; i < fields.length; i++) walk(fields.get(i), 0);
  return n;
}

const pdfDate = (d: Date) => {
  const p = (v: number) => String(v).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
};

/**
 * 보이는 서명 상자의 모양 (테두리 + 이름·일시·사유).
 * 글꼴은 따로 만든 빈 문서에서 쓴 글자만 남기고 옮겨 온다 (문서의 다른 글꼴과 이미 있는 서명을 건드리지 않게)
 */
async function appearance(doc: mupdf.PDFDocument, w: number, h: number, lines: string[]) {
  const n = num;
  const pad = Math.min(6, h * 0.08);
  const size = Math.max(5, Math.min(14, (h - pad * 2) / (lines.length * 1.35 + 0.2), (w - pad * 2) / Math.max(...lines.map((l) => [...l].length * 0.95), 1)));
  const lead = size * 1.35;
  const top = (h + lines.length * lead) / 2 - size;
  const scratch = new mupdf.PDFDocument();
  try {
    const { ref, font } = await pdfFont(scratch, 'Pretendard-Regular.ttf');
    let s = `q 1 g 0 0 ${n(w)} ${n(h)} re f Q\nq 0.16 0.38 0.82 RG 0.9 w ${n(0.45)} ${n(0.45)} ${n(w - 0.9)} ${n(h - 0.9)} re S Q\nBT 0.1 0.12 0.16 rg `;
    lines.forEach((l, i) => {
      const hex = [...l].map((ch) => font.encodeCharacter(ch.codePointAt(0)!).toString(16).padStart(4, '0')).join('');
      s += `/F1 ${n(i === 0 ? size * 1.1 : size)} Tf 1 0 0 1 ${n(pad + 2)} ${n(top - i * lead)} Tm <${hex}> Tj `;
    });
    s += 'ET';
    const res = scratch.newDictionary();
    const fonts = scratch.newDictionary();
    fonts.put('F1', ref);
    res.put('Font', fonts);
    scratch.insertPage(-1, scratch.addPage([0, 0, w, h], 0, res, s));
    try { scratch.subsetFonts(); } catch { /* 줄이지 못하면 그대로 */ }
    const dict = doc.newDictionary();
    dict.put('Type', doc.newName('XObject'));
    dict.put('Subtype', doc.newName('Form'));
    dict.put('BBox', [0, 0, w, h]);
    dict.put('Resources', doc.graftObject(res));
    return doc.addStream(s, dict);
  } finally {
    scratch.destroy();
  }
}

/**
 * 지금 문서에 서명 칸을 넣고 저장한 바이트를 돌려준다 (원래 문서는 바꾸지 않는다).
 * base는 서명 칸을 넣기 전 바이트. 그 뒤에 덧붙여 저장하므로 이미 있던 다른 서명도 깨지지 않는다.
 */
export async function prepareSign(base: Uint8Array, o: SignPrepare) {
  const doc = mupdf.Document.openDocument(base, 'application/pdf') as mupdf.PDFDocument;
  try {
    const root = doc.getTrailer().get('Root');
    let form = root.get('AcroForm');
    if (form.isNull()) { form = doc.addObject(doc.newDictionary()); root.put('AcroForm', form); }
    let fields = form.get('Fields');
    if (!fields.isArray()) { fields = doc.newArray(); form.put('Fields', fields); }
    form.put('SigFlags', 3);

    // 서명 칸 이름: 겹치지 않게
    const names = new Set<string>();
    for (let i = 0; i < fields.length; i++) names.add(fields.get(i).get('T').asString());
    let k = 1;
    while (names.has(`소우주서명${k}`)) k++;

    const sig = doc.newDictionary();
    sig.put('Type', doc.newName('Sig'));
    sig.put('Filter', doc.newName('Adobe.PPKLite'));
    sig.put('SubFilter', doc.newName('adbe.pkcs7.detached'));
    // 숫자 자리는 나중에 같은 길이로 바꿔 쓴다 (정수로 넣어야 소수로 바뀌지 않는다)
    const range = doc.newArray();
    for (const v of [0, 1111111111, 1111111111, 1111111111]) range.push(doc.newInteger(v));
    sig.put('ByteRange', range);
    sig.put('Contents', doc.newByteString(new Uint8Array(SIG_SPACE)));
    sig.put('M', doc.newString(pdfDate(new Date())));
    if (o.name) sig.put('Name', doc.newString(o.name));
    if (o.reason) sig.put('Reason', doc.newString(o.reason));
    if (o.location) sig.put('Location', doc.newString(o.location));
    const sigRef = doc.addObject(sig);

    const page = doc.loadPage(Math.max(0, Math.min(doc.countPages() - 1, o.page)));
    const pobj = page.getObject();
    let rect: [number, number, number, number] = [0, 0, 0, 0];
    let ap: mupdf.PDFObject | null = null;
    if (o.rect) {
      const inv = mupdf.Matrix.invert(page.getTransform());
      const [x, y, w, h] = o.rect;
      const pts = [applyMatrix(inv, x, y), applyMatrix(inv, x + w, y), applyMatrix(inv, x, y + h), applyMatrix(inv, x + w, y + h)];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      ap = await appearance(doc, rect[2] - rect[0], rect[3] - rect[1], o.lines);
    }
    const widget = doc.newDictionary();
    widget.put('Type', doc.newName('Annot'));
    widget.put('Subtype', doc.newName('Widget'));
    widget.put('FT', doc.newName('Sig'));
    widget.put('T', doc.newString(`소우주서명${k}`));
    widget.put('V', sigRef);
    widget.put('Rect', rect);
    widget.put('F', 132); // 인쇄 + 잠금
    widget.put('P', pobj);
    if (ap) { const apd = doc.newDictionary(); apd.put('N', ap); widget.put('AP', apd); }
    const wref = doc.addObject(widget);
    let annots = pobj.get('Annots');
    if (!annots.isArray()) { annots = doc.newArray(); pobj.put('Annots', annots); }
    annots.push(wref);
    fields.push(wref);
    page.destroy();
    return doc.saveToBuffer('incremental,compress').asUint8Array().slice();
  } finally {
    doc.destroy();
  }
}
