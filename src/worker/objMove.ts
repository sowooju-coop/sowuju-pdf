// 쪽 안의 원래 글자·그림을 끌어서 옮기기·크기 바꾸기.
// 쪽을 다시 쓰지 않고, 고른 그리기 조각만 "q 옮김 cm … Q"로 감싼다. 글꼴·그림 자원은 그대로라
// 파일이 커지지 않고, 나머지 모양은 바이트 하나 바뀌지 않는다. 되돌리기도 그대로 된다.
import * as mupdf from 'mupdf';
import type { MovableObject, MoveRequest } from '../lib/protocol';
import { segments, tokenize, type Segment } from './contentOps';
import { num } from './pdfUtil';

type Rect = [number, number, number, number];
type M6 = [number, number, number, number, number, number];

interface Piece { seg: Segment; box: Rect | null; text: boolean; image: boolean; other: boolean }

/** 획 없이 (mupdf.js 타입은 null을 받지 않지만 실제로는 null이 '획 없음'이다) */
const NOSTROKE = null as unknown as mupdf.StrokeState;
const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const overlap = (a: Rect, b: Rect) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const union = (a: Rect | null, b: Rect): Rect => (a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b);
const ok = (r: number[]) => r.every(Number.isFinite) && r[2] > r[0] - 0.01 && r[3] > r[1] - 0.01 && Math.abs(r[0]) < 1e5;

function pageContent(pobj: mupdf.PDFObject): Uint8Array {
  const c = pobj.get('Contents');
  const parts: Uint8Array[] = [];
  const read = (x: mupdf.PDFObject) => { if (x.isStream()) parts.push(x.readStream().asUint8Array().slice()); };
  if (c.isArray()) for (let i = 0; i < c.length; i++) read(c.get(i)); else read(c);
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length + 1, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; out[at++] = 10; }
  return out;
}

