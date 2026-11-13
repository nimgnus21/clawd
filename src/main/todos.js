// 待办清单：存在 data.json 里；到了提醒时间就让 Clawd 提醒
const EventEmitter = require('events');
const crypto = require('crypto');

const CHECK_MS = 10000;
const MAX_TODOS = 200;

class Todos extends EventEmitter {
  constructor(data, stats) {
    super();
    this.data = data;
    this.stats = stats;
    this.suppressed = false;
    this.timer = null;
  }

  list() {
    return Array.isArray(this.data.get('todos')) ? this.data.get('todos') : [];
  }

  open() {
    return this.list().filter((t) => !t.done);
  }

  find(id) {
    return this.list().find((t) => t.id === id);
  }

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.check(), CHECK_MS);
    this.check();
  }

  mutate(fn) {
    this.data.update('todos', (list) => {
      const arr = Array.isArray(list) ? list : [];
      fn(arr);
      // 只保留最近的若干条（已完成的先删）
      while (arr.length > MAX_TODOS) {
        const i = arr.findIndex((t) => t.done);
        arr.splice(i >= 0 ? i : 0, 1);
      }
      return arr;
    });
  }

  add(text, remindAt = 0) {
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return { error: '内容不能为空' };
    const todo = {
      id: crypto.randomBytes(6).toString('hex'),
      text: t,
      done: false,
      createdAt: Date.now(),
      doneAt: 0,
      remindAt: Number(remindAt) > 0 ? Number(remindAt) : 0,
      reminded: false,
    };
    this.mutate((arr) => arr.push(todo));
    this.check();
    return todo;
  }

  edit(id, patch = {}) {
    let found = null;
    this.mutate((arr) => {
      const t = arr.find((x) => x.id === id);
      if (!t) return;
      if (typeof patch.text === 'string' && patch.text.trim()) t.text = patch.text.trim().slice(0, 200);
      if ('remindAt' in patch) {
        t.remindAt = Number(patch.remindAt) > 0 ? Number(patch.remindAt) : 0;
        t.reminded = false;
      }
      found = { ...t };
    });
    if (found) this.emit('clear', id);
    this.check();
    return found || { error: '找不到这条待办' };
  }

  setDone(id, done = true) {
    let changed = false;
    let first = false;
    this.mutate((arr) => {
      const t = arr.find((x) => x.id === id);
      if (!t || t.done === !!done) return;
      t.done = !!done;
      t.doneAt = done ? Date.now() : 0;
      // 同一条待办反复勾选只算第一次（统计、经验、每日任务）
      if (done && !t.counted) { t.counted = true; first = true; }
      changed = true;
    });
    if (changed) {
      if (first) this.stats.add('todosDone', 1);
      this.emit('clear', id);
      if (first) this.emit('done', this.find(id));
    }
    return { ok: changed, left: this.open().length };
  }

  remove(id) {
    this.mutate((arr) => {
      const i = arr.findIndex((x) => x.id === id);
      if (i >= 0) arr.splice(i, 1);
    });
    this.emit('clear', id);
  }

  clearDone() {
    this.mutate((arr) => {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].done) arr.splice(i, 1);
    });
  }

  // 稍后再提醒
  snooze(id, minutes = 10) {
    this.mutate((arr) => {
      const t = arr.find((x) => x.id === id);
      if (!t) return;
      t.remindAt = Date.now() + minutes * 60000;
      t.reminded = false;
    });
    this.emit('clear', id);
  }

  setSuppressed(on) {
    this.suppressed = !!on;
    if (!on) this.check();
  }

  check() {
    if (this.suppressed) return;
    const now = Date.now();
    const due = this.list().filter((t) => !t.done && t.remindAt && !t.reminded && t.remindAt <= now);
    if (!due.length) return;
    this.mutate((arr) => {
      for (const t of arr) if (due.some((d) => d.id === t.id)) t.reminded = true;
    });
    for (const t of due) this.emit('due', { ...t, reminded: true });
  }

  // 已经提醒过、还没完成的（小人重启后要重新显示）
  pendingReminders() {
    return this.list().filter((t) => !t.done && t.reminded);
  }
}

module.exports = { Todos };
