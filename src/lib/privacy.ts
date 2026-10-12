// 개인정보 찾기 규칙. 작업 스레드에서 줄 글자와 함께 쓴다
import type { TextLine } from './protocol';

export type PrivacyKind = 'rrn' | 'mobile' | 'phone' | 'email' | 'account' | 'search';

export const PRIVACY_LABEL: Record<PrivacyKind, string> = {
  rrn: '주민·외국인등록번호',
  mobile: '휴대전화',
  phone: '전화번호',
  email: '이메일',
  account: '계좌번호',
  search: '찾은 글자',
};

/** 찾은 개인정보 한 건. rects 는 가릴 상자들 (화면 좌표 pt, 위가 0) */
export interface PrivacyHit {
  id: string;
  page: number;
  kind: PrivacyKind;
  text: string;
  rects: [number, number, number, number][];
}

interface Rule { kind: PrivacyKind; re: RegExp; /** 일부만 가릴 때: 가릴 묶음 번호 */ group?: number }

/** 주민번호는 기본으로 뒷자리만 가린다 (서류에서 흔히 쓰는 방식) */
export function privacyRules(rrnBackOnly: boolean): Rule[] {
  return [
    { kind: 'rrn', re: /(?<!\d)(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))\s?[-–]?\s?([1-8]\d{6})(?!\d)/g, group: rrnBackOnly ? 2 : undefined },
    { kind: 'mobile', re: /(?<!\d)01[016789][-.\s)]?\s?\d{3,4}[-.\s]?\d{4}(?!\d)/g },
    { kind: 'phone', re: /(?<!\d)\(?0(?:2|[3-6][1-5]|70|50\d?)\)?[-.\s)]?\s?\d{3,4}[-.\s]?\d{4}(?!\d)/g },
    { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    // 은행 계좌: 숫자 묶음 3~4개, 전체 10~16자리 (전화번호·날짜와 겹치지 않게 길이로 거른다)
    { kind: 'account', re: /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,7}(?:-\d{1,3})?(?![\d-])/g },
  ];
}

/** 한 쪽의 줄들에서 개인정보를 찾는다 */
export function findInLines(page: number, lines: TextLine[], rules: Rule[], search: string[] = []): Omit<PrivacyHit, 'id'>[] {
  const out: Omit<PrivacyHit, 'id'>[] = [];
  for (const line of lines) {
    const text = line.chars.map((c) => c.c).join('');
    const taken: [number, number][] = [];
    const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
    const add = (kind: PrivacyKind, s: number, e: number, cs: number, ce: number) => {
      if (overlaps(s, e)) return;
      taken.push([s, e]);
      out.push({ page, kind, text: text.slice(s, e), rects: boxes(line, cs, ce) });
    };
    for (const r of rules) {
      r.re.lastIndex = 0;
      for (let m = r.re.exec(text); m; m = r.re.exec(text)) {
        const s = m.index, e = s + m[0].length;
        if (r.kind === 'account') {
          const digits = m[0].replace(/\D/g, '').length;
          if (digits < 10 || digits > 16 || /^01[016789]-/.test(m[0]) || /^0\d{1,2}-\d{3,4}-\d{4}$/.test(m[0]) || /^(19|20)\d{2}-/.test(m[0])) continue;
        }
        if (r.group) {
          const g = m[r.group];
          const gs = s + m[0].lastIndexOf(g);
          add(r.kind, s, e, gs, gs + g.length);
        } else add(r.kind, s, e, s, e);
      }
    }
    for (const word of search) {
      const w = word.trim();
      if (!w) continue;
      for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) add('search', i, i + w.length, i, i + w.length);
    }
  }
  return out;
}

/** 글자 i0..i1 의 상자를 한 줄 상자로 합친다 (빈칸은 빼고) */
function boxes(line: TextLine, i0: number, i1: number): [number, number, number, number][] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ch of line.chars.slice(i0, i1)) {
    if (!ch.c.trim()) continue;
    const q = ch.quad, xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
    x0 = Math.min(x0, ...xs); x1 = Math.max(x1, ...xs); y0 = Math.min(y0, ...ys); y1 = Math.max(y1, ...ys);
  }
  if (!isFinite(x0)) return [];
  // 글자 상자는 옆 글자와 맞닿아 있어서, 양옆을 조금 안으로 들여야 이웃 글자(주민번호의 '-' 등)가 함께 지워지지 않는다.
  // 검은 상자는 화면 미리보기와 같은 자리에 그려진다
  const h = y1 - y0, px = Math.min(h * 0.12, (x1 - x0) * 0.1);
  return [[x0 + px, y0 - h * 0.05, x1 - px, y1 + h * 0.05]];
}
