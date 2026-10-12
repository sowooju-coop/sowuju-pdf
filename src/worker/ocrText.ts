// 글자 읽기(OCR) 결과를 보이지 않는 글자(그리기 방식 3)로 쪽에 넣는다.
// 화면·인쇄 모양은 그대로이고, 찾기·복사·글자 고르기가 된다. 낱말마다 폭을 원래 그림의 낱말 폭에 맞춘다.
import * as mupdf from 'mupdf';
import type { OcrWord } from '../lib/protocol';
import { addResource, appendContent, applyMatrix, num } from './pdfUtil';
import { pdfFont } from './textEdit';

export const OCR_FONT = 'Pretendard-Regular.ttf';

/** 글자가 하나도 없는 쪽 (스캔한 쪽) */
export function textlessPages(doc: mupdf.PDFDocument) {
  const out: number[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const st = page.toStructuredText('');
    let has = false;
    st.walk({ onChar: (c: string) => { if (!has && c.trim()) has = true; } });
    st.destroy(); page.destroy();
    if (!has) out.push(i);
  }
  return out;
}

export async function addOcrText(doc: mupdf.PDFDocument, index: number, scale: number, words: OcrWord[]) {
  if (!words.length) return;
  const { ref, font } = await pdfFont(doc, OCR_FONT);
  const page = doc.loadPage(index);
  const key = addResource(doc, page, 'Font', 'SowujuOCR', ref);
  const inv = mupdf.Matrix.invert(page.getTransform());
  const ops: string[] = [];
  const space = font.encodeCharacter(32);
  const spaceHex = space.toString(16).padStart(4, '0');
  for (const w of words) {
    let hex = '', adv = 0;
    for (const ch of w.text) {
      const g = font.encodeCharacter(ch.codePointAt(0)!);
      hex += g.toString(16).padStart(4, '0');
      adv += font.advanceGlyph(g, 0);
    }
    if (!hex || adv <= 0) continue;
    // 낱말 뒤 띄어쓰기: 복사·찾기에서 낱말이 붙거나 줄이 갈라지지 않게 (폭 계산에는 넣지 않는다)
    if (!w.last) hex += spaceHex;
    // 그림 픽셀 → 화면 좌표(pt, 위가 0) → PDF 좌표
    const x = w.x0 / scale, y = w.base / scale, wd = (w.x1 - w.x0) / scale;
    const size = Math.max(2, (w.lineH / scale) * 0.85);
    const tz = Math.max(10, Math.min(400, (wd / (adv * size)) * 100));
    const [ox, oy] = applyMatrix(inv, x, y);
    const [ax, ay] = applyMatrix(inv, x + 1, y);
    const [bx, by] = applyMatrix(inv, x, y - 1);
    ops.push(`BT 3 Tr /${key} ${num(size)} Tf ${num(tz)} Tz ${[ax - ox, ay - oy, bx - ox, by - oy, ox, oy].map(num).join(' ')} Tm <${hex}> Tj ET`);
  }
  if (ops.length) appendContent(doc, page, `q\n${ops.join('\n')}\nQ`);
  page.destroy();
}
