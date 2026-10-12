// 화면(렌더러)에 꼭 필요한 기능만 열어 준다
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

contextBridge.exposeInMainWorld('sowuju', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openFiles: () => ipcRenderer.invoke('open-files'),
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
  saveFiles: (title, files) => ipcRenderer.invoke('save-files', title, files),
  print: (title, pages) => ipcRenderer.invoke('print', title, pages),
  onOpenPath: (cb) => {
    const fn = (_e, file) => cb(file);
    ipcRenderer.on('open-path', fn);
    return () => ipcRenderer.removeListener('open-path', fn);
  },
  takePending: () => ipcRenderer.invoke('take-pending'),
  /** "소우주 PDF" 프린터로 꺼져 있는 동안 인쇄한 문서들 */
  takePrinted: () => ipcRenderer.invoke('take-printed'),
  printerStatus: () => ipcRenderer.invoke('printer-status'),
  printerInstall: () => ipcRenderer.invoke('printer-install'),
  printerRemove: () => ipcRenderer.invoke('printer-remove'),
  /** 끌어다 놓은 한글·워드·엑셀 파일을 PDF로 바꿔 열기 */
  convertPath: (p) => ipcRenderer.invoke('convert-path', p),
  /** 오래 걸리는 일(문서 바꾸기)을 하는 중이면 안내 글, 끝나면 null */
  onBusy: (cb) => {
    const fn = (_e, msg) => cb(msg);
    ipcRenderer.on('busy', fn);
    return () => ipcRenderer.removeListener('busy', fn);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  recentList: () => ipcRenderer.invoke('recent-list'),
  recentAdd: (item) => ipcRenderer.invoke('recent-add', item),
  openRecent: (p) => ipcRenderer.invoke('open-recent', p),
  setZoom: (f) => webFrame.setZoomFactor(f),
  /** 저장하지 않은 내용이 있으면 문서 이름, 없으면 null (창을 닫을 때 물어보기 위해) */
  setUnsaved: (name) => ipcRenderer.send('set-unsaved', name),
  onSaveBeforeClose: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('save-before-close', fn);
    return () => ipcRenderer.removeListener('save-before-close', fn);
  },
  closeNow: () => ipcRenderer.send('close-now'),
  // 자동 업데이트
  appVersion: () => ipcRenderer.invoke('app-version'),
  updateState: () => ipcRenderer.invoke('update-state'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.send('update-install'),
  getAutoUpdate: () => ipcRenderer.invoke('update-auto-get'),
  setAutoUpdate: (on) => ipcRenderer.invoke('update-auto-set', on),
  onUpdate: (cb) => {
    const fn = (_e, st) => cb(st);
    ipcRenderer.on('update-state', fn);
    return () => ipcRenderer.removeListener('update-state', fn);
  },
});
