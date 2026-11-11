// 勿扰：自动（全屏程序、游戏、演示模式）+ 手动（30 分钟 / 1 小时 / …）
const EventEmitter = require('events');
const winapi = require('./winapi');

const CHECK_MS = 2500;

class Dnd extends EventEmitter {
  // getSelfHwnds(): 自己的窗口句柄（不能把自己的窗口当成全屏程序）
  constructor(settings, getSelfHwnds = () => []) {
    super();
    this.settings = settings;
    this.getSelfHwnds = getSelfHwnds;
    this.auto = null; // { reason, title }
    this.wasActive = false;
    this.timer = null;
  }

  config() {
    return { auto: true, action: 'hide', manualUntil: 0, ...(this.settings.get('dnd') || {}) };
  }

  setConfig(patch) {
    this.settings.set({ dnd: { ...this.config(), ...patch } });
    this.evaluate();
  }

  supported() {
    return winapi.available();
  }

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.evaluate(), CHECK_MS);
    this.evaluate();
  }

  detectAuto() {
    if (!this.config().auto || !winapi.available()) return null;
    const quns = winapi.notificationState();
    if (quns === 'presentation') return { reason: 'presentation' };
    if (quns === 'd3d_fullscreen') return { reason: 'game' };
    const fs = winapi.foregroundFullscreen(this.getSelfHwnds());
    if (fs) return { reason: 'fullscreen', title: fs.title };
    if (quns === 'busy') return { reason: 'fullscreen' };
    return null;
  }

  evaluate() {
    this.auto = this.detectAuto();
    const cfg = this.config();
    if (cfg.manualUntil && cfg.manualUntil <= Date.now()) {
      // 手动勿扰到点了
      this.settings.set({ dnd: { ...cfg, manualUntil: 0 } });
    }
    const active = this.active();
    if (active !== this.wasActive) {
      this.wasActive = active;
      this.emit('change', this.status());
    }
  }

  active() {
    return !!this.auto || this.config().manualUntil > Date.now();
  }

  // minutes: 数字 = 多少分钟；'tomorrow' = 到明天早上 8 点；0 = 结束
  setManual(minutes) {
    let until = 0;
    if (minutes === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + (d.getHours() < 8 ? 0 : 1));
      d.setHours(8, 0, 0, 0);
      until = d.getTime();
    } else if (Number(minutes) > 0) {
      until = Date.now() + Number(minutes) * 60000;
    }
    this.setConfig({ manualUntil: until });
  }

  status() {
    const cfg = this.config();
    const manual = cfg.manualUntil > Date.now() ? cfg.manualUntil : 0;
    let reason = '';
    if (this.auto) reason = this.auto.reason;
    else if (manual) reason = 'manual';
    return {
      active: this.active(),
      reason,
      title: (this.auto && this.auto.title) || '',
      manualUntil: manual,
      auto: cfg.auto,
      action: cfg.action,
      supported: this.supported(),
    };
  }
}

module.exports = { Dnd };
