// 스캔 문서 글자 읽기(OCR). tesseract.js를 프로그램 안의 파일(public/ocr)로만 돌린다 — 인터넷으로 아무것도 보내거나 받지 않는다.
// 그림 → 낱말과 위치를 읽는 일만 여기서 하고, PDF에 글자를 넣는 일은 PDF 작업 스레드가 한다.
import { createScheduler, createWorker, OEM, PSM, type Scheduler } from 'tesseract.js';
import type { OcrWord } from './protocol';

let scheduler: Promise<Scheduler> | null = null;

const base = () => new URL('ocr/', document.baseURI).href;

/** 컴퓨터 성능에 맞춰 1~3개의 일꾼을 둔다 (한국어+영어) */
function getScheduler() {
  if (!scheduler) {
    scheduler = (async () => {
      const s = createScheduler();
      const n = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
      const make = async () => {
        const w = await createWorker(['kor', 'eng'], OEM.LSTM_ONLY, {
          workerPath: `${base()}worker.min.js`,
          corePath: base(),
          langPath: base().replace(/\/$/, ''),
          cacheMethod: 'none',
          workerBlobURL: false,
          gzip: true,
        });
        await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
        s.addWorker(w);
      };
      await make();
      // 나머지는 뒤에서 준비 (첫 쪽은 바로 시작)
      for (let i = 1; i < n; i++) void make().catch(() => {});
      return s;
    })();
    scheduler.catch(() => { scheduler = null; });
  }
  return scheduler;
}

/** 다 쓰면 일꾼을 끝내 메모리를 돌려준다 */
export async function stopOcr() {
  const s = scheduler;
  scheduler = null;
  if (s) await (await s).terminate().catch(() => {});
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

/** PNG 한 장을 읽어 낱말과 위치(그림 픽셀 단위)를 돌려준다 */
export async function recognize(png: Uint8Array): Promise<{ words: OcrWord[]; confidence: number }> {
  const s = await getScheduler();
  const r = await s.addJob('recognize', new Blob([png as BlobPart], { type: 'image/png' }), {}, { blocks: true, text: false });
  const words: OcrWord[] = [];
  for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
    const lb = l.baseline;
    const lh = l.bbox.y1 - l.bbox.y0;
    const start = words.length;
    for (const w of joinSyllables(l.words, lh)) {
      const text = w.text.trim();
      if (!text || w.confidence < 30) continue;
      // 줄 기준선(기울어져 있을 수 있음)에서 이 낱말 가운데의 높이
      const mx = (w.bbox.x0 + w.bbox.x1) / 2;
      const base = lb && lb.x1 !== lb.x0 ? lb.y0 + (lb.y1 - lb.y0) * (mx - lb.x0) / (lb.x1 - lb.x0) : w.bbox.y1;
      words.push({ text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, base: Math.min(Math.max(base, w.bbox.y0), w.bbox.y1 + 2), lineH: l.bbox.y1 - l.bbox.y0, last: false });
    }
    if (words.length > start) words[words.length - 1].last = true;
  }
  return { words, confidence: r.data.confidence };
}
