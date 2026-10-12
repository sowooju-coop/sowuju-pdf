// 두 낱말 목록의 차이 (Myers 방식). 같은 앞뒤를 먼저 잘라 내 빠르다.

export type Op = { kind: 'same' | 'del' | 'ins'; a: number; b: number; n: number };

/** a→b로 바꾸는 최소 편집. 차이가 maxD를 넘으면 null (너무 많이 다름) */
export function diff(a: string[], b: string[], maxD = 6000): Op[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const N = A.length, M = B.length, MAX = Math.min(N + M, maxD);
  const ops: Op[] = [];
  const push = (kind: Op['kind'], ai: number, bi: number, n: number) => {
    if (n <= 0) return;
    const last = ops[ops.length - 1];
    if (last && last.kind === kind && last.a + (kind === 'ins' ? 0 : last.n) === ai && last.b + (kind === 'del' ? 0 : last.n) === bi) last.n += n;
    else ops.push({ kind, a: ai, b: bi, n });
  };
  push('same', 0, 0, pre);
  if (N === 0 || M === 0) {
    push('del', pre, pre, N);
    push('ins', pre + N, pre, M);
  } else {
    // 단계(d)마다 대각선 k의 가장 먼 x를 남겨 두었다가 거꾸로 따라간다
    const off = MAX + 1;
    let v = new Int32Array(2 * MAX + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= MAX && found < 0; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2));
      const nv = v;
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && nv[off + k - 1] < nv[off + k + 1]) ? nv[off + k + 1] : nv[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && A[x] === B[y]) { x++; y++; }
        nv[off + k] = x;
        if (x >= N && y >= M) { found = d; break; }
      }
      v = nv;
    }
    if (found < 0) return null;
    // 거꾸로 따라가며 편집 목록 만들기
    const rev: Op[] = [];
    let x = N, y = M;
    for (let d = found; d > 0; d--) {
      const t = trace[d]; // 단계 d를 시작할 때의 v (k = -d-1 .. d+1)
      const at = (k: number) => t[k + d + 1];
      const k = x - y;
      const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
      const pk = down ? k + 1 : k - 1;
      const px = at(pk), py = px - pk;
      const sx = down ? px : px + 1, sy = sx - k;
      if (x > sx) rev.push({ kind: 'same', a: sx, b: sy, n: x - sx });
      if (down) rev.push({ kind: 'ins', a: px, b: py, n: 1 });
      else rev.push({ kind: 'del', a: px, b: py, n: 1 });
      x = px; y = py;
    }
    if (x > 0) rev.push({ kind: 'same', a: 0, b: 0, n: x });
    for (const o of rev.reverse()) push(o.kind, o.a + pre, o.b + pre, o.n);
  }
  push('same', a.length - suf, b.length - suf, suf);
  return ops;
}

/** 붙어 있는 빠짐·생김을 한 '바뀐 곳'으로 묶는다 */
export interface Hunk { a: [number, number]; b: [number, number] }
export function hunks(ops: Op[]): Hunk[] {
  const out: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const o of ops) {
    if (o.kind === 'same') { if (cur) { out.push(cur); cur = null; } continue; }
    if (!cur) cur = { a: [o.a, o.a], b: [o.b, o.b] };
    if (o.kind === 'del') cur.a[1] = o.a + o.n; else cur.b[1] = o.b + o.n;
    if (o.kind === 'del') cur.b[1] = Math.max(cur.b[1], o.b);
    else cur.a[1] = Math.max(cur.a[1], o.a);
  }
  if (cur) out.push(cur);
  return out;
}
