// 설치형(Electron)과 브라우저 개발 모드의 차이를 한곳에서 감춘다.
/** 자동 업데이트 상태 (설치형) */
export interface UpdateState {
  status: 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error' | 'dev';
  version: string | null;
  percent: number;
  error: string | null;
}

export interface PrintPage {
  png: Uint8Array;
  landscape: boolean;
}

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** 설치형에서만 있음. 최근 문서에 기록할 때 쓴다 */
  path?: string;
  /** 한글·워드 등을 PDF로 바꿔 연 경우 원래 파일 이름 */
  convertedFrom?: string;
  /** "소우주 PDF" 프린터로 인쇄되어 온 문서 */
  printed?: boolean;
}

/** 공동인증서 한 개: 폴더와 signCert.der, signPri.key (잠긴 그대로) */
export interface NpkiEntry { path: string; cert: Uint8Array; key: Uint8Array }

export interface PrinterStatus { supported: boolean; installed: boolean; driver?: boolean; portOk?: boolean; error?: string }

export interface RecentFile {
  path: string;
  name: string;
  pages: number;
  openedAt: number;
}

interface AppBridge {
  openFile(): Promise<OpenedFile | { error: string } | null>;
  convertPath(path: string): Promise<OpenedFile | { error: string }>;
  takePrinted(): Promise<OpenedFile[]>;
  npkiList(): Promise<NpkiEntry[]>;
  printerStatus(): Promise<PrinterStatus>;
  printerInstall(): Promise<PrinterStatus | { error: string }>;
  printerRemove(): Promise<PrinterStatus | { error: string }>;
  onBusy(cb: (msg: string | null) => void): () => void;
  openFiles(): Promise<OpenedFile[]>;
  saveFile(name: string, bytes: Uint8Array): Promise<string | null>;
  saveFiles(title: string, files: { name: string; bytes: Uint8Array }[]): Promise<{ dir: string; count: number } | null>;
  print(title: string, pages: PrintPage[]): Promise<{ ok: boolean; reason?: string }>;
  onOpenPath(cb: (file: OpenedFile) => void): () => void;
  /** 프로그램을 실행할 때 함께 받은 파일 (한 번만) */
  takePending(): Promise<OpenedFile | null>;
  pathForFile(file: File): string;
  recentList(): Promise<RecentFile[]>;
  recentAdd(item: Omit<RecentFile, 'openedAt'>): Promise<void>;
  openRecent(path: string): Promise<OpenedFile | null>;
  setZoom(factor: number): void;
  setUnsaved(name: string | null): void;
  onSaveBeforeClose(cb: () => void): () => void;
  closeNow(): void;
  appVersion(): Promise<string>;
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  installUpdate(): void;
  getAutoUpdate(): Promise<boolean>;
  setAutoUpdate(on: boolean): Promise<boolean>;
  onUpdate(cb: (s: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    sowuju?: AppBridge;
  }
}

export const isApp = !!window.sowuju;

/** 문서 열기 창. 설치형에서는 한글·워드·엑셀 파일을 고르면 PDF로 바꿔서 연다 (못 바꾸면 오류) */
export async function openFile(): Promise<OpenedFile | null> {
  if (window.sowuju) {
    const r = await window.sowuju.openFile();
    if (r && 'error' in r) throw new Error(r.error);
    return r;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}

/** PDF와 사진을 여러 개 고른다 (쪽 넣기·합치기) */
export function openFiles(): Promise<OpenedFile[]> {
  if (window.sowuju) return window.sowuju.openFiles();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'application/pdf,.pdf,image/jpeg,image/png';
    input.onchange = async () => resolve(await Promise.all([...(input.files ?? [])].map(readDropped)));
    input.click();
  });
}

export const OFFICE_RE = /\.(hwpx?|docx?|xlsx?|pptx?|rtf|odt|ods|odp|csv|txt)$/i;
export const fileKind = (f: { name: string }): 'pdf' | 'image' | 'office' | null =>
  /\.pdf$/i.test(f.name) ? 'pdf' : /\.(jpe?g|png)$/i.test(f.name) ? 'image' : OFFICE_RE.test(f.name) ? 'office' : null;

