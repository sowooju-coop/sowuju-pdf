// 입력칸 자동으로 찾기: 표의 빈 칸, □ 체크 표시, ____ 밑줄을 찾아 칸을 제안한다.
// 칸 이름은 왼쪽(없으면 위쪽)에 있는 글자에서 가져온다 (예: "성 명" → "성명")
import * as mupdf from 'mupdf';
import type { NewField, TextLine } from '../lib/protocol';
import { readLines } from './textEdit';

type R = [number, number, number, number];
const BOX = /[□☐❏▢]/;
const clean = (s: string) => s.replace(/[\s:：*※()（）\[\]]/g, '').slice(0, 30);
const textOf = (l: TextLine) => l.chars.map((c) => c.c).join('');
const charBox = (q: number[]): R => [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
const overlap = (a: R, b: R) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const area = (r: R) => (r[2] - r[0]) * (r[3] - r[1]);

/** 그림으로 그려 선으로 둘러싸인 빈 칸을 찾는다 (pt 단위 사각형) */
function emptyCells(page: mupdf.PDFPage): { cells: R[]; vline: (x0: number, x1: number, y: number) => boolean } {
  const s = 150 / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceGray, false, true);
  const w = pix.getWidth(), h = pix.getHeight(), st = pix.getStride(), src = pix.getPixels();
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ink[y * w + x] = src[y * st + x] < 200 ? 1 : 0;
  pix.destroy();
  // 표 선: 가로 20pt, 세로 10pt 넘게 이어진 줄
  const line = new Uint8Array(w * h);
  const minH = Math.round(20 * s), minV = Math.round(10 * s);
  for (let y = 0; y < h; y++) { let run = 0; for (let x = 0; x <= w; x++) { if (x < w && ink[y * w + x]) { run++; continue; } if (run >= minH) for (let k = x - run; k < x; k++) line[y * w + k] = 1; run = 0; } }
  for (let x = 0; x < w; x++) { let run = 0; for (let y = 0; y <= h; y++) { if (y < h && ink[y * w + x]) { run++; continue; } if (run >= minV) for (let k = y - run; k < y; k++) line[k * w + x] = 1; run = 0; } }
  // 선을 한 칸 두껍게 해서 끊긴 곳을 잇는다
  const wall = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (line[i] || line[i - 1] || line[i + 1] || line[i - w] || line[i + w]) wall[i] = 1;
  }
  // 선이 아닌 곳을 이어진 덩어리로 나눈다 (네 방향)
  const label = new Int32Array(w * h);
  const out: R[] = [];
  const stack: number[] = [];
  let id = 0;
  for (let start = 0; start < w * h; start++) {
    if (wall[start] || label[start]) continue;
    id++;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0, inkN = 0, edge = false;
    stack.push(start); label[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      n++; if (ink[i]) inkN++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && !wall[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && !wall[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && !wall[i - w] && !label[i - w]) { label[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && !wall[i + w] && !label[i + w]) { label[i + w] = id; stack.push(i + w); }
    }
    if (edge) continue;
    const bw = (x1 - x0 + 1) / s, bh = (y1 - y0 + 1) / s;
    // 네모 모양이고, 알맞은 크기이고, 안에 잉크가 거의 없는 칸
    if (n < (x1 - x0 + 1) * (y1 - y0 + 1) * 0.85) continue;
    if (bw < 24 || bh < 9 || bh > 160 || bw > 560) continue;
    if (inkN > Math.max(4, n * 0.002)) continue;
    out.push([x0 / s + 1, y0 / s + 1, (x1 + 1) / s - 1, (y1 + 1) / s - 1]);
  }
  /** pt 좌표 x0~x1 사이, 높이 y에 세로 표 선이 있는지 */
  const vline = (ax: number, bx: number, y: number) => {
    const yy = Math.min(h - 1, Math.max(0, Math.round(y * s)));
    for (let x = Math.max(0, Math.round(ax * s)); x <= Math.min(w - 1, Math.round(bx * s)); x++) {
      let n = 0;
      for (let d = -3; d <= 3; d++) { const y2 = yy + d; if (y2 >= 0 && y2 < h && line[y2 * w + x]) n++; }
      if (n >= 5) return true;
    }
    return false;
  };
  return { cells: out, vline };
}

/** 칸 위쪽 같은 열의 머리글 */
function headerAbove(r: R, lines: { t: string; b: R }[]) {
  let best: { t: string; d: number } | null = null;
  for (const l of lines) {
    if (l.b[3] > r[1] + 2) continue;
    const ov = Math.min(l.b[2], r[2]) - Math.max(l.b[0], r[0]);
    if (ov < Math.min(r[2] - r[0], l.b[2] - l.b[0]) * 0.5) continue;
    const d = r[1] - l.b[3];
    if (d < 220 && (!best || d < best.d)) best = { t: l.t, d };
  }
  return best?.t ?? '';
}

/**
 * 칸 이름: 왼쪽(같은 줄)의 가장 가까운 글자. 그 사이에 다른 빈 칸이 있으면(가로로 여러 칸이 비어 있는 표) 위쪽 머리글.
 * "학 / 력"처럼 한 글자씩 세로로 쓴 제목은 위아래로 붙은 글자를 모은다
 */
function labelFor(r: R, lines: { t: string; b: R }[], cells: R[]) {
  const midY = (r[1] + r[3]) / 2;
  let best: { t: string; b: R; d: number } | null = null;
  for (const l of lines) {
    if (l.b[2] > r[0] + 2 || !(l.b[1] < r[3] && l.b[3] > r[1]) || Math.abs((l.b[1] + l.b[3]) / 2 - midY) > (r[3] - r[1]) / 2 + 2) continue;
    const d = r[0] - l.b[2];
    if (d < 260 && (!best || d < best.d)) best = { t: l.t, b: l.b, d };
  }
  const between = best && cells.some((c) => c !== r && c[2] <= r[0] + 2 && c[0] >= best!.b[2] - 2 && c[1] < r[3] && c[3] > r[1]);
  if (best && !between) {
    if ([...best.t].length > 1) return best.t;
    // 세로로 한 글자씩 쓴 제목: 같은 열에서 위아래로 이어진 글자를 모은다
    const col = lines.filter((l) => Math.abs((l.b[0] + l.b[2]) / 2 - (best!.b[0] + best!.b[2]) / 2) < 6 && [...l.t].length <= 2)
      .sort((a, b) => a.b[1] - b.b[1]);
    const k = col.findIndex((l) => l.b === best!.b);
    let a = k, z = k;
    while (a > 0 && col[a].b[1] - col[a - 1].b[3] < 40) a--;
    while (z < col.length - 1 && col[z + 1].b[1] - col[z].b[3] < 40) z++;
    return col.slice(a, z + 1).map((l) => l.t).join('');
  }
  return headerAbove(r, lines) || best?.t || '';
}

export function detectFields(doc: mupdf.PDFDocument, index: number): NewField[] {
  const page = doc.loadPage(index);
  const lines = readLines(doc, index);
  const raw = lines.map((l) => ({ t: clean(textOf(l)), b: [...l.bbox] as R })).filter((l) => l.t);
  const { cells, vline } = emptyCells(page);
  // 같은 높이에서 표 세로선으로 나뉘지 않은 글자 조각은 합친다 ("기    간" → "기간")
  raw.sort((a, b) => (Math.abs(a.b[1] - b.b[1]) < 3 ? a.b[0] - b.b[0] : a.b[1] - b.b[1]));
  const textLines: { t: string; b: R }[] = [];
  for (const l of raw) {
    const last = textLines[textLines.length - 1];
    const h = l.b[3] - l.b[1];
    if (last && Math.abs((last.b[1] + last.b[3]) / 2 - (l.b[1] + l.b[3]) / 2) < h * 0.4 && l.b[0] - last.b[2] < 80 && l.b[0] >= last.b[2] - 1
      && !vline(last.b[2], l.b[0], (l.b[1] + l.b[3]) / 2)) {
      last.t += l.t;
      last.b = [last.b[0], Math.min(last.b[1], l.b[1]), l.b[2], Math.max(last.b[3], l.b[3])];
    } else textLines.push({ t: l.t, b: [...l.b] as R });
  }
  const existing: R[] = page.getWidgets().map((wd) => { const r = wd.getRect(); return [r[0], r[1], r[2], r[3]] as R; });
  const out: NewField[] = [];
  const add = (f: NewField) => {
    if (existing.some((e) => overlap(e, f.rect) > area(f.rect) * 0.3)) return;
    if (out.some((o) => overlap(o.rect, f.rect) > Math.min(area(o.rect), area(f.rect)) * 0.3)) return;
    out.push(f);
  };
  // □ 체크 표시: 그 뒤 글자를 이름으로
  for (const l of lines) {
    l.chars.forEach((c, i) => {
      if (!BOX.test(c.c)) return;
      const b = charBox(c.quad);
      const after = clean(l.chars.slice(i + 1).map((x) => x.c).join('').split(/[□☐❏▢]/)[0]);
      const pad = (b[3] - b[1]) * 0.1;
      add({ page: index, rect: [b[0] + pad, b[1] + pad, b[2] - pad, b[3] - pad], type: 'checkbox', name: after || '체크' });
    });
  }
  // ____ 밑줄: 밑줄 위를 글자칸으로, 앞 글자를 이름으로
  for (const l of lines) {
    const t = textOf(l);
    for (const m of t.matchAll(/_{4,}/g)) {
      const cs = l.chars.slice(m.index!, m.index! + m[0].length);
      const bs = cs.map((c) => charBox(c.quad));
      const x0 = Math.min(...bs.map((b) => b[0])), x1 = Math.max(...bs.map((b) => b[2]));
      const size = cs[0].size, base = cs[0].y;
      const name = clean(t.slice(0, m.index).split(/_{2,}/).pop() ?? '');
      add({ page: index, rect: [x0, base - size * 1.15, x1, base + size * 0.15], type: 'text', name: name || '입력칸' });
    }
  }
  // 표의 빈 칸
  for (const r of cells) {
    const name = labelFor(r, textLines, cells).replace(/^[^0-9A-Za-z가-힣]+/, '');
    if (!name) continue; // 이름 붙일 글자가 없는 칸은 꾸밈 칸일 때가 많다
    const tall = r[3] - r[1] > 42;
    add({ page: index, rect: r, type: tall ? 'multiline' : 'text', name });
  }
  page.destroy();
  return out;
}
