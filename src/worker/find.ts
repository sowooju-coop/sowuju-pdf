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
