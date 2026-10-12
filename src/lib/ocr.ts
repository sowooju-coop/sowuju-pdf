// 스캔 문서 글자 읽기(OCR). tesseract.js를 프로그램 안의 파일(public/ocr)로만 돌린다 — 인터넷으로 아무것도 보내거나 받지 않는다.
// 그림 → 낱말과 위치를 읽는 일만 여기서 하고, PDF에 글자를 넣는 일은 PDF 작업 스레드가 한다.
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrWord } from './protocol';

const base = () => new URL('ocr/', document.baseURI).href;

// 일꾼 모음: 컴퓨터 성능에 맞춰 1~3개 (한국어+영어). 쪽마다 읽는 방식(PSM)을 바꿔야 해서 직접 나눠 쓴다
let pool: Worker[] = [];
let idle: Worker[] = [];
let making = 0;
const waiters: { res: (w: Worker) => void; rej: (e: Error) => void }[] = [];
const limit = () => Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2)));

async function make() {
  making++;
  try {
    const w = await createWorker(['kor', 'eng'], OEM.LSTM_ONLY, {
      workerPath: `${base()}worker.min.js`,
      corePath: base(),
      langPath: base().replace(/\/$/, ''),
      cacheMethod: 'none',
      workerBlobURL: false,
      gzip: true,
    });
    await w.setParameters({ preserve_interword_spaces: '1' });
    pool.push(w);
    release(w);
  } finally { making--; }
}
function acquire(): Promise<Worker> {
  const w = idle.pop();
  if (w) return Promise.resolve(w);
  if (pool.length + making < limit()) {
    // 일꾼을 하나도 못 만들면 기다리는 쪽에 알린다 (이미 일꾼이 있으면 그 일꾼을 기다린다)
    void make().catch((e) => { if (!pool.length && !making) for (const x of waiters.splice(0)) x.rej(e instanceof Error ? e : new Error(String(e))); });
  }
  return new Promise((res, rej) => waiters.push({ res, rej }));
}
function release(w: Worker) {
  const next = waiters.shift();
  if (next) next.res(w); else idle.push(w);
}

/** 다 쓰면 일꾼을 끝내 메모리를 돌려준다 */
export async function stopOcr() {
  const all = pool;
  pool = []; idle = [];
  await Promise.all(all.map((w) => w.terminate().catch(() => {})));
}

const JOINABLE = /[ᄀ-ᇿ㄰-㆏가-힯0-9]/;
type W = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

/**
 * 한 줄의 낱말 사이 간격을 '글자 사이'와 '낱말 사이' 두 무리로 나눈 경계값. 나뉘지 않으면 null
 */
function splitGap(gaps: number[], lineH: number): number | null {
  const g = [...gaps].sort((a, b) => a - b);
  if (g.length < 2) return null;
  let best = -1, bestCost = Infinity;
  for (let k = 1; k < g.length; k++) {
    const a = g.slice(0, k), b = g.slice(k);
    const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
    const cost = a.reduce((x, y) => x + (y - ma) ** 2, 0) + b.reduce((x, y) => x + (y - mb) ** 2, 0);
    if (cost < bestCost) { bestCost = cost; best = k; }
  }
  const small = g.slice(0, best), large = g.slice(best);
  const ms = small.reduce((x, y) => x + y, 0) / small.length, ml = large.reduce((x, y) => x + y, 0) / large.length;
  // 낱말 사이로 볼 만큼 넓어야(줄 높이의 45% 이상) 두 무리로 본다
  if (ml < Math.max(ms, 1) * 1.5 || ml - ms < lineH * 0.15 || ml < lineH * 0.45) return null;
  return (small[small.length - 1] + large[0]) / 2;
}

/**
 * 글자 사이를 벌린 한글 문서(공문·공고문에 흔함)는 글자 하나하나를 낱말로 읽는다.
 * 줄마다 간격을 재서 '글자 사이'로 보이는 곳은 붙인다 — 복사하면 "화 성 특 례 시"가 아니라 "화성특례시"가 되게
 */
