export interface PageInfo {
  /** 회전이 반영된 화면 기준 폭·높이 (pt, 1pt = 1/72인치) */
  width: number;
  height: number;
  rotation: number;
}

export interface WorkerRequest {
  id: number;
  op: string;
  args?: unknown;
}

export type WorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: string };

export interface RenderResult {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}
