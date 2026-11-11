// 控制面板的 preload
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('panel:get-state'),
  action: (name, ...args) => ipcRenderer.invoke('panel:action', name, args),
  onState: (fn) => ipcRenderer.on('panel:state', (_e, state) => fn(state)),
  onNav: (fn) => ipcRenderer.on('panel:nav', (_e, tab) => fn(tab)),
  onChatDelta: (fn) => ipcRenderer.on('panel:chat-delta', (_e, d) => fn(d)),
});
