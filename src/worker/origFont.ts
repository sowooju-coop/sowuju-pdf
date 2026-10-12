// 원래 글꼴 그대로 쓰기: PDF에 들어 있는 글꼴을 찾아, 그 글꼴에 있는 글자는 원래 글꼴로 쓴다
import * as mupdf from 'mupdf';
import { buildWebFont, parseToUnicode } from './sfnt';

export interface OrigFontInfo {
  /** PDF 글꼴 객체 번호 */
  key: number;
  /** 브라우저에서 쓸 수 있게 다시 묶은 글꼴 */
  bytes: Uint8Array;
  /** 이 글꼴로 쓸 수 있는 글자들 */
  chars: string;
  ascent: number;
  descent: number;
  upm: number;
}

interface Entry { info: OrigFontInfo; uni2cid: Map<number, number> }
const cache = new WeakMap<mupdf.PDFDocument, Map<string, Entry | null>>();

const nameOf = (o: mupdf.PDFObject) => (o.isName() ? o.asName() : '');

/** 쪽(과 그 안의 양식 객체)에서 이름이 같은 글꼴 객체를 찾는다 */
function findFont(page: mupdf.PDFPage, name: string): mupdf.PDFObject | null {
  const seen = new Set<number>();
  const visit = (res: mupdf.PDFObject, depth: number): mupdf.PDFObject | null => {
    if (res.isNull() || depth > 4) return null;
    let found: mupdf.PDFObject | null = null;
    const fonts = res.get('Font');
    if (fonts.isDictionary()) {
      fonts.forEach((v) => {
        if (found) return;
        const f = v.resolve();
        const base = nameOf(f.get('BaseFont'));
        const desc = f.get('DescendantFonts').isArray() ? f.get('DescendantFonts').get(0).resolve() : null;
        const fdName = desc ? nameOf(desc.get('FontDescriptor').get('FontName')) : '';
        if (base === name || fdName === name || base.replace(/^[A-Z]{6}\+/, '') === name.replace(/^[A-Z]{6}\+/, '')) found = v;
      });
    }
    if (found) return found;
    const xo = res.get('XObject');
    if (xo.isDictionary()) {
      xo.forEach((v) => {
        if (found) return;
        if (v.isIndirect()) { const n = v.asIndirect(); if (seen.has(n)) return; seen.add(n); }
        const x = v.resolve();
        if (nameOf(x.get('Subtype')) === 'Form') found = visit(x.get('Resources'), depth + 1);
      });
    }
    return found;
  };
  const obj = page.getObject();
  const res = obj.get('Resources').isNull() ? obj.getInheritable('Resources') : obj.get('Resources');
  return visit(res, 0);
}

/** 원래 글꼴을 쓸 수 있으면 정보를, 아니면 null (Identity-H TrueType 글꼴만) */
export function origFont(doc: mupdf.PDFDocument, index: number, name: string): Entry | null {
  let m = cache.get(doc);
  if (!m) cache.set(doc, (m = new Map()));
  const ck = `${index}:${name}`;
  if (m.has(ck)) return m.get(ck)!;
  let entry: Entry | null = null;
  try {
    const page = doc.loadPage(index);
    const ref = findFont(page, name);
    page.destroy();
    if (ref && ref.isIndirect()) {
      const f = ref.resolve();
      const desc = f.get('DescendantFonts').get(0).resolve();
      const c2g = desc.get('CIDToGIDMap');
      const ff = desc.get('FontDescriptor').get('FontFile2');
      const tu = f.get('ToUnicode');
      const ok = nameOf(f.get('Subtype')) === 'Type0' && nameOf(f.get('Encoding')) === 'Identity-H' && nameOf(desc.get('Subtype')) === 'CIDFontType2' &&
        (c2g.isNull() || nameOf(c2g) === 'Identity') && ff.isStream() && tu.isStream();
      if (ok) {
        const uni2cid = parseToUnicode(tu.readStream().asString());
        if (uni2cid.size) {
          const key = ref.asIndirect();
          const web = buildWebFont(ff.readStream().asUint8Array().slice(), uni2cid, `SowujuOrig${key}`);
          const chars = [...uni2cid.keys()].filter((u) => u < 0xffff).map((u) => String.fromCodePoint(u)).join('');
          entry = { uni2cid, info: { key, bytes: web.bytes, chars, ascent: web.ascent, descent: web.descent, upm: web.upm } };
        }
      }
    }
  } catch {
    entry = null;
  }
  // 같은 글꼴은 객체 번호로도 찾을 수 있게
  m.set(ck, entry);
  if (entry) m.set(`#${entry.info.key}`, entry);
  return entry;
}

/** 글꼴 객체 번호로 앞에서 찾아 둔 원래 글꼴 */
export function origByKey(doc: mupdf.PDFDocument, key: number): Entry | null {
  return cache.get(doc)?.get(`#${key}`) ?? null;
}

export function resetOrigFonts(doc: mupdf.PDFDocument) {
  cache.delete(doc);
}
