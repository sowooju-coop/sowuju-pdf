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
  bitmap: ImageBitmap;
}

export interface TextChar {
  c: string;
  /** 글자 기준점(왼쪽 아래 기준선) */
  x: number;
  y: number;
  size: number;
  quad: [number, number, number, number, number, number, number, number];
  color: [number, number, number];
  font: string;
  bold: boolean;
  serif: boolean;
}

export interface TextLine {
  bbox: [number, number, number, number];
  /** 글자가 나아가는 방향 (가로쓰기면 [1, 0]) */
  dir: [number, number];
  chars: TextChar[];
}

export interface ReplaceRequest {
  page: number;
  /** 파일에서 지울 글자 상자 */
  remove: TextChar['quad'][];
  /** 새로 쓸 글자 (비어 있으면 지우기만) */
  text: string;
  x: number;
  y: number;
  dir: [number, number];
  size: number;
  spacing: number;
  color: [number, number, number];
  fontFile: string;
}

/** 새로 넣는 글자 한 줄 (x, y 는 글자 바닥선 왼쪽, 화면 좌표 pt) */
export interface NewText {
  page: number;
  x: number;
  y: number;
  size: number;
  color: [number, number, number];
  fontFile: string;
  text: string;
}

/** 펜·형광펜·도형·체크 (점 좌표는 화면 좌표 pt) */
export type ShapeKind = 'pen' | 'highlight' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'check';
export interface NewShape {
  page: number;
  kind: ShapeKind;
  points: [number, number][];
  color: [number, number, number];
  width: number;
}
