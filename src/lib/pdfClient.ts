import type { PageInfo, RenderResult, ReplaceRequest, TextLine, WorkerRequest, WorkerResponse } from './protocol';

export interface EditResult { pages: PageInfo[]; canUndo: boolean; canRedo: boolean }

/** MuPDF 작업 스레드와 주고받는 얇은 창구. 요청마다 번호를 붙여 응답을 짝지어 준다. */
export class PdfClient {
  private worker = new Worker(new URL('../worker/mupdf.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  /** 작업 순서를 지키기 위한 대기열 (그리기 도중 페이지 삭제 등이 끼어들지 않게) */
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
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
    return p;
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
  lines(index: number) { return this.call<TextLine[]>('lines', { index }); }
  replace(req: ReplaceRequest) { return this.call<EditResult>('replace', req); }
  undo() { return this.call<EditResult>('undo'); }
  redo() { return this.call<EditResult>('redo'); }
  save() { return this.call<Uint8Array>('save'); }
}
