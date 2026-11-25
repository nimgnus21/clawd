// 小人所在的透明窗口：创建、拖动、掉落、散步移动、鼠标穿透
const { BrowserWindow, ipcMain, screen, powerMonitor } = require('electron');
const EventEmitter = require('events');
const path = require('path');
const { GRID_W, GRID_H, SCALES, IS_LINUX, IS_MAC, IS_WIN } = require('./config');
const surfaces = require('./surfaces');
const winapi = require('./winapi');

const ROOT = path.join(__dirname, '..', '..');

class PetWindow extends EventEmitter {
  // getIdle(): 系统空闲秒数
  constructor(settings, getIdle = () => powerMonitor.getSystemIdleTime()) {
    super();
    this.settings = settings;
    this.getIdle = getIdle;
    this.win = null;
    this.dragTimer = null;
    this.dragOffset = null;
    this.fallTimer = null;
    this.tickTimer = null;
    this.cursorOverride = null; // 测试用：假装鼠标在某个位置
    this.windowsProvider = null; // 测试用：假装桌面上有哪些窗口
    this.winCache = { at: 0, list: [] };
    this.stand = null; // 现在站在哪个窗口上 { hwnd, left, top }（hwnd 0 = 任务栏）
    this.jumpTimer = null;
    this.rideTimer = null;
    this.crew = 0; // 旁边站了几只小 Clawd（一个 Claude Code 会话一只）
    this.registerIpc();
  }

  // ---------- 尺寸 / 位置 ----------
  scale(size = this.settings.get('size')) {
    return SCALES[size] || SCALES.medium;
  }

  size(size) {
    const s = this.scale(size);
    // 上方留出对话气泡和跳跃的空间；小队左右交替站，两边各留出位置
    const ws = Math.max(3, s - 1);
    const slot = Math.max(84, GRID_W * ws + 20);
    const crewW = Math.ceil(this.crew / 2) * slot * 2;
    return { width: Math.max(240, GRID_W * s + 80 + crewW), height: GRID_H * s + 150 };
  }

  // 小队人数变了：窗口加宽 / 变窄，主 Clawd 位置不动
  setCrew(n) {
    const c = Math.max(0, Math.min(3, Math.round(Number(n) || 0)));
    if (c === this.crew) return;
    this.crew = c;
    this.resize();
  }

  spriteWidth() {
    return GRID_W * this.scale();
  }

  workAreaFor(bounds) {
    return screen.getDisplayMatching(bounds).workArea;
  }

  // 窗口比小人宽，允许窗口两侧超出屏幕一点，让小人能走到屏幕边缘
  xLimits(bounds) {
    const wa = this.workAreaFor(bounds);
    const pad = Math.floor((bounds.width - this.spriteWidth()) / 2);
    return { min: wa.x - pad, max: wa.x + wa.width - bounds.width + pad };
  }

  // ---------- 爬窗口 ----------
  climbEnabled() {
    return !!(this.settings.get('walk') && this.settings.get('climb') !== false && (IS_WIN || this.windowsProvider));
  }

