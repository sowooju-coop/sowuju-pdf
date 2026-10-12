// 입력칸 만들기: 글자칸·여러 줄 칸·체크칸·고르기 칸을 PDF 양식(AcroForm)으로 넣는다.
// 글꼴은 문서에 넣지 않는 한글 표준 글꼴(돋움, Adobe-Korea1)을 가리켜서 Acrobat·크롬 등 다른 프로그램에서도 한글을 쓸 수 있게 한다
import * as mupdf from 'mupdf';
import type { NewField } from '../lib/protocol';
import { applyMatrix, num } from './pdfUtil';

const KO = 'KoDotum';

function acroForm(doc: mupdf.PDFDocument) {
  const root = doc.getTrailer().get('Root');
  let af = root.get('AcroForm');
  if (!af.isDictionary()) { af = doc.addObject(doc.newDictionary()); root.put('AcroForm', af); }
  if (!af.get('Fields').isArray()) af.put('Fields', doc.newArray());
  let dr = af.get('DR');
  if (!dr.isDictionary()) { dr = doc.newDictionary(); af.put('DR', dr); }
  let fonts = dr.get('Font');
  if (!fonts.isDictionary()) { fonts = doc.newDictionary(); dr.put('Font', fonts); }
  return { af, fonts };
}

/** 한글 표준 글꼴(돋움) 참조: Type0 + CIDFontType0, Adobe-Korea1, 넣지 않음 */
function koFont(doc: mupdf.PDFDocument) {
  const fd = doc.addObject(doc.newDictionary());
  fd.put('Type', doc.newName('FontDescriptor'));
  fd.put('FontName', doc.newName('Dotum'));
  fd.put('Flags', 4);
  const bb = doc.newArray(); [-200, -200, 1200, 1200].forEach((v) => bb.push(v));
  fd.put('FontBBox', bb);
  fd.put('ItalicAngle', 0); fd.put('Ascent', 1000); fd.put('Descent', -200); fd.put('StemV', 80);
  const csi = doc.newDictionary();
  csi.put('Registry', doc.newString('Adobe')); csi.put('Ordering', doc.newString('Korea1')); csi.put('Supplement', 2);
  const cid = doc.addObject(doc.newDictionary());
  cid.put('Type', doc.newName('Font')); cid.put('Subtype', doc.newName('CIDFontType0'));
  cid.put('BaseFont', doc.newName('Dotum')); cid.put('CIDSystemInfo', csi); cid.put('FontDescriptor', fd);
  const t0 = doc.addObject(doc.newDictionary());
  t0.put('Type', doc.newName('Font')); t0.put('Subtype', doc.newName('Type0'));
  t0.put('BaseFont', doc.newName('Dotum')); t0.put('Encoding', doc.newName('UniKS-UCS2-H'));
  const arr = doc.newArray(); arr.push(cid); t0.put('DescendantFonts', arr);
  return t0;
}

function zapf(doc: mupdf.PDFDocument) {
  const f = doc.addObject(doc.newDictionary());
  f.put('Type', doc.newName('Font')); f.put('Subtype', doc.newName('Type1')); f.put('BaseFont', doc.newName('ZapfDingbats'));
  return f;
}

function formXObject(doc: mupdf.PDFDocument, w: number, h: number, content: string) {
  const d = doc.newDictionary();
  d.put('Type', doc.newName('XObject')); d.put('Subtype', doc.newName('Form'));
  const bb = doc.newArray(); [0, 0, w, h].forEach((v) => bb.push(v));
  d.put('BBox', bb);
  d.put('Resources', doc.newDictionary());
  return doc.addStream(content, d);
}

/** 이름이 겹치지 않게 (성명, 성명_2 …) */
function uniqueName(used: Set<string>, name: string) {
  const base = (name.trim() || '입력칸').replace(/[.]/g, '·').slice(0, 40);
  let n = base, k = 2;
  while (used.has(n)) n = `${base}_${k++}`;
  used.add(n);
  return n;
}

