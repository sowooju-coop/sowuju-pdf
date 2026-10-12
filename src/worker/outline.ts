// 책갈피(목차): 읽기, 통째로 다시 쓰기, 큰 글씨 제목으로 자동 만들기
import * as mupdf from 'mupdf';
import type { Bookmark } from '../lib/protocol';
import { applyMatrix } from './pdfUtil';
import { readLines } from './textEdit';

export function getOutline(doc: mupdf.PDFDocument): Bookmark[] {
  type Item = NonNullable<ReturnType<mupdf.PDFDocument['loadOutline']>>[number];
  const conv = (items: Item[] | null | undefined): Bookmark[] => (items ?? []).map((it) => {
    let page = it.page ?? -1, y: number | undefined;
    if (it.uri) {
      try {
        const d = doc.resolveLinkDestination(it.uri);
        if (page < 0) page = d.page;
        if (typeof d.y === 'number' && Number.isFinite(d.y)) y = d.y;
      } catch { /* 바깥 주소 같은 것은 쪽이 없다 */ }
    }
    return { title: (it.title ?? '').trim() || '(제목 없음)', page, y, open: !!it.open, children: conv(it.down) };
  });
  try { return conv(doc.loadOutline()); } catch { return []; }
}

/** 목차를 통째로 새로 쓴다 (빈 목록이면 목차를 지운다) */
export function setOutline(doc: mupdf.PDFDocument, list: Bookmark[]) {
  const root = doc.getTrailer().get('Root');
  root.delete('Outlines');
  if (!list.length) return;
  const n = doc.countPages();
  const outlines = doc.addObject(doc.newDictionary());
  outlines.put('Type', doc.newName('Outlines'));
  /** 자식 목록을 만들고 열린 자손 수를 돌려준다 */
  const build = (parent: mupdf.PDFObject, items: Bookmark[]): number => {
    let prev: mupdf.PDFObject | null = null, first: mupdf.PDFObject | null = null, count = 0;
    for (const b of items) {
      const o = doc.addObject(doc.newDictionary());
      o.put('Title', doc.newString(b.title));
      o.put('Parent', parent);
      const pi = Math.max(0, Math.min(n - 1, b.page));
      const dest = doc.newArray();
      dest.push(doc.findPage(pi));
      dest.push(doc.newName('XYZ'));
      dest.push(doc.newNull());
      if (typeof b.y === 'number') {
        // 화면 좌표(위가 0) → PDF 좌표, 제목이 화면 맨 위에 오도록 조금 위를 가리킨다
        const page = doc.loadPage(pi);
        const [, top] = applyMatrix(mupdf.Matrix.invert(page.getTransform()), 0, Math.max(0, b.y - 12));
        page.destroy();
        dest.push(top);
      } else dest.push(doc.newNull());
      dest.push(doc.newNull());
      o.put('Dest', dest);
      if (prev) { prev.put('Next', o); o.put('Prev', prev); } else first = o;
      prev = o;
      count++;
      if (b.children.length) {
        const c = build(o, b.children);
        o.put('Count', b.open ? c : -c);
        if (b.open) count += c;
      }
    }
    if (first) { parent.put('First', first); parent.put('Last', prev!); }
    return count;
  };
  outlines.put('Count', build(outlines, list));
  root.put('Outlines', outlines);
}

const NUMBERED = /^\s*(\d{1,2}\s*[.)]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\s*[.)]?|[IVX]{1,4}\s*\.|제\s*\d+\s*[장절편부]|[가-하]\s*[.)]|[①-⑳])/;
/** 글머리표로 시작하는 줄은 본문 */
const BULLET = /^\s*[❍○●◦•▪■□◆◇\-–—·ㆍ*※▶►>☞]/;
/** 문장으로 끝나는 줄은 본문 */
const SENTENCE = /(니다|한다|있다|없다|된다|이다|었다|였다|합니다|세요|해요)\s*[.。]?$|[.。]$/;
const BOLD = /bold|black|heavy|extrab|semib|demib|[-,]b$|hdr|HY.*(견고딕|헤드라인|중고딕)|견고딕|헤드라인/i;

/**
 * 큰 글씨나 번호 붙은 굵은 줄을 제목으로 보고 목차를 만든다.
 * 쪽마다 되풀이되는 머리글·바닥글과 숫자뿐인 줄은 뺀다
 */