  // 桌面上其他窗口的位置（DIP，从上到下），缓存 300ms
  windows() {
    const now = Date.now();
    if (now - this.winCache.at < 300) return this.winCache.list;
    let list = [];
    if (this.windowsProvider) {
      list = this.windowsProvider() || [];
    } else if (IS_WIN && winapi.available()) {
      const self = this.alive() ? [winapi.hwndOf(this.win)] : [];
      list = winapi.listWindows(self).map((w) => {
        const r = w.rect;
        let d = { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
        try { d = screen.screenToDipRect(null, d); } catch { /* 非 Windows */ }
        return { hwnd: w.hwnd, rect: { left: d.x, top: d.y, right: d.x + d.width, bottom: d.y + d.height } };
      });
    }
    this.winCache = { at: now, list };
    return list;
  }

  // 脚底下最近的地面
  groundBelow(bounds) {
    const wa = this.workAreaFor(bounds);
    if (!this.climbEnabled()) return { y: wa.y + wa.height, hwnd: 0, rect: null };
    return surfaces.groundBelow(this.windows(), bounds.x + bounds.width / 2, bounds.y + bounds.height, wa);
  }

  // “地面”= 任务栏 / Dock 上沿；开了爬窗口就是脚下最近的窗口顶边
  groundY(bounds) {
    return this.groundBelow(bounds).y - bounds.height;
  }

  markStanding() {
    const b = this.bounds();
    if (!b) return;
    const g = this.groundBelow(b);
    this.stand = g.rect ? { hwnd: g.hwnd, left: g.rect.left, top: g.rect.top } : { hwnd: 0 };
  }

  // 站着的窗口挪了：跟着挪。返回 false 表示窗口没了（该掉下去了）
  followStand() {
    if (!this.stand || !this.stand.hwnd) return true;
    const w = this.windows().find((x) => x.hwnd === this.stand.hwnd);
    if (!w) return false;
    const dx = Math.round(w.rect.left - this.stand.left);
    const dy = Math.round(w.rect.top - this.stand.top);
    if (dx || dy) {
      const b = this.win.getBounds();
      this.moveTo(b.x + dx, b.y + dy);
      this.stand = { hwnd: w.hwnd, left: w.rect.left, top: w.rect.top };
    }
    return true;
  }

  // 还站得住吗（没走出边缘、顶边没被别的窗口挡住）
  stillStanding() {
    const b = this.win.getBounds();
    const on = surfaces.standingOn(this.windows(), b.x + b.width / 2, b.y + b.height, this.workAreaFor(b));
    return !!(on && on.hwnd === this.stand.hwnd);
  }

  // 站在窗口上：窗口挪了就跟着挪，窗口没了 / 被挡住了就掉下去
  checkRide() {
    if (!this.alive() || this.dragTimer || this.fallTimer || this.jumpTimer || !this.climbEnabled()) return;
    if (!this.stand || !this.stand.hwnd) return;
    if (!this.followStand() || !this.stillStanding()) {
      this.stand = null;
      this.startFall();
    }
  }

  startRideCheck() {
    clearInterval(this.rideTimer);
    this.rideTimer = setInterval(() => this.checkRide(), 300);
  }

  // 跳到附近的窗口上：抛物线
  climb() {
    if (!this.alive() || this.dragTimer || this.fallTimer || this.jumpTimer || !this.climbEnabled()) return { ok: false };
    const b = this.win.getBounds();
    const wa = this.workAreaFor(b);
    const targets = surfaces.climbTargets(this.windows(), b.x + b.width / 2, b.y + b.height, wa);
    if (!targets.length) return { ok: false };
    const t = targets[Math.floor(Math.random() * targets.length)];
    const x0 = b.x;
    const y0 = b.y;
    const x1 = Math.round(t.x - b.width / 2);
    const y1 = t.y - b.height;
    const lift = 70; // 比目标再高一点
    const ms = 650;
    const start = Date.now();
    this.send('jumping', { dir: Math.sign(x1 - x0) || 1 });
    this.jumpTimer = setInterval(() => {
      if (!this.alive()) { clearInterval(this.jumpTimer); this.jumpTimer = null; return; }
      const k = Math.min(1, (Date.now() - start) / ms);
      const x = x0 + (x1 - x0) * k;
      const y = y0 + (y1 - y0) * k - 4 * lift * k * (1 - k);
      this.moveTo(x, y);
      if (k >= 1) {
        clearInterval(this.jumpTimer);
        this.jumpTimer = null;
        this.winCache.at = 0;
        this.markStanding();
        this.send('landed', { impact: 12 });
        this.rememberPosition();
      }
    }, 16);
    return { ok: true, hwnd: t.hwnd };
  }

  alive() {
    return this.win && !this.win.isDestroyed();
  }

  bounds() {
    return this.alive() ? this.win.getBounds() : null;
  }

  isVisible() {
    return this.alive() && this.win.isVisible();
  }

  moveTo(x, y) {
    if (!this.alive()) return;
    const { width, height } = this.size();
    // 用 setBounds 并固定宽高，避免 Windows 高 DPI 下 setPosition 让窗口越拖越大的问题
    this.win.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  }

  rememberPosition() {
    const b = this.bounds();
    if (b) this.settings.set({ x: b.x, y: b.y }, { quiet: true });
  }

  static isOnSomeScreen(x, y, width, height) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    return screen.getAllDisplays().some(({ bounds: d }) =>
      cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
  }

  defaultPosition(width, height) {
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: wa.x + wa.width - width - 60, y: wa.y + wa.height - height };
  }

