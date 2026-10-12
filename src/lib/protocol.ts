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

/** 글자 읽기(OCR)로 찾은 낱말. 그림 픽셀 단위 */
export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; base: number; lineH: number; /** 줄 끝 낱말이면 true (뒤에 띄어쓰기를 넣지 않음) */ last: boolean }

/** 책갈피(목차) 한 항목. y는 쪽 안의 높이(화면 좌표, 위가 0) */
export interface Bookmark { title: string; page: number; y?: number; open: boolean; children: Bookmark[] }

/** 새로 만들 입력칸. rect는 화면 좌표(pt, 위가 0) */
export type NewFieldType = 'text' | 'multiline' | 'checkbox' | 'combo';
export interface NewField { page: number; rect: [number, number, number, number]; type: NewFieldType; name: string; options?: string[] }

/** 스캔 깨끗하게 */
export interface CleanOptions { mode: 'bw' | 'gray' | 'color'; deskew: boolean; borders: boolean; whiten: boolean }

/** 문단 고치기: 문단의 글자를 모두 지우고 여러 줄로 다시 쓴다 (x, y는 줄마다 바닥선 왼쪽, 화면 좌표) */
export interface ReplaceParaRequest {
  page: number;
  remove: TextChar['quad'][];
  lines: { text: string; x: number; y: number; spacing: number }[];
  dir: [number, number];
  size: number;
  color: [number, number, number];
  fontFile: string;
  origFont?: number;
}

/** 쪽 크기 바꾸기 (pt). orient: keep=원래 방향, portrait/landscape */
export interface ResizeOptions { width: number; height: number; orient: 'keep' | 'portrait' | 'landscape'; pages: number[] }
/** 여백 자르기: rect는 화면 좌표(pt, 위가 0). auto면 쪽마다 내용에 맞추고 margin(pt)만큼 남긴다 */
export interface CropOptions { pages: number[]; rect?: [number, number, number, number]; auto?: boolean; margin: number; reset?: boolean }
