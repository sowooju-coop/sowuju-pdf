import type { NewText, PageInfo, RenderResult, ReplaceRequest, TextLine, WorkerRequest, WorkerResponse } from './protocol';

export interface EditResult { pages: PageInfo[]; canUndo: boolean; canRedo: boolean }

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
  /** 작업 순서를 지키기 위한 대기열 (그리기 도중 페이지 삭제 등이 끼어들지 않게) */
  private chain: Promise<unknown>;

  constructor() {
    let ok!: () => void, fail!: (e: Error) => void;
    this.ready = new Promise<void>((res, rej) => { ok = res; fail = rej; });
    this.chain = this.ready;
    this.worker.onerror = (e) => fail(new Error(e.message || 'PDF 엔진을 불러오지 못했어요'));
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id === 0) { ok(); return; }
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      this.waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.result);
      else w.reject(new Error(e.data.error));
    };
  }

  private call<T>(op: string, args?: unknown, transfer: Transferable[] = []): Promise<T> {
    const run = () =>
      new Promise<T>((resolve, reject) => {
        const id = ++this.seq;
        this.waiting.set(id, { resolve, reject });
        this.worker.postMessage({ id, op, args } satisfies WorkerRequest, transfer);
      });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    // 엔진을 못 불러왔으면 기다리지 않고 바로 알린다
    return Promise.race([p, this.ready.then(() => p)]);
  }

  open(bytes: Uint8Array, password?: string) {
    const copy = bytes.slice();
    return this.call<{ pages?: PageInfo[]; needsPassword?: boolean; wrongPassword?: boolean }>('open', { bytes: copy, password }, [copy.buffer]);
  }
  newDoc() { return this.call<{ pages: PageInfo[] }>('newDoc'); }
  pages() { return this.call<PageInfo[]>('pages'); }
  render(index: number, scale: number, rotate = 0) { return this.call<RenderResult>('render', { index, scale, rotate }); }
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
  place(items: { page: number; x: number; y: number; w: number; h: number; png: Uint8Array }[], texts: NewText[] = []) {
    return this.call<EditResult>('place', { items, texts }, items.map((i) => i.png.buffer));
  }
  lines(index: number) { return this.call<TextLine[]>('lines', { index }); }
  replace(req: ReplaceRequest) { return this.call<EditResult>('replace', req); }
  undo() { return this.call<EditResult>('undo'); }
  redo() { return this.call<EditResult>('redo'); }
  save() { return this.call<Uint8Array>('save'); }
}
