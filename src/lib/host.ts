// 설치형(Electron)과 브라우저 개발 모드의 차이를 한곳에서 감춘다.
export interface PrintPage {
  png: Uint8Array;
  landscape: boolean;
}

interface AppBridge {
  openFile(): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveFile(name: string, bytes: Uint8Array): Promise<string | null>;
  print(title: string, pages: PrintPage[]): Promise<{ ok: boolean; reason?: string }>;
  onOpenPath(cb: (file: { name: string; bytes: Uint8Array }) => void): void;
}

declare global {
  interface Window {
    sowuju?: AppBridge;
  }
}

export const isApp = !!window.sowuju;

export function openFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (window.sowuju) return window.sowuju.openFile();
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

export async function saveFile(name: string, bytes: Uint8Array): Promise<string | null> {
  if (window.sowuju) return window.sowuju.saveFile(name, bytes);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

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
