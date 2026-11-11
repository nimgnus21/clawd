// JSON 文件存储：读取、防抖保存、变更事件
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class JsonStore extends EventEmitter {
  constructor(file, defaults) {
    super();
    this.file = file;
    this.defaults = defaults;
    this.data = clone(defaults);
    this.raw = {};
    this.timer = null;
  }

  // 读文件；migrate(data, raw) 用来修正旧版本的数据
  load(migrate) {
    try {
      this.raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch {
      this.raw = {}; // 第一次运行，或文件损坏
    }
    this.data = { ...clone(this.defaults), ...clone(this.raw) };
    if (migrate) migrate(this.data, this.raw);
    return this;
  }

  get(key) {
    return this.data[key];
  }

  all() {
    return this.data;
  }

  // 合并修改并保存；有变化时发出 change 事件（参数：变化的键名列表）
  set(patch, { quiet = false } = {}) {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(this.data[k]) !== JSON.stringify(v)) {
        this.data[k] = clone(v);
        changed.push(k);
      }
    }
    if (changed.length) {
      this.save();
      if (!quiet) this.emit('change', changed);
    }
    return changed;
  }

  // 修改某个对象/数组字段：update('days', (days) => { days.x = 1; })
  update(key, fn, opts) {
    const value = clone(this.data[key]);
    const result = fn(value);
    return this.set({ [key]: result === undefined ? value : result }, opts);
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file); // 先写临时文件再改名，断电也不会写坏
    } catch {
      // 写不进去就算了，不影响使用
    }
  }
}

module.exports = { JsonStore, clone };
