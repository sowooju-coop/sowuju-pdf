// 쪽 번호와 워터마크를 페이지 내용으로 쓴다 (화면에 보이는 방향 그대로, 회전된 쪽 포함)
import * as mupdf from 'mupdf';
import type { PageNumberOptions, WatermarkOptions } from '../lib/protocol';
import { addResource, appendContent, applyMatrix, num } from './pdfUtil';
import { pdfFont } from './textEdit';

function widthOf(font: mupdf.Font, text: string, size: number) {
  let w = 0;
  for (const ch of text) w += font.advanceGlyph(font.encodeCharacter(ch.codePointAt(0)!), 0);
  return w * size;
}

function hexOf(font: mupdf.Font, text: string) {
  let s = '';
  for (const ch of text) s += font.encodeCharacter(ch.codePointAt(0)!).toString(16).padStart(4, '0');
  return s;
}

/** 투명도 그래픽 상태 (1이면 없음) */
function alphaGs(doc: mupdf.PDFDocument, page: mupdf.PDFPage, alpha: number) {
  if (alpha >= 1) return '';
  const gs = doc.newDictionary();
  gs.put('Type', doc.newName('ExtGState'));
  gs.put('ca', alpha);
  gs.put('CA', alpha);
  return `/${addResource(doc, page, 'ExtGState', 'SowujuA', doc.addObject(gs))} gs `;
}

/**
 * 화면 좌표(위가 0)에서 (x, y)를 글자 기준선 시작점으로, ang(라디안, 화면에서 시계 반대 방향) 방향으로 쓴다
 */
function textOp(page: mupdf.PDFPage, key: string, hex: string, size: number, x: number, y: number, ang: number, rgb: [number, number, number], gs: string) {
  const inv = mupdf.Matrix.invert(page.getTransform());
  const [ox, oy] = applyMatrix(inv, x, y);
  const [ax, ay] = applyMatrix(inv, x + Math.cos(ang), y - Math.sin(ang));
  const [bx, by] = applyMatrix(inv, x - Math.sin(ang), y - Math.cos(ang));
  const u = [ax - ox, ay - oy], v = [bx - ox, by - oy];
  return `q ${gs}BT ${rgb.map(num).join(' ')} rg ${[u[0], u[1], v[0], v[1], ox, oy].map(num).join(' ')} Tm /${key} ${num(size)} Tf <${hex}> Tj ET Q`;
}

export function pageLabel(o: PageNumberOptions, n: number, total: number) {
  switch (o.format) {
    case 'dash': return `- ${n} -`;
    case 'slash': return `${n} / ${total}`;
    case 'kor': return `${n}쪽`;
    default: return String(n);
  }
}

export async function addPageNumbers(doc: mupdf.PDFDocument, o: PageNumberOptions) {
  const { ref, font } = await pdfFont(doc, o.fontFile);
  const n = doc.countPages();
  const targets = [...Array(n).keys()].filter((i) => !(o.skipFirst && i === 0));
  const total = o.start + targets.length - 1;
  targets.forEach((i, k) => {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const W = x1 - x0, H = y1 - y0;
    const text = pageLabel(o, o.start + k, total);
    const w = widthOf(font, text, o.size);
    const m = o.margin;
    const [v, h] = o.position;
    // 홀짝 바꾸기: 짝수 쪽에서는 좌우를 바꾼다 (양면 인쇄 제본)
    const hh = o.mirror && (o.start + k) % 2 === 0 ? (h === 'l' ? 'r' : h === 'r' ? 'l' : h) : h;
    const x = hh === 'l' ? m : hh === 'r' ? W - m - w : (W - w) / 2;
    const y = v === 't' ? m + o.size * 0.8 : H - m;
    const key = addResource(doc, page, 'Font', 'SowujuN', ref);
    appendContent(doc, page, textOp(page, key, hexOf(font, text), o.size, x, y, 0, o.color, ''));
    page.destroy();
  });
}

export async function addWatermark(doc: mupdf.PDFDocument, o: WatermarkOptions) {
  const text = o.text.trim();
  if (!text) return;
  const { ref, font } = await pdfFont(doc, o.fontFile);
  const unit = widthOf(font, text, 1) || 1;
  for (let i = 0; i < doc.countPages(); i++) {
    if (o.pages && !o.pages.includes(i)) continue;
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const W = x1 - x0, H = y1 - y0;
    const ang = o.diagonal ? Math.atan2(H, W) : 0;
    // 크기 '자동'이면 쪽의 가로(대각선)의 60%까지, 글자 높이는 짧은 변의 30%까지
    const span = o.diagonal ? Math.hypot(W, H) : W;
    const size = o.size > 0 ? o.size : Math.min(span * 0.6 / unit, Math.min(W, H) * 0.3);
    const w = unit * size;
    const cap = size * 0.7;
    // 가운데에서 글자 폭의 절반만큼 뒤로, 글자 높이의 절반만큼 아래로
    const cx = W / 2, cy = H / 2;
    const x = cx - Math.cos(ang) * w / 2 + Math.sin(ang) * cap / 2;
    const y = cy + Math.sin(ang) * w / 2 + Math.cos(ang) * cap / 2;
    const key = addResource(doc, page, 'Font', 'SowujuW', ref);
    appendContent(doc, page, textOp(page, key, hexOf(font, text), size, x, y, ang, o.color, alphaGs(doc, page, o.opacity)));
    page.destroy();
  }
}
