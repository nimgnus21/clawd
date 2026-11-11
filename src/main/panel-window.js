// 控制面板：一个普通窗口，里面是各种设置和数据
const { BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

class PanelWindow {
  // getState(): 面板要显示的全部数据；actions: 面板可以调用的操作（白名单）
  constructor({ getState, actions }) {
    this.getState = getState;
    this.actions = actions;
    this.win = null;
    this.pushTimer = null;
    this.registerIpc();
  }

  alive() {
    return this.win && !this.win.isDestroyed();
  }

  open(tab) {
    if (this.alive()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      if (tab) this.win.webContents.send('panel:nav', tab);
      return;
    }
    this.win = new BrowserWindow({
      width: 860,
      height: 600,
      minWidth: 680,
      minHeight: 480,
      show: false,
      title: 'Clawd 控制面板',
      icon: path.join(ROOT, 'assets', 'icon.png'),
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1d' : '#f5f4ee',
      webPreferences: {
        preload: path.join(ROOT, 'src', 'preload', 'panel.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win.setMenu(null);
    this.win.loadFile(path.join(ROOT, 'src', 'renderer', 'panel', 'index.html'), { query: tab ? { tab } : {} });
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('closed', () => { this.win = null; });
  }

  // 数据变了就推给面板（合并 100ms 内的多次变化）
  push() {
    if (!this.alive()) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      if (this.alive()) this.win.webContents.send('panel:state', this.getState());
    }, 100);
  }

  // 直接发一条消息给面板（聊天的流式文字等，不走整份状态）
  send(channel, data) {
    if (this.alive()) this.win.webContents.send(channel, data);
  }

  fromPanel(e) {
    return this.alive() && e.sender === this.win.webContents;
  }

  registerIpc() {
    ipcMain.handle('panel:get-state', (e) => (this.fromPanel(e) ? this.getState() : null));
    ipcMain.handle('panel:action', async (e, name, args) => {
      if (!this.fromPanel(e)) return { error: 'denied' };
      const fn = this.actions[name];
      if (typeof fn !== 'function') return { error: `unknown action ${name}` };
      try {
        const result = await fn(...(Array.isArray(args) ? args : []));
        this.push();
        return result === undefined ? { ok: true } : result;
      } catch (err) {
        return { error: String((err && err.message) || err) };
      }
    });
  }
}

module.exports = { PanelWindow };
