// 보호 메뉴: 개인정보 찾기·지우기, 문서 정보 지우기, 그림 줄여 용량 줄이기
import * as mupdf from 'mupdf';
import { findInLines, privacyRules, type PrivacyHit } from '../lib/privacy';
import { readLines } from './textEdit';

/** 모든 쪽에서 개인정보를 찾는다. 글자가 하나도 없는 쪽(스캔 등)도 알려 준다 */
export function findPrivate(doc: mupdf.PDFDocument, rrnBackOnly: boolean, search: string[]) {
  const rules = privacyRules(rrnBackOnly);
  const hits: PrivacyHit[] = [];
  const noText: number[] = [];
  const n = doc.countPages();
  for (let p = 0; p < n; p++) {
    const lines = readLines(doc, p);
    if (!lines.length) noText.push(p);
    findInLines(p, lines, rules, search).forEach((h, k) => hits.push({ ...h, id: `${p}-${k}` }));
  }
  return { hits, noText };
}

/**
 * 고른 상자 안의 글자·그림·선을 파일에서 진짜로 지우고 검은 상자로 덮는다.
 * 글자는 지우고, 그림은 그 부분 픽셀만 지운다. 표 선은 남긴다.
 */
export function redactAreas(doc: mupdf.PDFDocument, areas: { page: number; rects: [number, number, number, number][] }[]) {
  const byPage = new Map<number, [number, number, number, number][]>();
  for (const a of areas) byPage.set(a.page, [...(byPage.get(a.page) ?? []), ...a.rects]);
  for (const [index, rects] of byPage) {
    if (!rects.length) continue;
    const page = doc.loadPage(index);
    for (const r of rects) {
      const annot = page.createAnnotation('Redact');
      annot.setRect(r);
      annot.update();
    }
    page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    page.destroy();
  }
}

/** 작성자·프로그램 같은 문서 정보와 XMP 정보를 지운다 */
export function clearDocInfo(doc: mupdf.PDFDocument) {
  for (const k of ['info:Author', 'info:Subject', 'info:Keywords', 'info:Creator', 'info:Producer']) {
    try { doc.setMetaData(k, ''); } catch { /* 없는 항목 */ }
  }
  const root = doc.getTrailer().get('Root');
  if (!root.isNull()) root.delete('Metadata');
}

/** 용량 줄이기 단계: 그림의 긴 변 최대 픽셀, JPEG 품질 */
export const SHRINK = {
  light: { max: 2400, q: 82 },
  normal: { max: 1800, q: 72 },
  strong: { max: 1200, q: 60 },
} as const;
export type ShrinkLevel = keyof typeof SHRINK;

/** 큰 그림을 줄이고 JPEG로 다시 담는다 (사본 문서에서 실행) */
export function shrinkImages(doc: mupdf.PDFDocument, level: ShrinkLevel) {
  const { max, q } = SHRINK[level];
  const n = doc.countObjects();
  // 투명도 마스크로 쓰이는 그림은 손대지 않는다 (가장자리가 번지지 않게)
  const masks = new Set<number>();
  for (let i = 1; i < n; i++) {
    const o = doc.newIndirect(i);
    try {
      if (!o.isStream()) continue;
      const sm = o.get('SMask');
      if (sm.isIndirect()) masks.add(sm.asIndirect());
    } catch { /* 깨진 객체는 건너뛴다 */ }
  }
  let changed = 0;
  for (let i = 1; i < n; i++) {
    if (masks.has(i)) continue;
    const o = doc.newIndirect(i);
    try {
      if (!o.isStream() || o.get('Subtype').asName() !== 'Image') continue;
      if (o.get('ImageMask').asBoolean() || o.get('Mask').isArray()) continue;
      const raw = o.readRawStream().length;
      if (raw < 40 * 1024) continue;
      const w = o.get('Width').asNumber(), h = o.get('Height').asNumber();
      const scale = Math.min(1, max / Math.max(w, h));
      const filter = o.get('Filter');
      const isJpeg = filter.isName() ? filter.asName() === 'DCTDecode' : false;
      if (scale === 1 && isJpeg) continue;
      const img = doc.loadImage(o);
      const gray = img.getNumberOfComponents() === 1;
      const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
      const pix = new mupdf.Pixmap(gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB, [0, 0, nw, nh], false);
      pix.clear(255);
      const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
      dev.fillImage(img, [nw, 0, 0, nh, 0, 0], 1);
      dev.close(); dev.destroy();
      const jpg = pix.asJPEG(q).slice();
      pix.destroy(); img.destroy();
      if (jpg.length >= raw * 0.9) continue;
      o.writeRawStream(jpg);
      o.put('Filter', doc.newName('DCTDecode'));
      o.put('Width', nw);
      o.put('Height', nh);
      o.put('BitsPerComponent', 8);
      o.put('ColorSpace', doc.newName(gray ? 'DeviceGray' : 'DeviceRGB'));
      o.delete('DecodeParms');
      o.delete('Decode');
      changed++;
    } catch { /* 줄이지 못한 그림은 그대로 둔다 */ }
  }
  return changed;
}

/**
 * 암호 저장 옵션. printOnly 면 아무 암호(소유자 암호)를 따로 만들어 걸어서
 * 열 수는 있지만 인쇄만 되고 복사·수정은 막는다.
 */
export function encryptOptions(password: string, printOnly: boolean) {
  const esc = (s: string) => s.replace(/,/g, '');
  const owner = printOnly ? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('') : password;
  // PDF 권한 비트: 인쇄(4)·고품질 인쇄(2048)만 허용, 나머지 금지. 쓰지 않는 상위 비트는 1로 둔다
  const perms = printOnly ? (0xFFFFF0C0 | 4 | 2048) | 0 : -4;
  return `encrypt=aes-256,user-password=${esc(password)},owner-password=${esc(owner)},permissions=${perms}`;
}
