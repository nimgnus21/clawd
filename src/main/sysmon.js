// 电脑状态：CPU、内存占用（每 3 秒采样一次）。电量在页面里用浏览器的 Battery API 读。
const EventEmitter = require('events');
const os = require('os');

const SAMPLE_MS = 3000;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

class SysMon extends EventEmitter {
  constructor() {
    super();
    this.prev = null;
    this.last = { cpu: 0, mem: 0, at: 0 };
    this.timer = null;
    this.override = null; // 测试用
  }

  start() {
    this.prev = cpuTimes();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
  }

  sample() {
    let cpu = 0;
    const now = cpuTimes();
    if (this.prev) {
      const dt = now.total - this.prev.total;
      cpu = dt > 0 ? Math.max(0, Math.min(1, 1 - (now.idle - this.prev.idle) / dt)) : 0;
    }
    this.prev = now;
    const mem = 1 - os.freemem() / os.totalmem();
    this.last = { cpu: Math.round(cpu * 100), mem: Math.round(mem * 100), at: Date.now(), ...(this.override || {}) };
    this.emit('sample', this.last);
  }
}

module.exports = { SysMon };
