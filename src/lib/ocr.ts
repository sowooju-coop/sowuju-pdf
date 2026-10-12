// 스캔 문서 글자 읽기(OCR): PaddleOCR 작업 스레드를 부른다. 프로그램 안의 파일(public/ocr)만 쓴다
import type { OcrWord } from './protocol';

const base = () => new URL('ocr/', document.baseURI).href;
// 여러 코어를 쓸 수 있으면(교차 출처 격리) 작업 스레드 하나가 코어를 나눠 쓰고, 아니면 쪽마다 따로 (많아야 2개, 모델이 메모리를 꽤 쓴다)
export const ocrLanes = () => (self.crossOriginIsolated ? 1 : Math.max(1, Math.min(2, Math.floor((navigator.hardwareConcurrency || 2) / 3))));

let pool: Worker[] = [];
let idle: Worker[] = [];
const waiters: ((w: Worker) => void)[] = [];
let seq = 0;

function acquire(): Promise<Worker> {
  const w = idle.pop();
  if (w) return Promise.resolve(w);
  if (pool.length < ocrLanes()) { const nw = new Worker(new URL('../worker/paddle.worker.ts', import.meta.url), { type: 'module' }); pool.push(nw); return Promise.resolve(nw); }
  return new Promise((res) => waiters.push(res));
}
function release(w: Worker) {
  if (!pool.includes(w)) return;
  const next = waiters.shift();
  if (next) next(w); else idle.push(w);
}

/** 다 쓰면 작업 스레드를 끝내 메모리를 돌려준다 */
export async function stopOcr() {
  const all = pool;
  pool = []; idle = [];
  for (const w of all) w.terminate();
}

/** 그림(PNG)에서 낱말과 위치(그림 좌표)를 읽는다 */
export async function recognize(png: Uint8Array): Promise<{ words: OcrWord[]; confidence: number }> {
  const w = await acquire();
  const id = ++seq;
  try {
    return await new Promise((res, rej) => {
      w.onmessage = (e: MessageEvent<{ id: number; words?: OcrWord[]; error?: string }>) => {
        if (e.data.id !== id) return;
        if (e.data.error) rej(new Error(e.data.error)); else res({ words: e.data.words!, confidence: 90 });
      };
      w.onerror = (e) => rej(new Error(e.message || '글자 읽기 중 문제가 생겼어요.'));
      w.postMessage({ id, png, base: base() });
    });
  } finally { release(w); }
}
