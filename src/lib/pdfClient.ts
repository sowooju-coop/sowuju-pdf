import type { PrivacyHit } from './privacy';
import type { Bookmark, FormField, OcrWord, OrigFontInfo, NewShape, NewText, PageInfo, PageNumberOptions, WatermarkOptions, RenderResult, ReplaceRequest, TextLine, WorkerRequest, WorkerResponse } from './protocol';

/** pages 가 없으면 쪽 구성·크기는 그대로 */
export interface EditResult { pages?: PageInfo[]; canUndo: boolean; canRedo: boolean }

/** MuPDF 작업 스레드와 주고받는 얇은 창구. 요청마다 번호를 붙여 응답을 짝지어 준다. */
export class PdfClient {
  private worker = new Worker(new URL('../worker/mupdf.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  /**
   * 작업 스레드가 MuPDF를 다 불러왔다는 신호(id 0). 불러오는 동안 보낸 요청은 버려지므로
   * 첫 요청은 이 신호를 기다렸다가 보낸다.
   */
  private ready: Promise<void>;
  private isReady = false;
  /**
   * 한 번에 하나씩 보내는 대기열. 편집·저장(우선순위 0)은 들어온 순서대로 먼저,
   * 화면 그리기는 지금 보이는 쪽(1) → 근처 쪽(2) → 미리보기(3) 순서로, 같은 순위면 최근 요청부터.
   * 스크롤로 지나간 쪽의 요청은 취소되어 아예 그리지 않는다.
   */
  private queue: { prio: number; n: number; signal?: AbortSignal; start: () => void; reject: (e: Error) => void }[] = [];
  private running = false;
  private n = 0;

  constructor() {
    let ok!: () => void, fail!: (e: Error) => void;
    this.ready = new Promise<void>((res, rej) => { ok = res; fail = rej; });
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'PDF 엔진을 불러오지 못했어요');
      fail(err);
      for (const t of this.queue.splice(0)) t.reject(err);
    };
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id === 0) { this.isReady = true; ok(); this.pump(); return; }
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      this.waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.result);
      else w.reject(new Error(e.data.error));
    };
  }

  private pump() {
    if (this.running || !this.isReady) return;
    // 취소된 그리기 요청은 버린다
    this.queue = this.queue.filter((t) => {
      if (t.signal?.aborted) { t.reject(new DOMException('취소됨', 'AbortError')); return false; }
      return true;
    });
    if (!this.queue.length) return;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i], b = this.queue[best];
      if (a.prio < b.prio || (a.prio === b.prio && (a.prio === 0 ? a.n < b.n : a.n > b.n))) best = i;
    }
    const [t] = this.queue.splice(best, 1);
    this.running = true;
    t.start();
  }

  private call<T>(op: string, args?: unknown, transfer: Transferable[] = [], opts: { prio?: number; signal?: AbortSignal } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        const id = ++this.seq;
        const done = () => { this.running = false; this.pump(); };
        this.waiting.set(id, { resolve: (v) => { done(); resolve(v); }, reject: (e) => { done(); reject(e); } });
        this.worker.postMessage({ id, op, args } satisfies WorkerRequest, transfer);
      };
      this.queue.push({ prio: opts.prio ?? 0, n: ++this.n, signal: opts.signal, start, reject });
      this.pump();
      this.ready.catch(reject);
    });
  }

  open(bytes: Uint8Array, password?: string) {
    const copy = bytes.slice();
    this.docId++;
    return this.call<{ pages?: PageInfo[]; needsPassword?: boolean; wrongPassword?: boolean }>('open', { bytes: copy, password }, [copy.buffer]);
  }
  newDoc() { this.docId++; return this.call<{ pages: PageInfo[] }>('newDoc'); }
  pages() { return this.call<PageInfo[]>('pages'); }
  /** 화면 그리기. prio: 1 보이는 쪽, 2 근처 쪽, 3 미리보기. signal 로 취소 */
  render(index: number, scale: number, opts: { prio?: number; signal?: AbortSignal } = {}) { return this.call<RenderResult>('render', { index, scale, rotate: 0 }, [], { prio: opts.prio ?? 1, signal: opts.signal }); }
  /** 쪽을 그림 파일로 (흰 바탕) */
  renderImage(index: number, dpi: number, format: 'png' | 'jpg') { return this.call<Uint8Array>('renderImage', { index, dpi, format }); }
  /** 모아 찍기 한 장 (PNG, 세로 용지) */
  renderSheet(indices: number[], per: 2 | 4, dpi: number, border: boolean) { return this.call<Uint8Array>('renderSheet', { indices, per, dpi, border }); }
  renderPng(index: number, scale: number, rotate = 0) { return this.call<Uint8Array>('renderPng', { index, scale, rotate }); }
  rotate(indices: number[], delta: number) { return this.call<EditResult>('rotate', { indices, delta }); }
  delete(indices: number[]) { return this.call<EditResult>('delete', { indices }); }
  move(order: number[]) { return this.call<EditResult>('move', { order }); }
  insertBlank(at: number, width: number, height: number) { return this.call<EditResult>('insertBlank', { at, width, height }); }
  insertFile(at: number, bytes: Uint8Array, kind: 'pdf' | 'image') {
    const copy = bytes.slice();
    return this.call<EditResult & { count: number; at: number; needsPassword?: boolean }>('insertFile', { at, bytes: copy, kind }, [copy.buffer]);
  }
  duplicate(indices: number[]) { return this.call<EditResult>('duplicate', { indices }); }
  extract(indices: number[]) { return this.call<Uint8Array>('extract', { indices }); }
  place(items: { page: number; x: number; y: number; w: number; h: number; png: Uint8Array }[], texts: NewText[] = [], shapes: NewShape[] = []) {
    return this.call<EditResult>('place', { items, texts, shapes }, items.map((i) => i.png.buffer));
  }
  // 책갈피(목차)
  outline() { return this.call<Bookmark[]>('outline'); }
  setOutline(list: Bookmark[]) { return this.call<EditResult>('setOutline', { list }); }
  autoOutline() { return this.call<Bookmark[]>('autoOutline'); }
  pageTitle(index: number) { return this.call<{ title: string; y: number } | null>('pageTitle', { index }); }
  /** 글자가 하나도 없는 쪽 (스캔한 쪽) */
  textless() { return this.call<number[]>('textless'); }
  /** 글자 읽기용 그림 (흑백, 표 선 지움) */
  renderOcr(index: number, scale: number) { return this.call<{ png: Uint8Array; table: boolean }>('renderOcr', { index, scale }); }
  ocrText(pages: { index: number; scale: number; words: OcrWord[] }[]) { return this.call<EditResult>('ocrText', { pages }); }
  pageNumbers(o: PageNumberOptions) { return this.call<EditResult>('pageNumbers', o); }
  watermark(o: WatermarkOptions) { return this.call<EditResult>('watermark', o); }
  lines(index: number) { return this.call<TextLine[]>('lines', { index }); }
  replace(req: ReplaceRequest) { return this.call<EditResult>('replace', req); }
  undo() { return this.call<EditResult>('undo'); }
  redo() { return this.call<EditResult>('redo'); }
  save() { return this.call<Uint8Array>('save'); }

  /** 문서를 새로 열 때마다 바뀌는 번호 (원래 글꼴 캐시 구분용) */
  docId = 0;
  origFont(index: number, name: string) { return this.call<OrigFontInfo | null>('origFont', { index, name }); }

  /** 비교용 낱말과 위치 */
  words() { return this.call<{ page: number; t: string; r: [number, number, number, number] }[]>('words'); }
  /** 작업 스레드를 끝낸다 (잠깐 쓰고 버리는 문서용) */
  close() {
    this.worker.terminate();
    const err = new Error('문서를 닫았어요.');
    for (const t of this.queue.splice(0)) t.reject(err);
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
  }

  /** 문서 안 글자 찾기 (띄어쓰기·대소문자 무시) */
  find(query: string) { return this.call<{ page: number; rect: [number, number, number, number]; text: string }[]>('find', { query }); }

  // 양식 입력칸
  fieldCount() { return this.call<number>('fieldCount'); }
  fields(index: number) { return this.call<FormField[]>('fields', { index }); }
  setField(index: number, id: number, value: string) { return this.call<EditResult>('setField', { index, id, value }); }

  // 보호 메뉴
  findPrivate(rrnBackOnly: boolean, search: string[]) { return this.call<{ hits: PrivacyHit[]; noText: number[] }>('findPrivate', { rrnBackOnly, search }); }
  redact(areas: { page: number; rects: [number, number, number, number][] }[], clearInfo: boolean) { return this.call<EditResult>('redact', { areas, clearInfo }); }
  /** password 가 빈 문자열이면 암호를 푼 파일 */
  saveProtected(password: string, printOnly: boolean) { return this.call<Uint8Array>('saveProtected', { password, printOnly }); }
  finish(o: { clearInfo: boolean; shrink: 'light' | 'normal' | 'strong' | null; password: string; printOnly: boolean }) { return this.call<Uint8Array>('finish', o); }
  shrink(level: 'light' | 'normal' | 'strong') { return this.call<{ bytes: Uint8Array; images: number; before: number }>('shrink', { level }); }
  info() { return this.call<{ encryption: string; author: string; creator: string; producer: string }>('info'); }
}