function existingNames(af: mupdf.PDFObject) {
  const used = new Set<string>();
  const walk = (arr: mupdf.PDFObject, prefix: string, depth: number) => {
    if (!arr.isArray() || depth > 6) return;
    for (let i = 0; i < arr.length; i++) {
      const f = arr.get(i).resolve();
      const t = f.get('T');
      const name = t.isString() ? (prefix ? `${prefix}.${t.asString()}` : t.asString()) : prefix;
      if (name) used.add(name);
      walk(f.get('Kids'), name, depth + 1);
    }
  };
  walk(af.get('Fields'), '', 0);
  return used;
}

export function createFields(doc: mupdf.PDFDocument, fields: NewField[]) {
  if (!fields.length) return;
  const { af, fonts } = acroForm(doc);
  if (fonts.get(KO).isNull()) fonts.put(KO, koFont(doc));
  if (fonts.get('ZaDb').isNull()) fonts.put('ZaDb', zapf(doc));
  if (!af.get('DA').isString()) af.put('DA', doc.newString(`/${KO} 0 Tf 0 g`));
  af.put('NeedAppearances', false);
  const used = existingNames(af);
  const list = af.get('Fields');
  const byPage = new Map<number, NewField[]>();
  for (const f of fields) byPage.set(f.page, [...(byPage.get(f.page) ?? []), f]);
  for (const [index, fs] of byPage) {
    const page = doc.loadPage(index);
    const pobj = page.getObject();
    const inv = mupdf.Matrix.invert(page.getTransform());
    let annots = pobj.get('Annots');
    if (!annots.isArray()) { annots = doc.newArray(); pobj.put('Annots', annots); }
    for (const f of fs) {
      const pts = [[f.rect[0], f.rect[1]], [f.rect[2], f.rect[1]], [f.rect[0], f.rect[3]], [f.rect[2], f.rect[3]]].map(([x, y]) => applyMatrix(inv, x, y));
      const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
      const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
      const w = x1 - x0, h = y1 - y0;
      const o = doc.addObject(doc.newDictionary());
      o.put('Type', doc.newName('Annot'));
      o.put('Subtype', doc.newName('Widget'));
      const rect = doc.newArray(); [x0, y0, x1, y1].forEach((v) => rect.push(Number(num(v))));
      o.put('Rect', rect);
      o.put('P', pobj);
      o.put('F', 4);
      o.put('T', doc.newString(uniqueName(used, f.name)));
      o.put('TU', doc.newString(f.name.trim() || '입력칸'));
      const mk = doc.newDictionary();
      o.put('MK', mk);
      if (f.type === 'checkbox') {
        o.put('FT', doc.newName('Btn'));
        o.put('V', doc.newName('Off'));
        o.put('AS', doc.newName('Off'));
        o.put('DA', doc.newString('/ZaDb 0 Tf 0 g'));
        mk.put('CA', doc.newString('4'));
        // 켜짐: 체크 표시, 꺼짐: 빈 모양 (칸 테두리는 문서에 그려진 것을 그대로 쓴다)
        const s = Math.min(w, h);
        const ck = `q 0 g ${num(Math.max(0.8, s * 0.1))} w 1 J 1 j ${num(w / 2 - s * 0.32)} ${num(h / 2)} m ${num(w / 2 - s * 0.08)} ${num(h / 2 - s * 0.26)} l ${num(w / 2 + s * 0.34)} ${num(h / 2 + s * 0.3)} l S Q`;
        const n = doc.newDictionary();
        n.put('Yes', formXObject(doc, w, h, ck));
        n.put('Off', formXObject(doc, w, h, ''));
        const ap = doc.newDictionary(); ap.put('N', n);
        o.put('AP', ap);
      } else {
        o.put('FT', doc.newName(f.type === 'combo' ? 'Ch' : 'Tx'));
        o.put('DA', doc.newString(`/${KO} 0 Tf 0 g`));
        o.put('V', doc.newString(''));
        if (f.type === 'multiline') o.put('Ff', 4096);
        if (f.type === 'combo') {
          o.put('Ff', 131072 | 262144); // 고르기 + 직접 쓰기도 됨
          const opt = doc.newArray();
          for (const t of f.options ?? []) if (t.trim()) opt.push(doc.newString(t.trim()));
          o.put('Opt', opt);
        }
        const ap = doc.newDictionary(); ap.put('N', formXObject(doc, w, h, '/Tx BMC EMC'));
        o.put('AP', ap);
      }
      annots.push(o);
      list.push(o);
    }
    page.destroy();
  }
}
