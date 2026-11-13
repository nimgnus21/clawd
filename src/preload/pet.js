// 小人页面的 preload：只把需要的几个能力安全地暴露给页面
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['tick', 'settings', 'menu', 'falling', 'landed', 'reminder', 'cc', 'say', 'quiet', 'todo', 'sys', 'levelup', 'jumping', 'growth', 'gift'];

contextBridge.exposeInMainWorld('clawd', {
  platform: process.platform,
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  moveBy: (dx) => ipcRenderer.invoke('move-by', dx),
  fall: () => ipcRenderer.send('fall'),
  climb: () => ipcRenderer.invoke('climb'),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', !!ignore),
  contextMenu: (state) => ipcRenderer.send('context-menu', state),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  reminderDone: (kind) => ipcRenderer.invoke('reminder-done', kind),
  todoDone: (id) => ipcRenderer.invoke('todo-done', id),
  interact: (kind) => ipcRenderer.send('interact', kind),
  focusDone: (min) => ipcRenderer.send('focus-done', min),
  festivalSeen: (info) => ipcRenderer.send('festival-seen', info),
  openGift: () => ipcRenderer.invoke('gift-open'),
  on: (channel, fn) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
