// 자동 업데이트: 깃허브 Releases에 새 버전이 올라오면 뒤에서 받아 두고,
// 다 받으면 화면에 알린다. 지금 다시 시작하거나, 다음에 프로그램을 끌 때 설치된다.
const { app, ipcMain } = require('electron');

let state = { status: 'idle', version: null, percent: 0, error: null };
let getWin = () => null;
let updater = null;

function send() {
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send('update-state', state);
}
function set(patch) {
  state = { ...state, ...patch };
  send();
}

function setupUpdater(winGetter) {
  getWin = winGetter;
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('update-state', () => state);
  ipcMain.handle('update-check', () => check(true));
  ipcMain.on('update-install', () => {
    if (updater && state.status === 'ready') updater.quitAndInstall(false, true);
  });
  // 설치해서 쓰는 프로그램에서만 업데이트를 확인한다 (개발 중에는 하지 않음)
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // 지금은 시험판(prerelease)으로 배포하므로 시험판도 받는다
  autoUpdater.allowPrerelease = true;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest' }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version, percent: 100 }));
  autoUpdater.on('error', (e) => set({ status: 'error', error: String((e && e.message) || e).slice(0, 200) }));
  // 켜고 잠시 뒤 한 번, 그 뒤로는 6시간마다
  setTimeout(() => check(false), 8000);
  setInterval(() => check(false), 6 * 60 * 60 * 1000);
}

async function check(byUser) {
  if (!updater) {
    set({ status: 'dev' });
    return state;
  }
  if (state.status === 'downloading' || state.status === 'ready') return state;
  try {
    await updater.checkForUpdates();
  } catch (e) {
    // 인터넷이 없을 때 등: 사용자가 직접 누른 경우에만 알린다
    if (byUser) set({ status: 'error', error: String((e && e.message) || e).slice(0, 200) });
    else set({ status: 'idle' });
  }
  return state;
}

module.exports = { setupUpdater };
