// 节奏：Claude 干活，你休息；Claude 需要你，Clawd 叫你回来
//
// 1. 聪明提醒：喝水 / 活动 / 护眼到点时，
//    - Claude 正在跑、你手离开键盘了 → 现在就是好时机，马上提醒（台词也换成“Claude 还在跑，起来接杯水？”）
//    - 你正在打字操作、Claude 也没在跑 → 先等等，最多推迟 10 分钟
//    - Claude 跑了一阵、你在干等，而提醒再过 10 分钟就到点 → 提前提醒
// 2. 叫你回来：你离开电脑（空闲 ≥ 60 秒）时记下 Claude 做完了什么、谁在等你；
//    等批准等了 2 分钟、10 分钟各提醒一次（通知 + 提示音）；你回来那一刻给一句小结
const EventEmitter = require('events');

const AWAY_SEC = 60; // 空闲多久算“人不在”
const BACK_SEC = 3; // 空闲小于这个数 = 回来了
const HANDS_FREE_SEC = 12; // 空闲这么久 = 手离开键盘了（在等 Claude）
const BUSY_SEC = 20; // 空闲小于这个数 = 正在操作
const MAX_DEFER_SEC = 600; // 最多推迟 10 分钟
const EARLY_SEC = 600; // 还差 10 分钟以内的提醒可以提前
const EARLY_EVERY_MS = 15 * 60000; // 提前提醒最多 15 分钟一次
const CC_LONG_MS = 45000; // Claude 跑了这么久才算“长任务”
const NUDGE_AT = [120, 600]; // 等批准等了多少秒时再提醒你

class Rhythm extends EventEmitter {
  // deps: { settings, reminders, cc, getIdle, isQuiet }
  constructor({ settings, reminders, cc, getIdle, isQuiet }) {
    super();
    this.settings = settings;
    this.reminders = reminders;
    this.cc = cc;
    this.getIdle = getIdle;
    this.isQuiet = isQuiet || (() => false);
    this.away = null; // { since, done: Map, errors: [], tests: Map }
    this.waits = new Map(); // session -> { project, since, nudged }
    this.lastEarly = 0;
    this.timer = null;
  }

  config() {
    return { smartBreaks: true, recall: true, sound: true, ...(this.settings.get('rhythm') || {}) };
  }

  idle() {
    return Number(this.getIdle()) || 0;
  }

  start() {
    this.reminders.gate = (kind, overdue) => this.gate(kind, overdue);
    this.cc.on('event', (ev) => this.onCC(ev));
    this.cc.on('sessions', (snap) => this.onSessions(snap));
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 2000);
  }

  stop() {
    clearInterval(this.timer);
  }

  // ================= 1. 聪明提醒 =================
  ccRunning(minMs = 15000) {
    return this.cc.runningFor() >= minMs;
  }

  gate(kind, overdueSec) {
    if (!this.config().smartBreaks) return { ok: true };
    const idle = this.idle();
    if (this.ccRunning() && idle >= HANDS_FREE_SEC) return { ok: true, reason: 'cc' };
    if (overdueSec >= MAX_DEFER_SEC) return { ok: true };
    if (idle < BUSY_SEC) return { ok: false }; // 你正在操作：等一等
    return { ok: true };
  }

  // Claude 在跑长任务、你在干等：快到点的提醒提前说
  maybeEarly(now, idle) {
    if (!this.config().smartBreaks || this.isQuiet() || this.reminders.suppressed) return;
    if (!this.ccRunning(CC_LONG_MS) || idle < HANDS_FREE_SEC || idle >= AWAY_SEC) return;
    if (now - this.lastEarly < EARLY_EVERY_MS || this.reminders.pendingKinds().length) return;
    const kind = ['water', 'sit', 'eye']
      .map((k) => [k, this.reminders.secondsLeft(k)])
      .filter(([, left]) => left <= EARLY_SEC)
      .sort((a, b) => a[1] - b[1])[0];
    if (!kind) return;
    this.lastEarly = now;
    this.reminders.fire(kind[0], 'cc');
  }

  // ================= 2. 叫你回来 =================
  onCC(ev) {
    const now = Date.now();
    const id = ev.session || ev.project || 'default';
    if (ev.type === 'waiting') {
      if (!this.waits.has(id)) this.waits.set(id, { project: ev.project, since: now, nudged: 0 });
      // 你没在打字（可能在看别的窗口）就响一声
      if (this.idle() >= 10) this.emit('sound', 'waiting');
    }
    if (ev.type === 'done' || ev.type === 'error') this.waits.delete(id);
    if (!this.away) return;
    if (ev.type === 'done') {
      const d = this.away.done.get(ev.project) || { project: ev.project, count: 0, took: 0 };
      d.count += 1;
      d.took += ev.took || 0;
      this.away.done.set(ev.project, d);
      this.emit('sound', 'done');
    } else if (ev.type === 'error') {
      this.away.errors.push({ project: ev.project, message: ev.message });
    } else if (ev.type === 'test') {
      this.away.tests.set(ev.project, { project: ev.project, ok: ev.ok });
    }
  }

  // 等批准被处理了（会话不再是 waiting）就不用再催
  onSessions(snap) {
    const waiting = new Set((snap.sessions || []).filter((s) => s.state === 'waiting').map((s) => s.id));
    for (const id of [...this.waits.keys()]) if (!waiting.has(id)) this.waits.delete(id);
  }

  tick() {
    const now = Date.now();
    const idle = this.idle();
    if (!this.away && idle >= AWAY_SEC) {
      this.away = { since: now - idle * 1000, done: new Map(), errors: [], tests: new Map() };
    } else if (this.away && idle < BACK_SEC) {
      this.back(now);
    }
    // 人不在、Claude 一直在等：2 分钟、10 分钟各催一次
    if (this.away && this.config().recall) {
      for (const w of this.waits.values()) {
        const waited = (now - w.since) / 1000;
        if (w.nudged < NUDGE_AT.length && waited >= NUDGE_AT[w.nudged]) {
          w.nudged += 1;
          this.emit('nudge', { project: w.project, minutes: Math.round(waited / 60) });
          this.emit('sound', 'waiting');
        }
      }
    }
    this.maybeEarly(now, idle);
  }

  back(now) {
    const a = this.away;
    this.away = null;
    if (!this.config().recall) return;
    const minutes = Math.max(1, Math.round((now - a.since) / 60000));
    const recap = {
      minutes,
      done: [...a.done.values()].map((d) => ({ project: d.project, count: d.count, minutes: Math.round(d.took / 60000) })),
      waiting: [...this.waits.values()].map((w) => ({ project: w.project, minutes: Math.max(0, Math.round((now - w.since) / 60000)) })),
      errors: a.errors.slice(-3),
      tests: [...a.tests.values()],
    };
    if (recap.done.length || recap.waiting.length || recap.errors.length || recap.tests.length) this.emit('recap', recap);
  }

  // 给面板看
  status() {
    return {
      away: !!this.away,
      awayFor: this.away ? Math.round((Date.now() - this.away.since) / 1000) : 0,
      waiting: [...this.waits.values()].map((w) => ({ project: w.project, since: w.since })),
      config: this.config(),
    };
  }
}

module.exports = { Rhythm, AWAY_SEC, MAX_DEFER_SEC };
