// 문서 안 글자 찾기. 띄어쓰기와 영어 대소문자를 가리지 않는다 ('표창요령'으로 '표창 요령'도 찾음)
import * as mupdf from 'mupdf';
import type { TextLine } from '../lib/protocol';
import { readLines } from './textEdit';

export interface FindHit { page: number; rect: [number, number, number, number]; text: string }

/** 쪽마다 읽은 줄 (문서가 바뀌면 비운다) */
const cache = new WeakMap<mupdf.PDFDocument, Map<number, TextLine[]>>();
export function clearFindCache(doc: mupdf.PDFDocument) { cache.delete(doc); }

function linesOf(doc: mupdf.PDFDocument, p: number) {
  let m = cache.get(doc);
  if (!m) cache.set(doc, (m = new Map()));
  if (!m.has(p)) m.set(p, readLines(doc, p));
  return m.get(p)!;
}

const norm = (s: string) => s.toLowerCase();

export function findText(doc: mupdf.PDFDocument, query: string, limit = 3000): FindHit[] {
  const q = norm(query.replace(/\s+/g, ''));
  if (!q) return [];
  const out: FindHit[] = [];
  const n = doc.countPages();
  for (let p = 0; p < n && out.length < limit; p++) {
    for (const line of linesOf(doc, p)) {
      // 빈칸을 뺀 글자와 원래 글자 번호를 함께 둔다
      const idx: number[] = [];
      let flat = '';
      line.chars.forEach((c, i) => { if (c.c.trim()) { flat += norm(c.c); idx.push(i); } });
      for (let k = flat.indexOf(q); k >= 0 && out.length < limit; k = flat.indexOf(q, k + q.length)) {
        const i0 = idx[k], i1 = idx[k + q.length - 1];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of line.chars.slice(i0, i1 + 1)) {
          const qd = c.quad;
          x0 = Math.min(x0, qd[0], qd[2], qd[4], qd[6]); x1 = Math.max(x1, qd[0], qd[2], qd[4], qd[6]);
          y0 = Math.min(y0, qd[1], qd[3], qd[5], qd[7]); y1 = Math.max(y1, qd[1], qd[3], qd[5], qd[7]);
        }
        const text = line.chars.map((c) => c.c).join('');
        out.push({ page: p, rect: [x0, y0, x1, y1], text: text.trim().slice(0, 80) });
      }
    }
  }
  return out;
}

/** 비교용: 쪽마다 낱말(띄어쓰기로 나눈 것)과 위치 */
export function pageWords(doc: mupdf.PDFDocument): { page: number; t: string; r: [number, number, number, number] }[] {
  const out: { page: number; t: string; r: [number, number, number, number] }[] = [];
  const n = doc.countPages();
  for (let p = 0; p < n; p++) {
    // 파일 안 순서가 아니라 화면 순서(위→아래, 같은 줄은 왼쪽→오른쪽)로: 고친 글자가 파일 끝에 붙어 있어도 제자리에서 비교
    const lines = [...linesOf(doc, p)].sort((a, b) => {
      const ha = a.bbox[3] - a.bbox[1], hb = b.bbox[3] - b.bbox[1];
      const sameRow = Math.abs((a.bbox[1] + a.bbox[3]) / 2 - (b.bbox[1] + b.bbox[3]) / 2) < Math.min(ha, hb) * 0.5;
      return sameRow ? a.bbox[0] - b.bbox[0] : a.bbox[1] - b.bbox[1];
    });
    for (const line of lines) {
      let t = '', x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const flush = () => { if (t) out.push({ page: p, t, r: [x0, y0, x1, y1] }); t = ''; x0 = y0 = Infinity; x1 = y1 = -Infinity; };
      for (const c of line.chars) {
        if (!c.c.trim()) { flush(); continue; }
        t += c.c;
        const q = c.quad;
        x0 = Math.min(x0, q[0], q[2], q[4], q[6]); x1 = Math.max(x1, q[0], q[2], q[4], q[6]);
        y0 = Math.min(y0, q[1], q[3], q[5], q[7]); y1 = Math.max(y1, q[1], q[3], q[5], q[7]);
      }
      flush();
    }
  }
  return out;
}
