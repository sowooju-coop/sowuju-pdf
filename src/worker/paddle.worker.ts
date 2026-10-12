/// <reference lib="webworker" />
// 스캔 문서 글자 읽기(OCR) 작업 스레드: PaddleOCR(PP-OCRv5) 글줄 찾기 + 한국어 글자 인식 모델을
// onnxruntime-web으로 이 컴퓨터 안에서만 돌린다. 인터넷으로 아무것도 보내거나 받지 않는다.
import * as ort from 'onnxruntime-web/wasm';
import type { OcrWord } from '../lib/protocol';

type Box = { x0: number; y0: number; x1: number; y1: number; score: number };
interface Req { id: number; png?: Uint8Array; base?: string; stop?: boolean }

let det: ort.InferenceSession | null = null;
let rec: ort.InferenceSession | null = null;
let chars: string[] = [];
let loading: Promise<void> | null = null;

/** 글줄 찾기에 쓰는 그림의 긴 변 (시험 문서에서 1280이 가장 정확했다) */
const DET_SIDE = 1280;
const REC_H = 48;

async function load(base: string) {
  if (det && rec) return;
  if (!loading) {
    loading = (async () => {
      ort.env.wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.mjs`, wasm: `${base}ort-wasm-simd-threaded.wasm` };
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)) : 1;
      ort.env.logLevel = 'error';
      const get = async (f: string) => { const r = await fetch(`${base}${f}`); if (!r.ok) throw new Error(`글자 읽기 자료를 불러오지 못했어요 (${f})`); return r; };
      const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      const [d, r, dict] = await Promise.all([
        get('ppocr-det.onnx').then((x) => x.arrayBuffer()),
        get('ppocr-kor-rec.onnx').then((x) => x.arrayBuffer()),
        get('ppocr-kor-dict.txt').then((x) => x.text()),
      ]);
      det = await ort.InferenceSession.create(new Uint8Array(d), opts);
      rec = await ort.InferenceSession.create(new Uint8Array(r), opts);
      // 0번은 빈칸(blank), 마지막은 띄어쓰기
      chars = ['', ...dict.replace(/\r/g, '').split('\n'), ' '];
    })().catch((e) => { loading = null; throw e; });
  }
  await loading;
}

/** 회색조 그림 (0~255) */
interface Gray { w: number; h: number; px: Uint8ClampedArray }

async function decode(png: Uint8Array): Promise<Gray> {
  const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = g.getImageData(0, 0, c.width, c.height).data;
  const px = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; j < px.length; i += 4, j++) px[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  return { w: c.width, h: c.height, px };
}

/** 양선형으로 크기를 바꿔 한 칸(회색)을 꺼낸다 */
function sampler(src: Gray, x0: number, y0: number, sw: number, sh: number, dw: number, dh: number, put: (i: number, v: number) => void) {
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(src.h - 1, Math.max(0, y0 + (y + 0.5) * fy - 0.5));
    const yi = Math.floor(sy), yf = sy - yi, yj = Math.min(src.h - 1, yi + 1);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.w - 1, Math.max(0, x0 + (x + 0.5) * fx - 0.5));
      const xi = Math.floor(sx), xf = sx - xi, xj = Math.min(src.w - 1, xi + 1);
      const a = src.px[yi * src.w + xi], b = src.px[yi * src.w + xj], c = src.px[yj * src.w + xi], d = src.px[yj * src.w + xj];
      put(y * dw + x, (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf);
    }
  }
}

/** 글줄 찾기 (DB): 확률 그림을 문턱값으로 나눠 이어진 덩어리마다 상자를 만든다 */
async function detect(img: Gray): Promise<Box[]> {
  const r = Math.min(1, DET_SIDE / Math.max(img.w, img.h));
  const w = Math.max(32, Math.round((img.w * r) / 32) * 32), h = Math.max(32, Math.round((img.h * r) / 32) * 32);
  const n = w * h;
  const data = new Float32Array(3 * n);
  // 모델은 BGR 순서로 ImageNet 평균·표준편차 정규화. 회색이라 세 채널 값이 같고 평균·편차만 다르다
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  sampler(img, 0, 0, img.w, img.h, w, h, (i, v) => {
    const t = v / 255;
    data[i] = (t - mean[0]) / std[0]; data[n + i] = (t - mean[1]) / std[1]; data[2 * n + i] = (t - mean[2]) / std[2];
  });
  const out = await det!.run({ x: new ort.Tensor('float32', data, [1, 3, h, w]) });
  const prob = (Object.values(out)[0] as ort.Tensor).data as Float32Array;
  const label = new Int32Array(n);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (label[s] || prob[s] <= 0.3) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0, cnt = 0;
    label[s] = 1;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      sum += prob[p]; cnt++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !label[p - 1] && prob[p - 1] > 0.3) { label[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && !label[p + 1] && prob[p + 1] > 0.3) { label[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !label[p - w] && prob[p - w] > 0.3) { label[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && !label[p + w] && prob[p + w] > 0.3) { label[p + w] = 1; stack.push(p + w); }
    }
    if (cnt < 6 || sum / cnt < 0.6) continue;
    // 찾은 덩어리는 글자보다 좁게 나오므로 넓혀 준다 (unclip 1.5)
    const bw = x1 + 1 - x0, bh = y1 + 1 - y0;
    const d = (bw * bh * 1.5) / (2 * (bw + bh));
    const sx = img.w / w, sy = img.h / h;
    boxes.push({
      x0: Math.max(0, (x0 - d) * sx), y0: Math.max(0, (y0 - d) * sy),
      x1: Math.min(img.w, (x1 + 1 + d) * sx), y1: Math.min(img.h, (y1 + 1 + d) * sy),
      score: sum / cnt,
    });
  }
  return boxes;
}

/** 상자 안에서 잉크가 있는 위아래 범위 (글자 높이·기준선) */
function inkRows(img: Gray, b: Box) {
  const x0 = Math.floor(b.x0), x1 = Math.ceil(b.x1), y0 = Math.floor(b.y0), y1 = Math.ceil(b.y1);
  let top = -1, bot = -1;
  const need = Math.max(1, (x1 - x0) * 0.002);
  for (let y = y0; y < y1; y++) {
    let k = 0;
    for (let x = x0; x < x1; x++) if (img.px[y * img.w + x] < 140) k++;
    if (k >= need) { if (top < 0) top = y; bot = y + 1; }
  }
  return top < 0 ? { top: b.y0, bot: b.y1 } : { top, bot };
}

/** 한 글줄을 읽어 낱말과 위치로 */
async function readLine(img: Gray, b: Box): Promise<OcrWord[]> {
  const sw = b.x1 - b.x0, sh = b.y1 - b.y0;
  if (sw < 4 || sh < 4) return [];
  const dw = Math.max(16, Math.min(3200, Math.round((sw * REC_H) / sh)));
  const n = dw * REC_H;
  const data = new Float32Array(3 * n);
  sampler(img, b.x0, b.y0, sw, sh, dw, REC_H, (i, v) => { const t = v / 127.5 - 1; data[i] = t; data[n + i] = t; data[2 * n + i] = t; });
  const out = await rec!.run({ x: new ort.Tensor('float32', data, [1, 3, REC_H, dw]) });
  const t = Object.values(out)[0] as ort.Tensor;
  const [, T, C] = t.dims as number[];
  const p = t.data as Float32Array;
  // CTC: 같은 글자가 이어지면 하나로, 빈칸은 버린다. 글자마다 나온 시간 위치로 가로 위치를 정한다
  const seq: { c: string; t0: number; t1: number; conf: number }[] = [];
  let prev = 0;
  for (let i = 0; i < T; i++) {
    let best = 0, bv = -Infinity;
    const o = i * C;
    for (let k = 0; k < C; k++) if (p[o + k] > bv) { bv = p[o + k]; best = k; }
    if (best !== 0 && best !== prev) seq.push({ c: chars[best] ?? '', t0: i, t1: i + 1, conf: bv });
    else if (best !== 0 && best === prev && seq.length) seq[seq.length - 1].t1 = i + 1;
    prev = best;
  }
  const { top, bot } = inkRows(img, b);
  const lineH = Math.max(4, bot - top);
  const xAt = (step: number) => b.x0 + (step / T) * sw;
  const words: OcrWord[] = [];
  let cur: typeof seq = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((s) => s.c).join('');
    if (text.trim()) {
      const x0 = xAt(Math.max(0, cur[0].t0 - 0.5)), x1 = xAt(Math.min(T, cur[cur.length - 1].t1 + 0.5));
      words.push({ text, x0, y0: top, x1, y1: bot, base: bot, lineH, last: false });
    }
    cur = [];
  };
  for (const s of seq) { if (s.c === ' ') flush(); else cur.push(s); }
  flush();
  return words;
}

/** 같은 줄(세로로 겹치는) 상자끼리 묶어 위에서 아래, 왼쪽에서 오른쪽 순서로 */
function rows(boxes: Box[]): Box[][] {
  const sorted = [...boxes].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const out: Box[][] = [];
  for (const b of sorted) {
    const row = out[out.length - 1];
    const last = row?.[row.length - 1];
    const ov = last ? Math.min(last.y1, b.y1) - Math.max(last.y0, b.y0) : 0;
    if (row && ov > 0.5 * Math.min(last.y1 - last.y0, b.y1 - b.y0)) row.push(b); else out.push([b]);
  }
  for (const r of out) r.sort((a, b) => a.x0 - b.x0);
  return out;
}

let stopped = 0;
self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, png, base, stop } = e.data;
  if (stop) { stopped = id; return; }
  try {
    await load(base!);
    const img = await decode(png!);
    const words: OcrWord[] = [];
    for (const row of rows(await detect(img))) {
      if (stopped >= id) break;
      for (const b of row) words.push(...(await readLine(img, b)));
      if (words.length) words[words.length - 1].last = true;
    }
    self.postMessage({ id, words });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
