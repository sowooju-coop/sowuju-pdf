// PDF 양식 입력칸 채우기.
// MuPDF가 만드는 칸 모양(appearance)은 한글 글꼴을 넣지 못해(내장 안 된 '바탕'으로 대신 씀) 다른 프로그램에서 깨지므로,
// 글자 칸의 모양은 우리 한글 글꼴을 넣어 직접 만든다. 체크·라디오는 MuPDF에 맡긴다.
import * as mupdf from 'mupdf';
import type { FormField } from '../lib/protocol';
import { pdfFont } from './textEdit';
import { num } from './pdfUtil';

const FONT_FILE = 'Pretendard-Regular.ttf';

export function listFields(doc: mupdf.PDFDocument, index: number): FormField[] {
  const page = doc.loadPage(index);
  const out: FormField[] = [];
  for (const w of page.getWidgets()) {
    try {
      const o = w.getObject();
      if (!o.isIndirect()) continue;
      const t = w.getFieldType();
      const r = w.getRect();
      out.push({
        id: o.asIndirect(),
        type: t,
        name: w.getName(),
        label: w.getLabel(),
        rect: [r[0], r[1], r[2], r[3]],
        value: w.getValue(),
        on: (t === 'checkbox' || t === 'radiobutton') ? onState(o) : false,
        options: w.isChoice() ? w.getOptions() : [],
        multiline: w.isText() ? w.isMultiline() : false,
        readOnly: w.isReadOnly(),
        maxLen: w.isText() ? w.getMaxLen() : 0,
        comb: w.isText() ? w.isComb() : false,
      });
    } catch { /* 읽지 못한 칸은 건너뛴다 */ }
  }
  page.destroy();
  return out;
}

/** 체크·라디오 위젯이 켜져 있는지 (AS 가 Off 가 아니면 켜짐) */
function onState(o: mupdf.PDFObject) {
  const as = o.get('AS');
  return as.isName() && as.asName() !== 'Off';
}

function findWidget(page: mupdf.PDFPage, id: number) {
  return page.getWidgets().find((w) => { const o = w.getObject(); return o.isIndirect() && o.asIndirect() === id; }) ?? null;
}

/** 칸 하나에 값을 넣는다. value: 글자칸은 글자, 체크·라디오는 'on'/'off', 고르는 칸은 고른 항목 */
export async function setField(doc: mupdf.PDFDocument, index: number, id: number, value: string) {
  const page = doc.loadPage(index);
  try {
    const w = findWidget(page, id);
    if (!w || w.isReadOnly()) throw new Error('이 칸은 고칠 수 없어요');
    const o = w.getObject();
    if (w.isCheckbox() || w.isRadioButton()) {
      const want = value === 'on';
      if (onState(o) !== want) { w.toggle(); w.update(); }
      return false;
    }
    if (!w.isText() && !w.isChoice()) return false;
    // MuPDF의 setTextValue 는 칸 모양을 다시 만들라는 표시를 남겨, 저장할 때 우리가 만든 모양을 덮어쓴다.
    // 그래서 값(V)은 필드에 직접 넣고, 같은 필드에 딸린 모든 칸의 모양을 우리 글꼴로 만든다
    const field = fieldOf(o);
    field.put('V', doc.newString(value));
    const opt = { multiline: w.isText() && w.isMultiline(), comb: w.isText() && w.isComb(), maxLen: w.isText() ? w.getMaxLen() : 0 };
    for (const kid of widgetsOf(field)) await writeAppearance(doc, kid, value, opt);
    return true;
  } finally {
    page.destroy();
  }
}

/** 위젯이 속한 필드 (이름 T 가 있는 객체) */
function fieldOf(o: mupdf.PDFObject) {
  let f = o;
  for (let i = 0; i < 8 && f.get('T').isNull() && f.get('Parent').isDictionary(); i++) f = f.get('Parent');
  return f;
}

/** 필드에 딸린 위젯들 (필드 자신이 위젯이면 자신) */
function widgetsOf(field: mupdf.PDFObject): mupdf.PDFObject[] {
  const kids = field.get('Kids');
  if (!kids.isArray()) return [field];
  const out: mupdf.PDFObject[] = [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids.get(i);
    if (k.get('Subtype').isName() && k.get('Subtype').asName() === 'Widget') out.push(k);
  }
  return out.length ? out : [field];
}

/** 기본 모양 문자열(DA)에서 글자 크기와 색을 읽는다 */
function readDA(doc: mupdf.PDFDocument, o: mupdf.PDFObject) {
  let da = o.getInheritable('DA');
  if (da.isNull()) da = doc.getTrailer().get('Root').get('AcroForm').get('DA');
  const s = da.isString() ? da.asString() : '';
  const size = Number(/([\d.]+)\s+Tf/.exec(s)?.[1] ?? 0);
  let color: [number, number, number] = [0, 0, 0];
  const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(s);
  const g = /([\d.]+)\s+g(?![a-z])/.exec(s);
  if (rg) color = [Number(rg[1]), Number(rg[2]), Number(rg[3])];
  else if (g) color = [Number(g[1]), Number(g[1]), Number(g[1])];
  return { size, color };
}