const enc = new TextEncoder();
function splice(b: Uint8Array, inserts: { at: number; text: string }[]): Uint8Array {
  inserts.sort((x, y) => x.at - y.at);
  const chunks: Uint8Array[] = [];
  let from = 0;
  for (const ins of inserts) { chunks.push(b.subarray(from, ins.at), enc.encode(ins.text)); from = ins.at; }
  chunks.push(b.subarray(from));
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * 쪽을 조각으로 나누고 조각마다 화면 위 자리를 잰다.
 * 조각 앞마다 쪽 밖의 작은 잘라내기 표시를 넣은 사본을 그려 보면, 그리기 순서대로 어느 조각에 속하는지 알 수 있다
 */
function analyze(doc: mupdf.PDFDocument, index: number) {
  const pobj = doc.findPage(index);
  const bytes = pageContent(pobj);
  const segs = segments(bytes, tokenize(bytes));
  const marked = splice(bytes, segs.map((s, k) => ({ at: s.start, text: `\nq ${-100000 - k} 0 0.5 0.5 re W n Q\n` })));
  const pieces: Piece[] = segs.map((seg) => ({ seg, box: null, text: false, image: false, other: false }));
  const scratch = new mupdf.PDFDocument();
  try {
    scratch.graftPage(0, doc, index);
    scratch.findPage(0).put('Contents', scratch.addStream(marked, scratch.newDictionary()));
    let cur = -1;
    const add = (r: number[], what: 'text' | 'image' | 'other') => {
      if (cur < 0 || !ok(r)) return;
      const p = pieces[cur];
      p.box = union(p.box, r as Rect);
      p[what] = true;
    };
    const imgBox = (ctm: mupdf.Matrix) => {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    };
    const dev = new mupdf.Device({
      clipPath(path) {
        const b = path.getBounds(NOSTROKE, mupdf.Matrix.identity);
        if (b[0] <= -99999 && b[0] > -100000 - pieces.length - 1) cur = Math.round(-b[0] - 100000);
      },
      fillPath(path, _eo, ctm) { add(path.getBounds(NOSTROKE, ctm), 'other'); },
      strokePath(path, stroke, ctm) { add(path.getBounds(stroke, ctm), 'other'); },
      fillText(text, ctm) { add(text.getBounds(NOSTROKE, ctm), 'text'); },
      strokeText(text, stroke, ctm) { add(text.getBounds(stroke, ctm), 'text'); },
      ignoreText(text, ctm) { add(text.getBounds(NOSTROKE, ctm), 'text'); },
      fillImage(_img, ctm) { add(imgBox(ctm), 'image'); },
      fillImageMask(_img, ctm) { add(imgBox(ctm), 'image'); },
    });
    const page = scratch.loadPage(0);
    try { page.runPageContents(dev, mupdf.Matrix.identity); } finally { dev.close(); dev.destroy(); page.destroy(); }
  } finally { scratch.destroy(); }
  // 묶음의 자리 = 안에 든 조각들을 합친 자리 (자식은 늘 부모보다 뒤에 있다)
  for (let k = pieces.length - 1; k >= 0; k--) {
    const p = pieces[k], par = p.seg.parent;
    if (par < 0 || !p.box) continue;
    const q = pieces[par];
    q.box = union(q.box, p.box);
    q.text ||= p.text; q.image ||= p.image; q.other ||= p.other;
  }
  return { pobj, bytes, pieces };
}

const iou = (a: Rect, b: Rect) => overlap(a, b) / Math.max(area(a) + area(b) - overlap(a, b), 1e-6);

/** 그림 조각에서, 같은 자리를 차지하는 바깥 묶음까지 올라간다 (그림만의 잘라내기 틀도 함께 옮기게) */
function climb(pieces: Piece[], k: number) {
  let cur = k;
  for (let par = pieces[cur].seg.parent; par >= 0; par = pieces[par].seg.parent) {
    const pb = pieces[par].box;
    if (!pb || pieces[par].text || iou(pb, pieces[k].box!) < 0.9) break;
    cur = par;
  }
  return cur;
}

function imagePieces(pieces: Piece[]) {
  const out: number[] = [];
  pieces.forEach((p, k) => {
    if (p.seg.kind !== 'image' || !p.image || !p.box || area(p.box) <= 16) return;
    const top = climb(pieces, k);
    if (!pieces[top].seg.clip || pieces[top].seg.kind === 'group') if (!out.includes(top)) out.push(top);
  });
  return out;
}

/** 고를 수 있는 그림 (화면 좌표). 쪽 전체를 덮는 스캔 그림도 포함 */
export function movableImages(doc: mupdf.PDFDocument, index: number): MovableObject[] {
  const { pieces } = analyze(doc, index);
  return imagePieces(pieces).map((k) => ({ kind: 'image' as const, rect: pieces[k].box!.map((v) => Math.round(v * 100) / 100) as Rect }));
}

/** 바뀐 곳(옮기기 전·후 자리) 밖의 모습이 그대로인지 비교할 그림 */
function snapshotPixels(doc: mupdf.PDFDocument, index: number) {
  const page = doc.loadPage(index);
  try {
    const pix = page.toPixmap(mupdf.Matrix.scale(0.75, 0.75), mupdf.ColorSpace.DeviceGray, false, false);
    const out = { w: pix.getWidth(), h: pix.getHeight(), px: pix.getPixels().slice() };
    pix.destroy();
    return out;
  } finally { page.destroy(); }
}

/**
 * 고른 글자·그림을 옮기거나 크기를 바꾼다. 원래 문서를 바꾸므로 작업 기록(되돌리기) 안에서 부른다.
 * 그림은 rect와 가장 잘 맞는 조각 하나, 글자는 rect 안에 들어오는 글자 조각을 모두 옮긴다.
 */
export function moveObjects(doc: mupdf.PDFDocument, req: MoveRequest) {
  const page = doc.loadPage(req.page);
  const t = page.getTransform() as M6;
  page.destroy();
  const { pobj, bytes, pieces } = analyze(doc, req.page);
  let chosen: Piece[];
  if (req.kind === 'image') {
    let best = -1, bestScore = 0;
    for (const k of imagePieces(pieces)) {
      const score = iou(pieces[k].box!, req.rect);
      if (score > bestScore) { bestScore = score; best = k; }
    }
    if (best < 0 || bestScore < 0.5) throw new Error('옮길 그림을 찾지 못했어요.');
    chosen = [pieces[best]];
  } else {
    const pad = Math.max(2, (req.rect[3] - req.rect[1]) * 0.3);
    const area2: Rect = [req.rect[0] - pad, req.rect[1] - pad, req.rect[2] + pad, req.rect[3] + pad];
    const inside = (r: Rect) => overlap(r, area2) >= area(r) * 0.85;
    const centerIn = (r: Rect) => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2; return cx >= req.rect[0] && cx <= req.rect[2] && cy >= req.rect[1] && cy <= req.rect[3]; };
    chosen = [];
    let bundled = false;
    // 위에서부터: 고른 줄 안에 통째로 들어오는 가장 큰 조각을 고르고, 아니면 안으로 들어간다
    const kids = new Map<number, number[]>();
    pieces.forEach((p, k) => { const par = p.seg.parent; if (!kids.has(par)) kids.set(par, []); kids.get(par)!.push(k); });
    const visit = (k: number) => {
      const p = pieces[k];
      if (!p.box || !p.text) return;
      if (inside(p.box) && !(p.seg.kind !== 'group' && p.seg.clip)) { chosen.push(p); return; }
      if (p.seg.kind === 'group') { for (const c of kids.get(k) ?? []) visit(c); return; }
      if (centerIn(p.box) || overlap(p.box, req.rect) > area(req.rect) * 0.3) bundled = true;
    };
    for (const k of kids.get(-1) ?? []) visit(k);
    if (!chosen.length) throw new Error(bundled ? '이 글자는 다른 글자와 한 덩어리로 묶여 있어서 따로 옮길 수 없어요.' : '옮길 글자를 찾지 못했어요.');
    if (bundled) throw new Error('고른 줄의 일부 글자가 다른 글자와 묶여 있어서 옮길 수 없어요.');
  }
  if (chosen.some((p) => p.seg.kind !== 'group' && p.seg.clip)) throw new Error('이 부분은 옮길 수 없어요.');

  // 화면에서 rect를 to로 옮기고 늘리는 변환을 조각 좌표로 바꾼다
  const sx = (req.to[2] - req.to[0]) / Math.max(1e-6, req.rect[2] - req.rect[0]);
  const sy = (req.to[3] - req.to[1]) / Math.max(1e-6, req.rect[3] - req.rect[1]);
  const S: M6 = [sx, 0, 0, sy, req.to[0] - req.rect[0] * sx, req.to[1] - req.rect[1] * sy];
  const before = snapshotPixels(doc, req.page);
  const inserts: { at: number; text: string }[] = [];
  for (const p of chosen) {
    const F = mupdf.Matrix.concat(p.seg.ctm, t);
    const M = mupdf.Matrix.concat(mupdf.Matrix.concat(F, S), mupdf.Matrix.invert(F));
    inserts.push({ at: p.seg.start, text: `\nq ${M.map(num).join(' ')} cm\n` });
    // 글자 묶음 안에서 바꾼 글꼴·색 등은 뒤 내용이 이어 쓰므로 감싼 뒤에 다시 적는다
    const replay = p.seg.state.map(([a, b]) => String.fromCharCode(...bytes.subarray(a, b))).join('\n');
    inserts.push({ at: p.seg.end, text: `\nQ\n${replay}${replay ? '\n' : ''}` });
  }
  pobj.put('Contents', doc.addStream(splice(bytes, inserts), doc.newDictionary()));

  // 옮긴 곳 밖이 달라졌으면 알리고 되돌리게 한다
  const after = snapshotPixels(doc, req.page);
  if (after.w === before.w && after.h === before.h) {
    const k = 0.75, pad = 3;
    const skip = [req.rect, req.to, ...chosen.map((p) => p.box!)].map((r) => [r[0] * k - pad, r[1] * k - pad, r[2] * k + pad, r[3] * k + pad]);
    const moved = chosen.map((p) => p.box!).map((r) => {
      const a = [r[0] * S[0] + S[4], r[1] * S[3] + S[5], r[2] * S[0] + S[4], r[3] * S[3] + S[5]];
      return [a[0] * k - pad, a[1] * k - pad, a[2] * k + pad, a[3] * k + pad];
    });
    let diff = 0, n = 0;
    for (let y = 0; y < after.h; y++) for (let x = 0; x < after.w; x++) {
      if (skip.some((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) || moved.some((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3])) continue;
      n++;
      if (Math.abs(after.px[y * after.w + x] - before.px[y * before.w + x]) > 60) diff++;
    }
    if (diff > Math.max(30, n * 0.002)) throw new Error('이 부분은 옮기면 다른 곳 모양이 바뀌어서 옮기지 않았어요.');
    // 옮긴 자리에서 잘려서(표 칸 등의 잘라내기 틀 밖) 안 보이게 되면 알린다
    const ink = (pix: typeof after, rs: number[][]) => {
      let c = 0;
      for (const r of rs) for (let y = Math.max(0, Math.floor(r[1])); y < Math.min(pix.h, r[3]); y++) for (let x = Math.max(0, Math.floor(r[0])); x < Math.min(pix.w, r[2]); x++) if (pix.px[y * pix.w + x] < 128) c++;
      return c;
    };
    const src = chosen.map((p) => p.box!).map((r) => [r[0] * k, r[1] * k, r[2] * k, r[3] * k]);
    const was = ink(before, src), now = ink(after, moved);
    if (was > 20 && now < was * Math.min(1, sx * sy) * 0.4) throw new Error('옮긴 자리에서는 잘려서 보이지 않아요. 조금 더 가까이 옮겨 보세요.');
  }
  return { moved: chosen.length };
}
