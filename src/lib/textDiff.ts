// 고친 글자와 원래 글자를 비교해, 실제로 바뀐 부분만 다시 쓰는 요청을 만든다.
import type { ReplaceRequest, TextChar, TextLine } from './protocol';
import { fontFile, textWidth, type FontFamily } from './fonts';

export interface EditStyle {
  /** 원래 글꼴에 없는 글자를 쓸 비슷한 글꼴 */
  family: FontFamily;
  bold: boolean;
  /** 원래 글꼴을 쓸 때: PDF 글꼴 번호와 브라우저 글꼴 이름 */
  orig?: { key: number; css: string; ascent: number; descent: number };
}

const dot = (ax: number, ay: number, d: [number, number]) => ax * d[0] + ay * d[1];

/** 글자 j의 끝 위치: 다음 글자의 시작점, 마지막 글자면 상자의 오른쪽 끝 (줄 방향으로 잰 거리) */
function endOf(line: TextLine, j: number, origin: TextChar): number {
  const d = line.dir;
  const next = line.chars[j + 1];
  if (next) return dot(next.x - origin.x, next.y - origin.y, d);
  const q = line.chars[j].quad;
  return Math.max(dot(q[2] - origin.x, q[3] - origin.y, d), dot(q[6] - origin.x, q[7] - origin.y, d));
}

/** 원래 줄 폭에 우리 글꼴을 맞추는 기본 자간 */
function baseSpacing(line: TextLine, from: number, style: EditStyle, size: number) {
  const chars = line.chars.slice(from);
  const text = chars.map((c) => c.c).join('');
  if (!text) return 0;
  const actual = endOf(line, line.chars.length - 1, line.chars[from]);
  const sp = (actual - textWidth(text, style.family, style.bold, size, 0, style.orig?.css)) / [...text].length;
  return Math.max(-size * 0.12, Math.min(size * 0.2, sp));
}

export function selectedText(line: TextLine, i0: number, i1: number) {
  return line.chars.slice(i0, i1 + 1).map((c) => c.c).join('');
}

/** 바뀐 것이 없으면 null */
export function buildReplace(page: number, line: TextLine, i0: number, i1: number, input: string, style: EditStyle): ReplaceRequest | null {
  const og = line.chars.slice(i0, i1 + 1).map((c) => c.c);
  const nw = [...input];
  if (og.join('') === input) return null;

  let pf = 0;
  while (pf < nw.length && pf < og.length && nw[pf] === og[pf]) pf++;
  let sf = 0;
  while (sf < nw.length - pf && sf < og.length - pf && nw[nw.length - 1 - sf] === og[og.length - 1 - sf]) sf++;

  let j0 = i0 + pf;
  let j1 = i1 - sf;
  let mid = nw.slice(pf, nw.length - sf).join('');
  const last = line.chars.length - 1;
  const ref = line.chars[Math.min(j0, last)];
  const size = ref.size;
  let spacing = 0;
  let fits = false;

  // 바뀐 글자가 원래 자리 폭에 자간 조정만으로 들어가면, 뒤쪽 원래 글자는 손대지 않는다
  if (mid && j1 >= j0) {
    const room = endOf(line, j1, line.chars[j0]);
    const sp = (room - textWidth(mid, style.family, style.bold, size, 0, style.orig?.css)) / [...mid].length;
    if (sp >= -size * 0.12 && sp <= size * 0.2) { spacing = sp; fits = true; }
  }
  // 들어가지 않거나 글자를 지운 경우: 줄 끝까지 다시 써서 뒤 글자가 자연스럽게 밀리거나 당겨지게 한다
  if (!fits) {
    j1 = last;
    mid = nw.slice(pf).join('') + line.chars.slice(i1 + 1).map((c) => c.c).join('');
    spacing = baseSpacing(line, Math.min(j0, last), style, size);
  }
  if (j0 > last) return null;

  const start = line.chars[j0];
  const inked = line.chars.slice(j0, j1 + 1).filter((c) => c.c.trim());
  const color = (inked[0] ?? start).color;
  return {
    page,
    remove: line.chars.slice(j0, j1 + 1).map((c) => c.quad),
    text: mid.replace(/\s+$/, ''),
    x: start.x,
    y: start.y,
    dir: line.dir,
    size,
    spacing: Math.round(spacing * 1000) / 1000,
    color,
    fontFile: fontFile(style.family, style.bold),
    origFont: style.orig?.key,
  };
}
