// 每日统计：喝水杯数等，按天存在 data.json 里
const { dayKey } = require('./config');

const KEEP_DAYS = 400;

class Stats {
  constructor(data) {
    this.data = data;
  }

  today() {
    return (this.data.get('days') || {})[dayKey()] || {};
  }

  get(field) {
    return this.today()[field] || 0;
  }

  // 给今天的某一项加 n，返回新值
  add(field, n = 1) {
    const key = dayKey();
    let value = 0;
    this.data.update('days', (days) => {
      const day = days[key] || {};
      day[field] = (day[field] || 0) + n;
      value = day[field];
      days[key] = day;
      // 只保留最近一年多的数据
      const keys = Object.keys(days).sort();
      while (keys.length > KEEP_DAYS) delete days[keys.shift()];
    });
    return value;
  }

  // 最近 n 天（含今天）的数据，从早到晚
  lastDays(n) {
    const days = this.data.get('days') || {};
    const out = [];
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1));
    for (let i = 0; i < n; i++) {
      const key = dayKey(d);
      out.push({ date: key, ...(days[key] || {}) });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
}

module.exports = { Stats };
