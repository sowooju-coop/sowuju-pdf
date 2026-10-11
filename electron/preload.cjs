// 화면(렌더러)에 꼭 필요한 기능만 열어 준다
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

contextBridge.exposeInMainWorld('sowuju', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openFiles: () => ipcRenderer.invoke('open-files'),
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
  print: (title, pages) => ipcRenderer.invoke('print', title, pages),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, file) => cb(file)),
  pathForFile: (file) => webUtils.getPathForFile(file),
  recentList: () => ipcRenderer.invoke('recent-list'),
  recentAdd: (item) => ipcRenderer.invoke('recent-add', item),
  openRecent: (p) => ipcRenderer.invoke('open-recent', p),
  setZoom: (f) => webFrame.setZoomFactor(f),
});