export function joinSyllables(words: W[], lineH: number): W[] {
  const ws = words.map((w) => ({ text: w.text.trim(), confidence: w.confidence, bbox: { ...w.bbox } })).filter((w) => w.text);
  const joinable = (a: W, b: W) => JOINABLE.test(a.text.slice(-1)) && JOINABLE.test(b.text[0]);
  const gaps: number[] = [];
  // 아주 좁은(겹친) 간격은 늘 붙이고, 나머지 간격만 두 무리로 나눈다
  const tiny = lineH * 0.08;
  for (let i = 1; i < ws.length; i++) {
    const g = ws[i].bbox.x0 - ws[i - 1].bbox.x1;
    if (joinable(ws[i - 1], ws[i]) && g > tiny) gaps.push(g);
  }
  // 두 무리로 나뉘지 않는데 한 글자 낱말이 대부분이면, 줄 전체가 글자 사이를 고르게 벌린 것 (예: "화 성 상 공 회 의 소")
  // 이때는 글자 모양마다 들쭉날쭉한 간격 대신 글자 시작점 사이의 거리(글자 칸)가 고른지를 본다
  const split = splitGap(gaps, lineH);
  const single = (w: W) => [...w.text].length === 1 && JOINABLE.test(w.text);
  const pitches: number[] = [];
  for (let i = 1; i < ws.length; i++) if (single(ws[i - 1]) && joinable(ws[i - 1], ws[i])) pitches.push(ws[i].bbox.x0 - ws[i - 1].bbox.x0);
  const medP = [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)] ?? 0;
  const evenP = (p: number) => Math.abs(p - medP) <= medP * 0.2;
  const spread = split === null && ws.length >= 4 && ws.filter(single).length / ws.length >= 0.6 && pitches.length >= 3
    && medP < lineH * 1.8 && pitches.filter(evenP).length / pitches.length >= 0.75;
  const cut = Math.max(tiny, split ?? 0);
  const glue = (a: W, b: W) => {
    if (!joinable(a, b)) return false;
    const g = b.bbox.x0 - a.bbox.x1;
    if (g < cut) return true;
    // 고르게 벌린 줄: 앞 글자 시작점에서 딱 한 칸 떨어져 있으면 붙인다
    return spread && single(a) && evenP(b.bbox.x0 - a.bbox.x0);
  };
  const out: W[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], last = out[out.length - 1];
    if (last && glue(ws[i - 1], w)) {
      last.text += w.text;
      last.confidence = Math.min(last.confidence, w.confidence);
      last.bbox = { x0: last.bbox.x0, y0: Math.min(last.bbox.y0, w.bbox.y0), x1: w.bbox.x1, y1: Math.max(last.bbox.y1, w.bbox.y1) };
    } else out.push({ ...w, bbox: { ...w.bbox } });
  }
  return out;
}

type Line = { words: W[]; bbox: { x0: number; y0: number; x1: number; y1: number }; baseline: { x0: number; y0: number; x1: number; y1: number } | null };

async function read(w: Worker, png: Uint8Array, psm: PSM): Promise<{ lines: Line[]; confidence: number }> {
  await w.setParameters({ tessedit_pageseg_mode: psm });
  const r = await w.recognize(new Blob([png as BlobPart], { type: 'image/png' }), {}, { blocks: true, text: false });
  const lines: Line[] = [];
  for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ words: l.words, bbox: l.bbox, baseline: l.baseline });
  return { lines, confidence: r.data.confidence };
}

/** 낱말마다 읽은 확신도 (다시 읽기 비교용) */
const confOf = new WeakMap<OcrWord, number>();

function toWords(lines: Line[]): OcrWord[] {
  const words: OcrWord[] = [];
  for (const l of lines) {
    const lb = l.baseline;
    const lh = l.bbox.y1 - l.bbox.y0;
    const start = words.length;
    for (const w of joinSyllables(l.words, lh)) {
      const text = w.text.trim();
      if (!text || w.confidence < 30) continue;
      // 줄 기준선(기울어져 있을 수 있음)에서 이 낱말 가운데의 높이
      const mx = (w.bbox.x0 + w.bbox.x1) / 2;
      const base = lb && lb.x1 !== lb.x0 ? lb.y0 + (lb.y1 - lb.y0) * (mx - lb.x0) / (lb.x1 - lb.x0) : w.bbox.y1;
      const wd: OcrWord = { text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, base: Math.min(Math.max(base, w.bbox.y0), w.bbox.y1 + 2), lineH: lh, last: false };
      confOf.set(wd, w.confidence);
      words.push(wd);
    }
    if (words.length > start) words[words.length - 1].last = true;
  }
  return words;
}

