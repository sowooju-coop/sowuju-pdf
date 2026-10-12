// 소우주 PDF 설치형 진입점 (Electron 메인 프로세스)
const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { setupUpdater } = require('./updater.cjs');
const { listNpki } = require('./npki.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '..', 'dist');

// 빌드된 화면을 app:// 주소로 제공한다. file:// 에서는 모듈 작업 스레드와 WebAssembly 로딩이 막히기 때문
protocol.registerSchemesAsPrivileged([
  // codeCache: 화면 코드와 PDF 엔진(WebAssembly)을 한 번 해석해 두고 다음 실행부터 다시 쓴다
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

let win = null;
let pendingPath = process.argv.slice(1).find((a) => /\.(pdf|hwpx?|docx?|xlsx?|pptx?|rtf|odt|ods|odp|csv|txt)$/i.test(a)) || null;

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
  guardClose(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://local/index.html');
}

const { convertToPdf, isOffice, OFFICE_EXT } = require('./convert.cjs');
const { printerStatus, printerInstall, printerRemove, watchPrinted } = require('./printer.cjs');

// "소우주 PDF" 프린터로 인쇄한 문서: 화면이 준비되기 전에 온 것은 모아 두었다가 화면이 가져간다
const printedQueue = [];
let printedReady = false;
async function readPrinted(p) {
  return { name: '인쇄한 문서.pdf', bytes: new Uint8Array(await fs.readFile(p)), printed: true };
}
function onPrinted(p) {
  if (!printedReady || !win) { printedQueue.push(p); return; }
  readPrinted(p).then((f) => {
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    win.webContents.send('open-path', f);
  }).catch(() => {});
}
ipcMain.handle('take-printed', async () => {
  printedReady = true;
  const out = [];
  for (const p of printedQueue.splice(0)) { try { out.push(await readPrinted(p)); } catch { /* 지워졌으면 넘어간다 */ } }
  return out;
});
ipcMain.handle('npki-list', async () => { try { return await listNpki(); } catch { return []; } });
ipcMain.handle('printer-status', () => printerStatus());
ipcMain.handle('printer-install', async () => { try { return await printerInstall(); } catch (e) { return { error: String(e.message || e) }; } });
ipcMain.handle('printer-remove', async () => { try { return await printerRemove(); } catch (e) { return { error: String(e.message || e) }; } });

/**
 * 경로의 파일을 읽는다. 한글·워드·엑셀·파워포인트면 PDF로 바꿔서 돌려준다
 * (바꾼 문서는 원래 파일과 다르므로 path를 비워 '저장'할 때 새 이름을 묻게 한다)
 */
async function readForOpen(p) {
  if (!isOffice(p)) return { name: path.basename(p), bytes: new Uint8Array(await fs.readFile(p)), path: p };
  win?.webContents.send('busy', `"${path.basename(p)}"을 PDF로 바꾸는 중…`);
  try {
    const bytes = await convertToPdf(p);
    return { name: path.basename(p, path.extname(p)) + '.pdf', bytes, convertedFrom: path.basename(p) };
  } finally {
    win?.webContents.send('busy', null);
  }
}
const OPEN_FILTERS = [
  { name: 'PDF·한글·워드·엑셀', extensions: ['pdf', ...OFFICE_EXT] },
  { name: 'PDF 문서', extensions: ['pdf'] },
  { name: '한글 문서', extensions: ['hwp', 'hwpx'] },
  { name: '워드·엑셀·파워포인트', extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'odt', 'ods', 'odp', 'csv', 'txt'] },
];
const OPENABLE = new RegExp(`\\.(pdf|${OFFICE_EXT.join('|')})$`, 'i');

// 실행할 때 받은 파일은 화면이 준비된 뒤 화면 쪽에서 가져간다 (먼저 보내면 받을 곳이 없어 사라진다)
ipcMain.handle('take-pending', async () => {
  const p = pendingPath;
  pendingPath = null;
  if (!p) return null;
  try {
    return await readForOpen(p);
  } catch (e) {
    dialog.showErrorBox('파일을 열지 못했어요', String(e.message || e));
    return null;
  }
});

async function sendPath(p) {
  try {
    win.webContents.send('open-path', await readForOpen(p));
  } catch (e) {
    dialog.showErrorBox('파일을 열지 못했어요', String(e.message || e));
  }
}

// 같은 프로그램을 두 번 실행하면 기존 창에서 파일을 연다
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const p = argv.slice(1).find((a) => OPENABLE.test(a));
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
  setupUpdater(() => win);
  watchPrinted(onPrinted);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
// 저장하지 않은 내용이 있으면 닫기 전에 묻는다. 화면 쪽이 바뀐 내용이 있는지 알려 준다
let unsaved = null; // 바뀐 내용이 있으면 문서 이름
let closing = false;
ipcMain.on('set-unsaved', (_e, name) => { unsaved = name || null; });
ipcMain.on('close-now', () => { closing = true; win?.close(); });
function guardClose(w) {
  w.on('close', (e) => {
    if (closing || !unsaved) return;
    e.preventDefault();
    dialog.showMessageBox(w, {
      type: 'question',
      title: '소우주 PDF',
      message: `"${unsaved}"의 바뀐 내용을 저장할까요?`,
      detail: '저장하지 않고 닫으면 고친 내용이 사라져요.',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) w.webContents.send('save-before-close');
      else if (response === 1) { closing = true; w.close(); }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win, { title: '문서 열기', filters: OPEN_FILTERS, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { return await readForOpen(r.filePaths[0]); }
  catch (e) { return { error: String(e.message || e) }; }
});

// 쪽 넣기·합치기용: PDF와 사진을 여러 개 고른다
ipcMain.handle('open-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '넣을 파일 고르기',
    filters: [{ name: 'PDF·사진·한글·워드·엑셀', extensions: ['pdf', 'jpg', 'jpeg', 'png', ...OFFICE_EXT] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) {
    try { out.push(await readForOpen(p)); }
    catch (e) { dialog.showErrorBox(`"${path.basename(p)}"을 넣지 못했어요`, String(e.message || e)); }
  }
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
// 끌어다 놓은 한글·워드 파일: 화면 쪽은 경로만 알고 있으므로 여기서 바꾼다
ipcMain.handle('convert-path', async (_e, p) => {
  if (typeof p !== 'string' || !isOffice(p)) return { error: 'PDF로 바꿀 수 없는 파일이에요.' };
  try { return await readForOpen(p); }
  catch (e) { return { error: String(e.message || e) }; }
});
ipcMain.handle('open-recent', async (_e, p) => {
  const list = await readRecent();
  if (!list.some((x) => x.path === p)) return null;
  const bytes = await fs.readFile(p);
  return { name: path.basename(p), bytes: new Uint8Array(bytes), path: p };
});

const SAVE_FILTERS = {
  pdf: { title: 'PDF 저장', filters: [{ name: 'PDF 문서', extensions: ['pdf'] }] },
  png: { title: '그림 저장', filters: [{ name: 'PNG 그림', extensions: ['png'] }] },
  jpg: { title: '그림 저장', filters: [{ name: 'JPG 그림', extensions: ['jpg', 'jpeg'] }] },
};
ipcMain.handle('save-file', async (_e, name, bytes) => {
  const ext = String(name).split('.').pop().toLowerCase();
  const r = await dialog.showSaveDialog(win, { defaultPath: name, ...(SAVE_FILTERS[ext === 'jpeg' ? 'jpg' : ext] ?? SAVE_FILTERS.pdf) });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, Buffer.from(bytes));
  return r.filePath;
});

// 여러 파일을 고른 폴더에 저장 (같은 이름이 있으면 덮어쓰지 않고 (2), (3)을 붙인다)
ipcMain.handle('save-files', async (_e, title, files) => {
  const r = await dialog.showOpenDialog(win, { title, buttonLabel: '이 폴더에 저장', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  const written = [];
  for (const f of files) {
    const safe = String(f.name).replace(/[\\/:*?"<>|]/g, '_');
    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe, ext = dot > 0 ? safe.slice(dot) : '';
    let target = path.join(dir, safe);
    for (let k = 2; await fs.access(target).then(() => true, () => false); k++) target = path.join(dir, `${stem} (${k})${ext}`);
    await fs.writeFile(target, Buffer.from(f.bytes));
    written.push(target);
  }
  if (written[0]) shell.showItemInFolder(written[0]);
  return { dir, count: written.length };
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