  initialPosition(width, height) {
    const x = this.settings.get('x');
    const y = this.settings.get('y');
    if (Number.isFinite(x) && Number.isFinite(y) && PetWindow.isOnSomeScreen(x, y, width, height)) {
      return { x, y };
    }
    return this.defaultPosition(width, height);
  }

  ensureOnScreen() {
    const b = this.bounds();
    if (b && !PetWindow.isOnSomeScreen(b.x, b.y, b.width, b.height)) {
      const p = this.defaultPosition(b.width, b.height);
      this.moveTo(p.x, p.y);
      this.rememberPosition();
    }
  }

  // 换大小时保持小人脚底中心不动
  resize() {
    const old = this.bounds();
    if (!old) return;
    const { width, height } = this.size();
    const x = Math.round(old.x + old.width / 2 - width / 2);
    const y = old.y + old.height - height;
    this.win.setBounds({ x, y, width, height });
    this.rememberPosition();
  }

  setOnTop(on) {
    if (this.alive()) this.win.setAlwaysOnTop(on, 'floating');
  }

  show() {
    if (this.alive()) this.win.showInactive();
  }

  hide() {
    if (this.alive()) this.win.hide();
  }

  toggle() {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  send(channel, data) {
    if (this.alive()) this.win.webContents.send(channel, data);
  }

  // ---------- 创建 ----------
  create() {
    const { width, height } = this.size();
    const pos = this.initialPosition(width, height);

    this.win = new BrowserWindow({
      width,
      height,
      x: pos.x,
      y: pos.y,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: this.settings.get('onTop'),
      title: 'Clawd',
      webPreferences: {
        preload: path.join(ROOT, 'src', 'preload', 'pet.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        // 提示音（Claude 等你批准）不需要先点一下页面
        autoplayPolicy: 'no-user-gesture-required',
      },
    });

    if (this.settings.get('onTop')) this.win.setAlwaysOnTop(true, 'floating');
    if (IS_MAC) this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // 透明区域鼠标穿透：鼠标不在小人身上时，点击会落到后面的窗口
    // （Linux 不支持事件转发，所以 Linux 上整个小窗口都可点击）
    if (!IS_LINUX) this.win.setIgnoreMouseEvents(true, { forward: true });

    this.win.webContents.setVisualZoomLevelLimits(1, 1);
    this.win.loadFile(path.join(ROOT, 'src', 'renderer', 'pet', 'index.html'));

    this.win.once('ready-to-show', () => this.show());
    this.win.webContents.on('did-finish-load', () => {
      this.emit('loaded');
      if (this.settings.get('walk')) this.startFall();
    });
    this.win.on('closed', () => { this.win = null; });
    this.win.on('show', () => this.emit('visibility'));
    this.win.on('hide', () => this.emit('visibility'));

    this.startTicker();
    this.startRideCheck();
    return this.win;
  }

  // 每 120ms 把鼠标位置和系统空闲时间发给小人（用于眼睛跟随、摸头、睡觉）
  startTicker() {
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      if (!this.isVisible()) return;
      const c = this.cursorOverride || screen.getCursorScreenPoint();
      const b = this.win.getBounds();
      this.send('tick', { cx: c.x - b.x, cy: c.y - b.y, idle: this.getIdle() });
    }, 120);
  }