const overlaps = (a: OcrWord, b: OcrWord) => {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 0 || iy <= 0) return false;
  return ix * iy > 0.3 * Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
};

type Cell = [number, number, number, number];

/**
 * 표 칸 하나를 잘라 다시 읽는다. 한 줄짜리 칸은 글자 사이의 넓은 빈칸을 좁혀서 읽힌다 ("화   성   특   례" → "화성특례")
 * 돌려주는 낱말 위치는 원래 그림 좌표
 */
async function readCell(w: Worker, bmp: ImageBitmap, c: Cell): Promise<{ words: OcrWord[]; conf: number }> {
  const pad = 3;
  const cw = c[2] - c[0] - pad * 2, ch = c[3] - c[1] - pad * 2;
  if (cw < 10 || ch < 10) return { words: [], conf: 0 };
  const src = new OffscreenCanvas(cw, ch);
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(bmp, c[0] + pad, c[1] + pad, cw, ch, 0, 0, cw, ch);
  const data = sg.getImageData(0, 0, cw, ch).data;
  // 세로줄마다 잉크가 있는지
  const colInk = new Uint8Array(cw);
  let top = ch, bottom = 0;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (data[(y * cw + x) * 4] < 140) { colInk[x] = 1; if (y < top) top = y; if (y > bottom) bottom = y; }
  if (bottom <= top) return { words: [], conf: 0 };
  const textH = bottom - top + 1;
  const single = textH < ch * 0.75 && textH < 90;
  // 빈 세로 띠가 글자 높이의 60%보다 넓으면 그 높이의 35%로 좁힌다 (한 줄 칸만)
  const maxGap = Math.round(textH * 0.6), keepGap = Math.max(4, Math.round(textH * 0.35));
  const map: number[] = []; // 새 x → 원래 x
  if (single) {
    let x = 0;
    while (x < cw) {
      if (colInk[x]) { map.push(x++); continue; }
      let e = x; while (e < cw && !colInk[e]) e++;
      const run = e - x;
      const keep = run > maxGap && x > 0 && e < cw ? keepGap : Math.min(run, x === 0 || e === cw ? 8 : run);
      for (let k = 0; k < keep; k++) map.push(x + Math.round((k * run) / keep));
      x = e;
    }
  } else for (let x = 0; x < cw; x++) map.push(x);
  const margin = 12;
  const out = new OffscreenCanvas(map.length + margin * 2, ch + margin * 2);
  const og = out.getContext('2d')!;
  og.fillStyle = '#fff'; og.fillRect(0, 0, out.width, out.height);
  if (map.length === cw) og.drawImage(src, margin, margin);
  else map.forEach((sx, nx) => og.drawImage(src, sx, 0, 1, ch, margin + nx, margin, 1, ch));
  const blob = await out.convertToBlob({ type: 'image/png' });
  await w.setParameters({ tessedit_pageseg_mode: single ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK });
  const r = await w.recognize(blob, {}, { blocks: true, text: false });
  const back = (nx: number) => c[0] + pad + (map[Math.max(0, Math.min(map.length - 1, Math.round(nx - margin)))] ?? 0);
  const lines: Line[] = [];
  for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
    const mv = (bb: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: back(bb.x0), y0: bb.y0 - margin + c[1] + pad, x1: back(bb.x1), y1: bb.y1 - margin + c[1] + pad });
    lines.push({
      words: l.words.map((x) => ({ text: x.text, confidence: x.confidence, bbox: mv(x.bbox) })),
      bbox: mv(l.bbox),
      baseline: l.baseline ? { x0: back(l.baseline.x0), y0: l.baseline.y0 - margin + c[1] + pad, x1: back(l.baseline.x1), y1: l.baseline.y1 - margin + c[1] + pad } : null,
    });
  }
  // 좁혀 읽은 한 줄은 이미 낱말이 붙어 있으므로 글자 사이 맞추기를 하지 않게, 한 칸 = 한 낱말 묶음으로
  const words = toWords(lines);
  const conf = words.length ? r.data.confidence : 0;
  return { words, conf };
}

