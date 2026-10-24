// 쪽 내용(그리기 명령)을 읽어 혼자 떼어 옮길 수 있는 조각으로 나눈다.
// 조각: 맨 바깥의 q … Q 묶음, BT … ET 글자 묶음, 선·도형 하나(만들기 + 칠하기), 그림 하나(Do, 인라인 그림).
// 쪽을 다시 쓰지 않고 고른 조각만 "q 옮김 cm … Q"로 감싸서 옮기므로 나머지 모양은 1바이트도 바뀌지 않는다.

export interface Op { start: number; end: number; op: string; args: [number, number][] }
export interface Segment {
  start: number;
  end: number;
  kind: 'group' | 'text' | 'path' | 'image';
  /** 조각 안 맨 바깥에서 바꾼 그래픽 상태 명령 (감싼 뒤에 다시 적어 원래 상태를 이어 간다) */
  state: [number, number][];
  /** 이 조각 앞까지 쌓인 cm (쪽 기본 좌표 → 이 조각의 좌표) */
  ctm: [number, number, number, number, number, number];
  /** 묶음(q … Q)이 아닌 조각이 잘라내기(W)를 바꾸면 옮길 수 없다 */
  clip: boolean;
  /** 감싸고 있는 묶음 조각 번호 (없으면 -1) */
  parent: number;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)));
const isWs = (c: number) => WS.has(c);

/** 그리기 명령 목록. 인자 위치(바이트)와 명령 이름 */
export function tokenize(b: Uint8Array): Op[] {
  const ops: Op[] = [];
  let args: [number, number][] = [];
  let first = -1;
  let i = 0;
  const n = b.length;
  const push = (op: string, end: number) => {
    ops.push({ start: first < 0 ? end - op.length : first, end, op, args });
    args = []; first = -1;
  };
  while (i < n) {
    const c = b[i];
    if (isWs(c)) { i++; continue; }
    if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // % 주석
    const s = i;
    if (c === 40) { // ( 문자열 )
      let depth = 0;
      for (; i < n; i++) {
        if (b[i] === 92) { i++; continue; }
        if (b[i] === 40) depth++;
        else if (b[i] === 41 && --depth === 0) { i++; break; }
      }
    } else if (c === 60 && b[i + 1] === 60) { // << 사전 >>
      let depth = 0;
      for (; i < n; i++) {
        if (b[i] === 40) { // 사전 안 문자열
          let d = 0;
          for (; i < n; i++) { if (b[i] === 92) { i++; continue; } if (b[i] === 40) d++; else if (b[i] === 41 && --d === 0) break; }
          continue;
        }
        if (b[i] === 60 && b[i + 1] === 60) { depth++; i++; }
        else if (b[i] === 62 && b[i + 1] === 62) { depth--; i++; if (depth === 0) { i++; break; } }
      }
    } else if (c === 60) { while (i < n && b[i] !== 62) i++; i++; } // <16진 문자열>
    else if (c === 91) { // [ 배열 ]
      let depth = 0;
      for (; i < n; i++) {
        if (b[i] === 40) { let d = 0; for (; i < n; i++) { if (b[i] === 92) { i++; continue; } if (b[i] === 40) d++; else if (b[i] === 41 && --d === 0) break; } continue; }
        if (b[i] === 60 && b[i + 1] !== 60) { while (i < n && b[i] !== 62) i++; continue; }
        if (b[i] === 91) depth++;
        else if (b[i] === 93 && --depth === 0) { i++; break; }
      }
    } else if (c === 47) { i++; while (i < n && !isWs(b[i]) && !DELIM.has(b[i])) i++; } // /이름
    else if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) { i++; while (i < n && !isWs(b[i]) && !DELIM.has(b[i])) i++; } // 숫자
    else {
      // 명령
      i++;
      while (i < n && !isWs(b[i]) && !DELIM.has(b[i])) i++;
      const op = String.fromCharCode(...b.subarray(s, i));
      if (first < 0) first = s;
      if (op === 'BI') {
        // 인라인 그림: ID 뒤 이진 자료를 EI까지 건너뛴다
        let j = i;
        while (j < n && !(b[j] === 73 && b[j + 1] === 68 && isWs(b[j + 2] ?? 32) && (j === 0 || isWs(b[j - 1])))) j++;
        j += 3;
        while (j < n && !(b[j] === 69 && b[j + 1] === 73 && isWs(b[j - 1]) && (j + 2 >= n || isWs(b[j + 2])))) j++;
        i = Math.min(n, j + 2);
        push('BI', i);
        continue;
      }
      push(op, i);
      continue;
    }
    if (first < 0) first = s;
    args.push([s, i]);
  }
  return ops;
}

const PATH = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
const STATE = new Set(['w', 'J', 'j', 'M', 'd', 'ri', 'i', 'gs', 'cm', 'CS', 'cs', 'SC', 'SCN', 'sc', 'scn', 'G', 'g', 'RG', 'rg', 'K', 'k', 'Tc', 'Tw', 'Tz', 'TL', 'Tf', 'Tr', 'Ts']);

type M6 = [number, number, number, number, number, number];
const mul = (a: M6, b: M6): M6 => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

/** 떼어 낼 수 있는 조각으로 나눈다. 묶음(q … Q) 안도 다시 나눠서, 큰 묶음 속 글자 한 줄도 따로 고를 수 있다 */
export function segments(b: Uint8Array, ops: Op[]): Segment[] {
  const out: Segment[] = [];
  const num = (r: [number, number]) => parseFloat(String.fromCharCode(...b.subarray(r[0], r[1])));
  const walk = (from: number, to: number, ctm: M6, parent: number) => {
    let k = from;
    while (k < to) {
      const o = ops[k];
      let kind: Segment['kind'] | null = null;
      let end = k;
      if (o.op === 'q') {
        let depth = 0;
        for (end = k; end < to; end++) {
          if (ops[end].op === 'q') depth++;
          else if (ops[end].op === 'Q' && --depth === 0) break;
        }
        if (end >= to) { k++; continue; } // 짝이 없는 q: 그대로 둔다
        kind = 'group';
      } else if (o.op === 'BT') {
        for (end = k; end < to && ops[end].op !== 'ET'; end++);
        if (end >= to) { k++; continue; }
        kind = 'text';
      } else if (PATH.has(o.op)) {
        for (end = k; end < to && PATH.has(ops[end].op); end++);
        if (end < to && (ops[end].op === 'W' || ops[end].op === 'W*')) end++;
        if (end >= to || !PAINT.has(ops[end].op)) { k = end; continue; }
        kind = 'path';
      } else if (o.op === 'Do' || o.op === 'BI' || o.op === 'sh') {
        kind = 'image';
      } else {
        if (o.op === 'cm' && o.args.length === 6) ctm = mul(o.args.map(num) as M6, ctm);
        k++;
        continue;
      }
      const state: [number, number][] = [];
      let clip = false;
      let next = ctm;
      if (kind !== 'group') {
        for (let j = k; j <= end; j++) {
          const p = ops[j];
          if (p.op === 'W' || p.op === 'W*') clip = true;
          else if (STATE.has(p.op)) state.push([p.start, p.end]);
          if (p.op === 'cm' && p.args.length === 6) next = mul(p.args.map(num) as M6, next);
        }
      }
      const id = out.length;
      out.push({ start: o.start, end: ops[end].end, kind, state, ctm, clip, parent });
      if (kind === 'group') walk(k + 1, end, ctm, id);
      ctm = next;
      k = end + 1;
    }
  };
  walk(0, ops.length, [1, 0, 0, 1, 0, 0], -1);
  return out;
}