/** 끌어다 놓은 파일 읽기. 한글·워드·엑셀은 설치형에서 PDF로 바꾼다 */
export async function readDropped(f: File): Promise<OpenedFile> {
  const path = window.sowuju?.pathForFile(f) || undefined;
  if (fileKind(f) === 'office') {
    if (!window.sowuju || !path) throw new Error('한글·워드·엑셀 파일은 설치형 프로그램에서 열 수 있어요.');
    const r = await window.sowuju.convertPath(path);
    if ('error' in r) throw new Error(r.error);
    return r;
  }
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), path };
}

/** 여러 파일을 차례로 읽는다 (문서 바꾸기는 한 번에 하나씩). 못 읽은 파일은 onError로 알린다 */
export async function readDroppedAll(files: File[], onError: (name: string, msg: string) => void): Promise<OpenedFile[]> {
  const out: OpenedFile[] = [];
  for (const f of files) {
    try { out.push(await readDropped(f)); }
    catch (e) { onError(f.name, (e as Error).message); }
  }
  return out;
}

/** 오래 걸리는 일 안내 (설치형에서 문서를 PDF로 바꾸는 중) */
export const onBusy = (cb: (msg: string | null) => void) => window.sowuju?.onBusy(cb) ?? (() => {});

const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export async function saveFile(name: string, bytes: Uint8Array): Promise<string | null> {
  if (window.sowuju) return window.sowuju.saveFile(name, bytes);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

/**
 * 여러 파일 저장. 설치형은 폴더를 골라 한 번에 쓰고, 브라우저는 하나씩 내려받는다.
 */
export async function saveFiles(title: string, files: { name: string; bytes: Uint8Array }[]): Promise<{ dir: string; count: number } | null> {
  if (window.sowuju) return window.sowuju.saveFiles(title, files);
  for (const f of files) {
    await saveFile(f.name, f.bytes);
    await new Promise((r) => setTimeout(r, 250)); // 브라우저가 연달아 받기를 막지 않게
  }
  return { dir: '내려받기 폴더', count: files.length };
}

/** 공동인증서 찾기. 브라우저에서는 폴더를 볼 수 없어 파일을 직접 고른다 */
export const npkiList = (): Promise<NpkiEntry[]> => window.sowuju?.npkiList?.() ?? Promise.resolve([]);

/** "소우주 PDF" 프린터 (Windows 설치형만) */
export const printerApi = {
  status: (): Promise<PrinterStatus> => window.sowuju?.printerStatus?.() ?? Promise.resolve({ supported: false, installed: false }),
  install: () => window.sowuju!.printerInstall(),
  remove: () => window.sowuju!.printerRemove(),
};

export const recentList = (): Promise<RecentFile[]> => window.sowuju?.recentList() ?? Promise.resolve([]);
export const recentAdd = (item: Omit<RecentFile, 'openedAt'>) => window.sowuju?.recentAdd(item);
export const openRecent = (path: string) => window.sowuju?.openRecent(path) ?? Promise.resolve(null);
/** 쉬운 모드 글씨 크기. 설치형에서는 화면 전체를 확대한다 */
export const setUiZoom = (f: number) => window.sowuju?.setZoom(f);

/** 인쇄: 설치형은 Electron 인쇄 창, 브라우저는 숨긴 iframe으로 인쇄한다 */
export async function printPages(title: string, pages: PrintPage[]): Promise<{ ok: boolean; reason?: string }> {
  if (window.sowuju) return window.sowuju.print(title, pages);
  const urls = pages.map((p) => URL.createObjectURL(new Blob([p.png as BlobPart], { type: 'image/png' })));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(printHtml(title, urls.map((u, i) => ({ src: u, landscape: pages[i].landscape }))));
  d.close();
  await Promise.all([...d.images].map((im) => (im.complete ? Promise.resolve() : new Promise((r) => (im.onload = im.onerror = r)))));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => { frame.remove(); urls.forEach(URL.revokeObjectURL); }, 60000);
  return { ok: true };
}

/** 인쇄용 문서. 가로 페이지는 미리 90도 돌려 그려 두므로 모든 쪽을 세로 용지에 꽉 맞춘다. Electron 쪽과 같은 규칙 */
export function printHtml(title: string, pages: { src: string; landscape: boolean }[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{margin:0}
html,body{margin:0;padding:0}
.pg{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;page-break-after:always;break-after:page;overflow:hidden}
.pg:last-child{page-break-after:auto;break-after:auto}
.pg img{max-width:100%;max-height:100%;object-fit:contain}
</style></head><body>${pages.map((p) => `<div class="pg"><img src="${p.src}"></div>`).join('')}</body></html>`;
}