export function autoOutline(doc: mupdf.PDFDocument): Bookmark[] {
  const n = doc.countPages();
  type L = { page: number; y: number; text: string; size: number; bold: boolean };
  const all: L[] = [];
  const sizeCount = new Map<number, number>();
  for (let p = 0; p < n; p++) {
    for (const l of readLines(doc, p)) {
      const text = l.chars.map((c) => c.c).join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const vis = l.chars.filter((c) => c.c.trim());
      const size = Math.round((vis.reduce((a, c) => a + c.size, 0) / Math.max(1, vis.length)) * 2) / 2;
      const bold = vis.filter((c) => BOLD.test(c.font)).length > vis.length / 2;
      all.push({ page: p, y: l.bbox[1], text, size, bold });
      sizeCount.set(size, (sizeCount.get(size) ?? 0) + vis.length);
    }
  }
  // 같은 높이에 따로 놓인 조각(번호 상자 '1' + ' 사업개요')은 한 줄로
  for (let i = all.length - 1; i > 0; i--) {
    const a = all[i - 1], b = all[i];
    if (a.page === b.page && Math.abs(a.y - b.y) < 2.5 && Math.abs(a.size - b.size) < 2 && [...a.text].length <= 4) {
      a.text = `${a.text} ${b.text}`.replace(/\s+/g, ' ');
      a.size = Math.max(a.size, b.size); a.bold = a.bold || b.bold;
      all.splice(i, 1);
    }
  }
  if (!all.length) return [];
  const body = [...sizeCount].sort((a, b) => b[1] - a[1])[0][0];
  const maxSize = Math.max(...all.map((l) => l.size));
  // 여러 쪽에 똑같이 나오는 줄 = 머리글·바닥글
  const seen = new Map<string, Set<number>>();
  for (const l of all) { const s = seen.get(l.text) ?? new Set(); s.add(l.page); seen.set(l.text, s); }
  const repeated = (t: string) => n >= 3 && (seen.get(t)?.size ?? 0) >= Math.max(3, n * 0.3);
  // 같은 쪽에서 바로 위·아래에 붙은 같은 크기 줄 (여러 줄 문단인지 보려고)
  const near = (i: number, d: -1 | 1) => {
    const l = all[i], o = all[i + d];
    return !!o && o.page === l.page && Math.abs(o.size - l.size) < 0.6 && Math.abs(o.y - l.y) < l.size * 1.9 && o.y !== l.y;
  };
  const cand = all.filter((l, i) => {
    const huge = l.size >= maxSize * 0.9 && l.size >= body * 1.2;
    // 문단의 이어지는 줄, 여러 줄 문단의 첫 줄은 제목이 아니다 (아주 큰 글씨는 두 줄 제목일 수 있다)
    if (!huge && near(i, -1) && !NUMBERED.test(l.text)) return false;
    if (!huge && near(i, 1) && !NUMBERED.test(all[i + 1].text)) return false;
    const len = [...l.text].length;
    if (len < 2 || len > 40 || /^[\d\s./()-]+$/.test(l.text) || repeated(l.text) || BULLET.test(l.text) || SENTENCE.test(l.text)) return false;
    if (l.size >= body * 1.25) return true;
    if (l.bold && l.size >= body * 1.15 && len <= 30) return true;
    return NUMBERED.test(l.text) && (l.bold || l.size >= body * 1.08) && len <= 40;
  });
  // 바로 아래 이어지는 같은 크기 줄은 한 제목 (두 줄 제목)
  const merged: L[] = [];
  for (const l of cand) {
    const last = merged[merged.length - 1];
    if (last && last.page === l.page && last.size === l.size && l.y - last.y < l.size * 1.8 && !NUMBERED.test(l.text) && [...last.text].length < 40) last.text += ' ' + l.text;
    else merged.push({ ...l });
  }
  // 글씨 크기 순서로 단계: 가장 큰 크기 → 1단계, 그다음 → 2단계 (그 밖은 2단계)
  const sizes = [...new Set(merged.map((l) => l.size))].sort((a, b) => b - a);
  const big = merged.filter((l) => l.size === sizes[0]).length;
  // 가장 큰 글씨가 문서 제목 하나뿐이면 단계를 하나 내린다
  const levelOf = (s: number) => {
    const rank = sizes.indexOf(s) - (big === 1 && sizes.length > 2 ? 1 : 0);
    return Math.max(0, Math.min(1, rank));
  };
  const out: Bookmark[] = [];
  for (const l of merged.slice(0, 300)) {
    const b: Bookmark = { title: l.text.slice(0, 80), page: l.page, y: l.y, open: true, children: [] };
    const parent = out[out.length - 1];
    if (levelOf(l.size) === 1 && parent) parent.children.push(b);
    else out.push(b);
  }
  return out;
}

/** 쪽에서 가장 큰 글씨 줄 (책갈피 이름 제안) */
export function pageTitle(doc: mupdf.PDFDocument, index: number): { title: string; y: number } | null {
  let best: { title: string; y: number; size: number } | null = null;
  for (const l of readLines(doc, index)) {
    const text = l.chars.map((c) => c.c).join('').replace(/\s+/g, ' ').trim();
    const vis = l.chars.filter((c) => c.c.trim());
    if ([...text].length < 2 || !vis.length) continue;
    const size = vis.reduce((a, c) => a + c.size, 0) / vis.length;
    if (!best || size > best.size + 0.5) best = { title: text.slice(0, 60), y: l.bbox[1], size };
  }
  return best && { title: best.title, y: best.y };
}