  // ---------- 掉落（散步模式下松手会掉到任务栏上） ----------
  stopFall() {
    clearInterval(this.fallTimer);
    this.fallTimer = null;
  }

  startFall() {
    if (!this.alive()) return;
    this.stopFall();
    const start = this.win.getBounds();
    const lim = this.xLimits(start);
    const x = Math.min(Math.max(start.x, lim.min), lim.max);

    this.winCache.at = 0; // 掉下来之前刷新一下窗口位置
    if (start.y >= this.groundY(start)) {
      // 已经在地上（或者被拖进了任务栏里），直接放到地面
      this.moveTo(x, this.groundY(start));
      this.markStanding();
      this.send('landed', { impact: 0 });
      this.rememberPosition();
      return;
    }

    this.send('falling');
    let vy = 0;
    let y = start.y;
    this.fallTimer = setInterval(() => {
      if (!this.alive()) return this.stopFall();
      const b = this.win.getBounds();
      const gy = this.groundY(b);
      vy = Math.min(vy + 1.4, 38);
      y += vy;
      if (y >= gy) {
        this.moveTo(x, gy);
        this.stopFall();
        this.markStanding();
        this.send('landed', { impact: vy });
        this.rememberPosition();
        return undefined;
      }
      this.moveTo(x, y);
      return undefined;
    }, 16);
  }

  // ---------- 页面发来的请求 ----------
  fromPet(e) {
    return this.alive() && e.sender === this.win.webContents;
  }

  registerIpc() {
    ipcMain.on('drag-start', (e) => {
      if (!this.fromPet(e)) return;
      this.stopFall();
      this.stand = null;
      const c = screen.getCursorScreenPoint();
      const b = this.win.getBounds();
      this.dragOffset = { x: c.x - b.x, y: c.y - b.y };
      clearInterval(this.dragTimer);
      this.dragTimer = setInterval(() => {
        const p = screen.getCursorScreenPoint();
        this.moveTo(p.x - this.dragOffset.x, p.y - this.dragOffset.y);
      }, 15);
    });

    ipcMain.on('drag-end', (e) => {
      if (!this.fromPet(e)) return;
      clearInterval(this.dragTimer);
      this.dragTimer = null;
      if (this.settings.get('walk')) this.startFall();
      else this.rememberPosition();
    });

    ipcMain.on('fall', (e) => {
      if (this.fromPet(e)) this.startFall();
    });

    ipcMain.handle('move-by', (e, dx) => {
      if (!this.fromPet(e) || this.dragTimer || this.fallTimer || this.jumpTimer) return { blocked: true };
      const riding = this.climbEnabled() && this.stand && this.stand.hwnd;
      // 先跟上脚下窗口的移动，再走路
      if (riding && !this.followStand()) {
        this.stand = null;
        this.startFall();
        return { fell: true };
      }
      const b = this.win.getBounds();
      const lim = this.xLimits(b);
      let nx = b.x + Math.round(Number(dx) || 0);
      let edge = 0;
      if (nx <= lim.min) { nx = lim.min; edge = -1; }
      if (nx >= lim.max) { nx = lim.max; edge = 1; }
      this.moveTo(nx, b.y);
      this.rememberPosition();
      // 站在窗口上走到了边缘：掉下去
      if (riding && !this.stillStanding()) {
        this.stand = null;
        this.startFall();
        return { edge, fell: true };
      }
      return { edge };
    });

    ipcMain.handle('climb', (e) => (this.fromPet(e) ? this.climb() : { ok: false }));

    ipcMain.on('set-crew', (e, n) => {
      if (this.fromPet(e)) this.setCrew(n);
    });

    ipcMain.on('set-ignore', (e, ignore) => {
      if (IS_LINUX || !this.fromPet(e)) return;
      if (ignore) this.win.setIgnoreMouseEvents(true, { forward: true });
      else this.win.setIgnoreMouseEvents(false);
    });
  }
}

module.exports = { PetWindow };