const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** 한글 문서에서 짧은 영어로 읽힌 낱말: 굵고 큰 한글을 영어로 잘못 읽는 일이 많다 ("표창" → "HE") */
const suspicious = (t: string) => /^[A-Za-z|\][]{1,5}[.,:;]?$/.test(t) && /[A-Za-z]/.test(t) && !/^(AI|PDF|OK|IT|PC|TV|CEO|NO|No|AM|PM|kg|cm|mm|km)$/.test(t);

/** 의심 낱말만 잘라 영어를 빼고 다시 읽는다. 한글로 더 확실하게 읽히면 바꾼다 */
async function reread(w: Worker, bmp: ImageBitmap, words: OcrWord[], conf: Map<OcrWord, number>) {
  const hangul = words.reduce((n, x) => n + (x.text.match(/[가-힣]/g)?.length ?? 0), 0);
  const all = words.reduce((n, x) => n + x.text.length, 0);
  if (!all || hangul / all < 0.5) return;
  const targets = words.filter((x) => suspicious(x.text)).slice(0, 40);
  if (!targets.length) return;
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_blacklist: LATIN });
  try {
    for (const t of targets) {
      const m = Math.round((t.y1 - t.y0) * 0.25);
      const sx = Math.max(0, t.x0 - m), sy = Math.max(0, t.y0 - m), sw = Math.min(bmp.width - sx, t.x1 - t.x0 + m * 2), sh = Math.min(bmp.height - sy, t.y1 - t.y0 + m * 2);
      if (sw < 4 || sh < 4) continue;
      const cv = new OffscreenCanvas(sw + 20, sh + 20);
      const g = cv.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, sx, sy, sw, sh, 10, 10, sw, sh);
      const r = await w.recognize(await cv.convertToBlob({ type: 'image/png' }), {}, { text: true });
      const txt = r.data.text.replace(/\s+/g, '');
      // 영어로 읽을 때의 확신도는 믿기 어렵다(굵은 한글을 '확신하며' 영어로 읽는다). 한글로 충분히 확실하면 바꾼다
      const ko = txt.replace(/^[^가-힣0-9(]+/, '');
      if (/[가-힣]/.test(ko) && (r.data.confidence >= 55 || r.data.confidence > (conf.get(t) ?? 0) + 10)) t.text = ko;
    }
  } finally {
    await w.setParameters({ tessedit_char_blacklist: '' });
  }
}

const inside = (wd: OcrWord, c: Cell) => { const cx = (wd.x0 + wd.x1) / 2, cy = (wd.y0 + wd.y1) / 2; return cx > c[0] && cx < c[2] && cy > c[1] && cy < c[3]; };

/**
 * PNG 한 장을 읽어 낱말과 위치(그림 픽셀 단위)를 돌려준다.
 * 표가 있는 쪽은 문단 방식(AUTO)으로 읽은 뒤 흩어진 글자 방식(SPARSE)으로 한 번 더 읽어 빠진 낱말만 보탠다
 */
export async function recognize(png: Uint8Array, table = false, cells: Cell[] = []): Promise<{ words: OcrWord[]; confidence: number }> {
  const w = await acquire();
  try {
    const a = await read(w, png, PSM.AUTO);
    let words = toWords(a.lines);
    if (!cells.length && table) {
      const extra = toWords((await read(w, png, PSM.SPARSE_TEXT)).lines).filter((x) => !words.some((y) => overlaps(x, y)));
      words.push(...extra);
    }
    const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
    try {
      // 표 칸은 칸마다 다시 읽어서, 칸 안의 낱말은 칸에서 읽은 것으로 바꾼다 (칸에서 못 읽으면 원래 것)
      for (const c of cells) {
        const r = await readCell(w, bmp, c);
        if (!r.words.length) continue;
        words = words.filter((x) => !inside(x, c));
        words.push(...r.words);
      }
      await reread(w, bmp, words, { get: (x: OcrWord) => confOf.get(x) } as Map<OcrWord, number>);
    } finally { bmp.close(); }
    return { words, confidence: a.confidence };
  } finally { release(w); }
}
