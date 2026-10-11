// 소우주 PDF 설치형 진입점 (Electron 메인 프로세스)
const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '..', 'dist');

// 빌드된 화면을 app:// 주소로 제공한다. file:// 에서는 모듈 작업 스레드와 WebAssembly 로딩이 막히기 때문
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
let pendingPath = process.argv.slice(1).find((a) => /\.pdf$/i.test(a)) || null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 500,
    title: '소우주 PDF',
    backgroundColor: '#e9edf1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', () => {
    if (pendingPath) sendPath(pendingPath);
    pendingPath = null;
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://local/index.html');
}

async function sendPath(p) {
  try {
    const bytes = await fs.readFile(p);
    win.webContents.send('open-path', { name: path.basename(p), bytes: new Uint8Array(bytes), path: p });
  } catch (e) {
    dialog.showErrorBox('파일을 열지 못했어요', String(e.message || e));
  }
}

// 같은 프로그램을 두 번 실행하면 기존 창에서 파일을 연다
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const p = argv.slice(1).find((a) => /\.pdf$/i.test(a));
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    if (p) sendPath(p);
  }
});
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (win && !win.webContents.isLoading()) sendPath(p);
  else pendingPath = p;
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'PDF 열기', filters: [{ name: 'PDF 문서', extensions: ['pdf'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const bytes = await fs.readFile(r.filePaths[0]);
  return { name: path.basename(r.filePaths[0]), bytes: new Uint8Array(bytes), path: r.filePaths[0] };
});

// 쪽 넣기·합치기용: PDF와 사진을 여러 개 고른다
ipcMain.handle('open-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '넣을 파일 고르기',
    filters: [{ name: 'PDF·사진', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) out.push({ name: path.basename(p), bytes: new Uint8Array(await fs.readFile(p)), path: p });
  return out;
});

// 최근 문서: 사용자 폴더의 recent.json 에 경로·이름·쪽수만 기록한다 (파일 내용은 저장하지 않음)
const RECENT = () => path.join(app.getPath('userData'), 'recent.json');
async function readRecent() {
  try { return JSON.parse(await fs.readFile(RECENT(), 'utf8')); } catch { return []; }
}
ipcMain.handle('recent-list', async () => {
  const list = await readRecent();
  const alive = [];
  for (const it of list) {
    try { await fs.access(it.path); alive.push(it); } catch { /* 옮겨지거나 지워진 파일은 뺀다 */ }
  }
  return alive.slice(0, 12);
});
ipcMain.handle('recent-add', async (_e, item) => {
  if (!item || typeof item.path !== 'string' || !/\.pdf$/i.test(item.path)) return;
  const list = (await readRecent()).filter((x) => x.path !== item.path);
  list.unshift({ path: item.path, name: String(item.name), pages: Number(item.pages) || 0, openedAt: Date.now() });
  await fs.writeFile(RECENT(), JSON.stringify(list.slice(0, 30)), 'utf8');
});
ipcMain.handle('open-recent', async (_e, p) => {
  const list = await readRecent();
  if (!list.some((x) => x.path === p)) return null;
  const bytes = await fs.readFile(p);
  return { name: path.basename(p), bytes: new Uint8Array(bytes), path: p };
});

ipcMain.handle('save-file', async (_e, name, bytes) => {
  const r = await dialog.showSaveDialog(win, { title: 'PDF 저장', defaultPath: name, filters: [{ name: 'PDF 문서', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, Buffer.from(bytes));
  return r.filePath;
});

// 인쇄: 페이지 이미지를 임시 폴더에 쓰고, 숨긴 창에서 운영체제 인쇄 창을 띄운다
ipcMain.handle('print', async (_e, title, pages) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sowuju-print-'));
  try {
    const items = [];
    for (let i = 0; i < pages.length; i++) {
      const f = path.join(dir, `p${i + 1}.png`);
      await fs.writeFile(f, Buffer.from(pages[i].png));
      items.push({ src: `p${i + 1}.png`, landscape: pages[i].landscape });
    }
    const html = path.join(dir, 'print.html');
    await fs.writeFile(html, printHtml(title, items), 'utf8');
    const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await pw.loadFile(html);
    const result = await new Promise((resolve) => {
      pw.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, (ok, reason) => resolve({ ok, reason }));
    });
    pw.destroy();
    return result;
  } finally {
    setTimeout(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}), 60000);
  }
});

// src/lib/host.ts 의 printHtml 과 같은 규칙
function printHtml(title, pages) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{margin:0}
html,body{margin:0;padding:0}
.pg{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;page-break-after:always;break-after:page;overflow:hidden}
.pg:last-child{page-break-after:auto;break-after:auto}
.pg img{max-width:100%;max-height:100%;object-fit:contain}
</style></head><body>${pages.map((p) => `<div class="pg"><img src="${esc(p.src)}"></div>`).join('')}</body></html>`;
}
