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
  /** 원래 글꼴(PDF 글꼴 객체 번호)로 쓸 수 있는 글자는 그 글꼴로 쓴다 */
  origFont?: number;
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

/** 원래 글꼴 정보 (브라우저 미리보기용 글꼴 포함) */
export interface OrigFontInfo {
  key: number;
  bytes: Uint8Array;
  chars: string;
  ascent: number;
  descent: number;
  upm: number;
}

/** PDF 양식 입력칸 */
export interface FormField {
  /** 입력칸 객체 번호 */
  id: number;
  type: 'text' | 'checkbox' | 'radiobutton' | 'combobox' | 'listbox' | 'signature' | 'button' | string;
  name: string;
  label: string;
  /** 화면 좌표(pt, 위가 0) */
  rect: [number, number, number, number];
  value: string;
  /** 체크·라디오가 켜져 있는지 */
  on: boolean;
  options: string[];
  multiline: boolean;
  readOnly: boolean;
  maxLen: number;
  comb: boolean;
}

/** 쪽 번호 넣기 */
export interface PageNumberOptions {
  /** 위·아래(t/b) + 왼쪽·가운데·오른쪽(l/c/r) */
  position: [ 't' | 'b', 'l' | 'c' | 'r'];
  format: 'plain' | 'dash' | 'slash' | 'kor';
  start: number;
  skipFirst: boolean;
  /** 짝수 쪽은 좌우를 바꿈 (양면 인쇄) */
  mirror: boolean;
  size: number;
  margin: number;
  color: [number, number, number];
  fontFile: string;
}

/** 워터마크 넣기 */
export interface WatermarkOptions {
  text: string;
  /** 0이면 쪽에 맞춰 자동 */
  size: number;
  diagonal: boolean;
  opacity: number;
  color: [number, number, number];
  fontFile: string;
  /** 없으면 모든 쪽 */
  pages?: number[];
}