/** 글자 칸 모양을 우리 글꼴로 직접 만든다 */
async function writeAppearance(doc: mupdf.PDFDocument, o: mupdf.PDFObject, text: string, opt: { multiline: boolean; comb: boolean; maxLen: number }) {
  const { ref, font } = await pdfFont(doc, FONT_FILE);
  const r = o.get('Rect');
  const x0 = r.get(0).asNumber(), y0 = r.get(1).asNumber(), x1 = r.get(2).asNumber(), y1 = r.get(3).asNumber();
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  const { size: daSize, color } = readDA(doc, o);
  const q = o.getInheritable('Q');
  const align = q.isNumber() ? q.asNumber() : 0;
  const pad = 2;
  const enc = (s: string) => [...s].map((ch) => font.encodeCharacter(ch.codePointAt(0)!));
  const width = (s: string, size: number) => enc(s).reduce((a, g) => a + font.advanceGlyph(g, 0), 0) * size;
  const hex = (s: string) => enc(s).map((g) => g.toString(16).padStart(4, '0')).join('');
  const ops: string[] = [];
  let size = daSize;

  if (opt.comb && opt.maxLen > 0) {
    // 칸마다 한 글자씩 (우편번호·주민번호 칸 등)
    const cell = w / opt.maxLen;
    size = size || Math.min(h * 0.7, cell * 0.9);
    [...text].slice(0, opt.maxLen).forEach((ch, i) => {
      const cw = width(ch, size);
      ops.push(`1 0 0 1 ${num(i * cell + (cell - cw) / 2)} ${num((h - size * 0.72) / 2)} Tm <${hex(ch)}> Tj`);
    });
  } else if (opt.multiline) {
    size = size || 10;
    let lines = wrap(text, w - pad * 2, (s) => width(s, size));
    // 자동 크기면 칸에 다 들어갈 때까지 줄인다
    while (!daSize && size > 6 && lines.length * size * 1.15 > h - pad * 2) {
      size -= 0.5;
      lines = wrap(text, w - pad * 2, (s) => width(s, size));
    }
    lines.forEach((l, i) => {
      const lw = width(l, size);
      const x = align === 1 ? (w - lw) / 2 : align === 2 ? w - pad - lw : pad;
      ops.push(`1 0 0 1 ${num(x)} ${num(h - pad - size * 0.9 - i * size * 1.15)} Tm <${hex(l)}> Tj`);
    });
  } else {
    size = size || Math.min(12, (h - pad * 2) * 0.8);
    if (!daSize) while (size > 5 && width(text, size) > w - pad * 2) size -= 0.5;
    const lw = width(text, size);
    const x = align === 1 ? (w - lw) / 2 : align === 2 ? w - pad - lw : pad;
    ops.push(`1 0 0 1 ${num(x)} ${num((h - size * 0.72) / 2)} Tm <${hex(text)}> Tj`);
  }

  const content = `/Tx BMC q ${num(pad / 2)} ${num(pad / 2)} ${num(w - pad)} ${num(h - pad)} re W n BT /SowujuK ${num(size)} Tf ${color.map(num).join(' ')} rg ${ops.join(' ')} ET Q EMC`;
  const fonts = doc.newDictionary();
  fonts.put('SowujuK', ref);
  const res = doc.newDictionary();
  res.put('Font', fonts);
  const dict = doc.newDictionary();
  dict.put('Type', doc.newName('XObject'));
  dict.put('Subtype', doc.newName('Form'));
  const bbox = doc.newArray();
  [0, 0, w, h].forEach((v) => bbox.push(v));
  dict.put('BBox', bbox);
  dict.put('Resources', res);
  const xobj = doc.addStream(content, dict);
  let ap = o.get('AP');
  if (!ap.isDictionary()) { ap = doc.newDictionary(); o.put('AP', ap); }
  ap.put('N', xobj);
  ap.delete('D');
  // 다른 프로그램이 모양을 다시 만들 때도 같은 글꼴을 쓰도록 DA 도 맞춘다
  const dr = doc.getTrailer().get('Root').get('AcroForm');
  if (dr.isDictionary()) {
    let d = dr.get('DR');
    if (!d.isDictionary()) { d = doc.newDictionary(); dr.put('DR', d); }
    let f = d.get('Font');
    if (!f.isDictionary()) { f = doc.newDictionary(); d.put('Font', f); }
    f.put('SowujuK', ref);
    dr.put('NeedAppearances', false);
  }
  // 우리가 만든 칸(한글 표준 글꼴 KoDotum)은 다른 프로그램에서도 새 글자를 쓸 수 있게 DA를 그대로 둔다
  const da = o.get('DA');
  if (!(da.isString() && /\/KoDotum\b/.test(da.asString()))) o.put('DA', doc.newString(`/SowujuK ${num(daSize)} Tf ${color.map(num).join(' ')} rg`));
}

/** 칸 폭에 맞춰 줄을 나눈다 (줄바꿈 글자는 그대로, 한글은 글자 단위로도 나눈다) */
function wrap(text: string, max: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && measure(line + ch) > max) {
        // 영어·숫자 낱말은 통째로 다음 줄로
        const m = /(\S+)$/.exec(line);
        if (/[A-Za-z0-9]/.test(ch) && m && /^[A-Za-z0-9]+$/.test(m[1]) && m[1].length < line.length) {
          out.push(line.slice(0, -m[1].length).trimEnd());
          line = m[1] + ch;
        } else {
          out.push(line.trimEnd());
          line = ch === ' ' ? '' : ch;
        }
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}
