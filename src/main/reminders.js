// 定时提醒的调度。计时放在主进程里：即使小人藏到托盘，提醒也照样准时。
// 两种计时方式：
//   按钟点（喝水）：从上次处理开始，过了 N 分钟就提醒
//   按使用时间（久坐、护眼）：只有在用电脑时才计时；离开一会儿（算休息过了）就清零
const EventEmitter = require('events');

const KINDS = ['water', 'sit', 'eye'];

// 按使用时间计时的提醒：离开电脑多久算“休息过了”
const ACTIVITY = {
  sit: { breakSec: 300 }, // 离开 5 分钟 = 起来活动过了
  eye: { breakSec: 60 }, // 离开 1 分钟 = 眼睛休息过了
};

// 系统空闲多久以内还算“正在用电脑”
const ACTIVE_IDLE_SEC = 60;
const CHECK_MS = 5000;

class Reminders extends EventEmitter {
  // getIdle(): 系统空闲秒数（powerMonitor.getSystemIdleTime）
  constructor(settings, getIdle = () => 0) {
    super();
    this.settings = settings;
    this.getIdle = getIdle;
    this.state = {}; // kind -> { due, pending } 或 { active, pending }
    this.intervals = {};
    this.suppressed = false;
    this.timer = null;
    this.lastCheck = Date.now();
    // 时机判断（rhythm.js 设置）：到点了要不要现在就提醒。返回 { ok, reason }
    // reason = 'cc' 表示“Claude 在跑、你手闲着”这种好时机
    this.gate = () => ({ ok: true });
  }

  interval(kind) {
    const m = Number((this.settings.get('reminders') || {})[kind]);
    return m > 0 ? m : 0;
  }

  schedule(kind) {
    const m = this.interval(kind);
    this.intervals[kind] = m;
    if (ACTIVITY[kind]) this.state[kind] = { active: 0, pending: false };
    else this.state[kind] = { due: m ? Date.now() + m * 60000 : 0, pending: false };
  }

  start() {
    KINDS.forEach((k) => this.schedule(k));
    this.settings.on('change', (keys) => {
      if (!keys.includes('reminders')) return;
      for (const k of KINDS) {
        if (this.interval(k) !== this.intervals[k]) {
          this.schedule(k);
          this.emit('clear', k, {});
        }
      }
    });
    this.lastCheck = Date.now();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.check(), CHECK_MS);
  }

  check() {
    const now = Date.now();
    // 电脑睡眠醒来时 dt 会很大，最多按 30 秒算
    const dt = Math.min(30, Math.max(0, (now - this.lastCheck) / 1000));
    this.lastCheck = now;
    const idle = Number(this.getIdle()) || 0;

    for (const k of KINDS) {
      const st = this.state[k];
      const m = this.interval(k);
      if (!st || !m) continue;

      if (ACTIVITY[k]) {
        if (idle >= ACTIVITY[k].breakSec) {
          // 离开电脑够久了：算休息过，清零；正在提醒的也自动收起
          if (st.active > 0 || st.pending) {
            const wasPending = st.pending;
            st.active = 0;
            st.pending = false;
            if (wasPending) this.emit('clear', k, { away: true });
          }
          continue;
        }
        if (idle < ACTIVE_IDLE_SEC) st.active += dt;
        if (!st.pending && !this.suppressed && st.active >= m * 60) this.tryFire(k, st.active - m * 60);
      } else if (!this.suppressed && st.due && !st.pending && now >= st.due) {
        this.tryFire(k, (now - st.due) / 1000);
      }
    }
  }

  // 到点了：问一下时机对不对（你正专心操作时最多推迟一会儿）
  tryFire(kind, overdueSec) {
    const g = this.gate(kind, overdueSec) || { ok: true };
    if (!g.ok) return false;
    this.fire(kind, g.reason || '');
    return true;
  }

  fire(kind, reason = '') {
    const st = this.state[kind];
    if (!st || st.pending || !this.interval(kind)) return;
    st.pending = true;
    st.reason = reason;
    this.emit('due', kind, { reason });
  }

  // 还有多少秒到点（已经到点 / 关闭时返回 0 / Infinity）
  secondsLeft(kind) {
    const st = this.state[kind];
    const m = this.interval(kind);
    if (!st || !m) return Infinity;
    if (st.pending) return 0;
    if (ACTIVITY[kind]) return Math.max(0, m * 60 - (st.active || 0));
    return Math.max(0, ((st.due || 0) - Date.now()) / 1000);
  }

  // 用户处理了提醒（喝了水、伸了懒腰…），重新计时
  ack(kind) {
    if (!KINDS.includes(kind)) return;
    this.schedule(kind);
    this.emit('clear', kind, {});
  }

  // 勿扰时暂停发出新提醒，恢复后补上
  setSuppressed(on) {
    this.suppressed = !!on;
    if (!on) this.check();
  }

  status(kind) {
    const st = this.state[kind] || { pending: false };
    const interval = this.interval(kind);
    const out = { pending: !!st.pending, interval, paused: this.suppressed, activity: !!ACTIVITY[kind], reason: st.pending ? st.reason || '' : '' };
    if (ACTIVITY[kind]) {
      out.active = Math.round(st.active || 0);
      out.remaining = interval ? Math.max(0, Math.round(interval * 60 - (st.active || 0))) : 0;
    } else {
      out.due = st.due || 0;
    }
    return out;
  }

  pendingKinds() {
    return KINDS.filter((k) => this.state[k] && this.state[k].pending);
  }
}

module.exports = { Reminders, KINDS, ACTIVITY };
