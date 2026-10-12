// 화면(렌더러)에 꼭 필요한 기능만 열어 준다
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

contextBridge.exposeInMainWorld('sowuju', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openFiles: () => ipcRenderer.invoke('open-files'),
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
  print: (title, pages) => ipcRenderer.invoke('print', title, pages),
  onOpenPath: (cb) => {
    const fn = (_e, file) => cb(file);
    ipcRenderer.on('open-path', fn);
    return () => ipcRenderer.removeListener('open-path', fn);
  },
  takePending: () => ipcRenderer.invoke('take-pending'),
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
