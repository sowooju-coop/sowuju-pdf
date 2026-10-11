// 화면(렌더러)에 꼭 필요한 기능만 열어 준다
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sowuju', {
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
  print: (title, pages) => ipcRenderer.invoke('print', title, pages),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, file) => cb(file)),
});
