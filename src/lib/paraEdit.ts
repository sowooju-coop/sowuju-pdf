// 여러 줄 문단 고치기: 문단 찾기, 문단 글자, 고친 글자를 원래 문단 폭·줄 간격·들여쓰기·양쪽 정렬에 맞춰 다시 나누기
import type { ReplaceParaRequest, TextChar, TextLine } from './protocol';
import { fontFile, textWidth } from './fonts';
import type { EditStyle } from './textDiff';

const box = (q: number[]) => [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
const inked = (l: TextLine) => l.chars.filter((c) => c.c.trim());
const sizeOf = (l: TextLine) => { const v = inked(l); return v.reduce((a, c) => a + c.size, 0) / Math.max(1, v.length); };
const leftOf = (l: TextLine) => Math.min(...inked(l).map((c) => box(c.quad)[0]));
const rightOf = (l: TextLine) => Math.max(...inked(l).map((c) => box(c.quad)[2]));
const baseOf = (l: TextLine) => inked(l)[0]?.y ?? l.bbox[3];
const horizontal = (l: TextLine) => Math.abs(l.dir[1]) < 0.01 && l.dir[0] > 0;

/** 고른 줄이 속한 문단의 줄 번호들 (위→아래). 같은 크기, 가로쓰기, 줄 간격이 고르고 가로로 겹치는 줄 */
export function findParagraph(lines: TextLine[], li: number): number[] {
  const me = lines[li];
  if (!horizontal(me) || !inked(me).length) return [li];
  const size = sizeOf(me);
  const cand = lines.map((l, i) => ({ l, i })).filter(({ l }) => horizontal(l) && inked(l).length && Math.abs(sizeOf(l) - size) < size * 0.08)
    .sort((a, b) => baseOf(a.l) - baseOf(b.l));
  const k = cand.findIndex((c) => c.i === li);
  const overlaps = (a: TextLine, b: TextLine) => Math.min(rightOf(a), rightOf(b)) - Math.max(leftOf(a), leftOf(b)) > size * 2;
  // 같은 높이(같은 줄의 다른 칸)는 빼고, 위아래로 이어진 줄만
  const out = [k];
  let pitch = 0;
  const step = (dir: -1 | 1) => {
    let cur = k;
    for (let j = k + dir; j >= 0 && j < cand.length; j += dir) {
      const a = cand[cur].l, b = cand[j].l;
      const gap = Math.abs(baseOf(b) - baseOf(a));
      if (gap < size * 0.5) continue; // 같은 줄 높이 (표의 다른 칸 등)
      if (gap > size * 2.2 || !overlaps(a, b)) break;
      if (pitch && Math.abs(gap - pitch) > size * 0.35) break;
      // 왼쪽 끝이 크게 다르면 다른 문단 (첫 줄 들여쓰기·내어쓰기 정도는 허용)
      if (Math.abs(leftOf(a) - leftOf(b)) > size * 3) break;
      pitch = pitch || gap;
      out.push(j);
      cur = j;
    }
  };
  step(1); step(-1);
  return out.map((j) => cand[j].i).sort((a, b) => baseOf(lines[a]) - baseOf(lines[b]));
}

/** 문단 글자: 줄 사이는 띄어쓰기로 잇는다 (줄 끝이 '-'로 끊긴 영어 낱말은 붙인다) */
export function paraText(lines: TextLine[], lis: number[]) {
  let out = '';
  for (const li of lis) {
    const t = lines[li].chars.map((c) => c.c).join('').trim();
    if (!out) out = t;
    else if (/[A-Za-z]-$/.test(out)) out = out.slice(0, -1) + t;
    else out += ' ' + t;
  }
  return out;
}

/** 문단 모양: 왼쪽·오른쪽 끝, 첫 줄 시작, 이어지는 줄 시작, 첫 줄 바닥선, 줄 간격, 글자 크기, 양쪽 정렬인지 */
export function paraGeometry(lines: TextLine[], lis: number[]) {
  const ls = lis.map((i) => lines[i]);
  const size = sizeOf(ls[0]);
  const lefts = ls.map(leftOf), rights = ls.map(rightOf);
  const left = Math.min(...lefts), right = Math.max(...rights);
  const bases = ls.map(baseOf);
  const pitch = bases.length > 1 ? (bases[bases.length - 1] - bases[0]) / (bases.length - 1) : size * 1.6;
  // 마지막 줄을 뺀 줄들의 오른쪽 끝이 고르면 양쪽 정렬
  const full = rights.slice(0, -1);
  const justify = full.length > 0 && full.every((r) => Math.abs(r - right) < size * 0.6);
  return { left, right, first: lefts[0], rest: ls.length > 1 ? lefts[1] : lefts[0], base: bases[0], pitch, size, justify, lineCount: ls.length };
}

/** 글자를 폭에 맞게 줄로 나눈다 (한글은 띄어쓰기에서, 띄어쓰기가 없으면 글자 단위) */
function wrap(text: string, widthFirst: number, widthRest: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    const max = () => (out.length === 0 ? widthFirst : widthRest);
    for (const w of words) {
      const next = line + w;
      if (!line || measure(next.trimEnd()) <= max()) { line = next; continue; }
      if (/^\s+$/.test(w)) { out.push(line.trimEnd()); line = ''; continue; }
      out.push(line.trimEnd());
      line = w;
      // 한 낱말이 한 줄보다 길면 글자 단위로 자른다
      while (measure(line) > max()) {
        let k = line.length;
        while (k > 1 && measure(line.slice(0, k)) > max()) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** 고친 문단을 다시 쓰는 요청. 바뀐 게 없으면 null */
export function buildParaReplace(page: number, lines: TextLine[], lis: number[], input: string, style: EditStyle): { req: ReplaceParaRequest; grew: number } | null {
  const before = paraText(lines, lis);
  const text = input.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (text === before) return null;
  const g = paraGeometry(lines, lis);
  const measure = (s: string) => textWidth(s, style.family, style.bold, g.size, 0, style.orig?.css);
  const rows = text ? wrap(text, g.right - g.first, g.right - g.rest, measure) : [];
  const ref: TextChar = inked(lines[lis[0]])[0];
  const out = rows.map((t, i) => {
    const x = i === 0 ? g.first : g.rest;
    const width = g.right - x;
    // 양쪽 정렬: 문단 끝 줄과 줄바꿈 바로 앞 줄은 왼쪽 정렬
    const lastOfPara = i === rows.length - 1 || text.split('\n').length > 1 && isBreakBefore(text, rows, i);
    let spacing = 0;
    if (g.justify && !lastOfPara && [...t].length > 1) {
      const sp = (width - measure(t)) / ([...t].length - 1);
      if (sp > -g.size * 0.1 && sp < g.size * 0.6) spacing = sp;
    }
    return { text: t, x, y: g.base + i * g.pitch, spacing: Math.round(spacing * 1000) / 1000 };
  }).filter((r) => r.text.trim());
  return {
    req: {
      page,
      remove: lis.flatMap((li) => lines[li].chars.map((c) => c.quad)),
      lines: out,
      dir: [1, 0],
      size: g.size,
      color: ref.color,
      fontFile: fontFile(style.family, style.bold),
      origFont: style.orig?.key,
    },
    grew: rows.length - g.lineCount,
  };
}

/** rows[i] 다음에 사용자가 넣은 줄바꿈이 있는지 */
function isBreakBefore(text: string, rows: string[], i: number) {
  const upto = rows.slice(0, i + 1).join('').replace(/\s/g, '').length;
  let n = 0;
  for (let k = 0; k < text.length; k++) {
    if (!/\s/.test(text[k])) n++;
    if (n === upto) { const rest = text.slice(k + 1); return /^[ \t]*\n/.test(rest); }
  }
  return false;
}
