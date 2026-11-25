// 成长：今日三环 → 打卡 🔥 → ✦ → 等级和衣柜
//
// 一条主线：
//   1. 每天三个环：喝水、活动、专注（进度直接来自每日统计，不用另外做任务）
//   2. 合上一个环 +10✦，三环全满再 +10✦；合上 2 个环就算今天打卡，连续打卡有里程碑奖励
//   3. ✦ 用来在衣柜里买皮肤和配饰；累计获得的 ✦ 决定等级；特别的几件靠里程碑解锁
//   4. Clawd 的心情 = 今天照顾自己照顾得怎么样（不再随时间自己往下掉）
const EventEmitter = require('events');
const { dayKey } = require('./config');
const cat = require('./growth-catalog');

const KEEP_LOG_DAYS = 120;

// ---------- 日期小工具（本地时间 'YYYY-MM-DD'） ----------
function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
function isWeekend(key) {
  const w = parseDay(key).getDay();
  return w === 0 || w === 6;
}
// a 到 b 之间（不含两头）的日期
function daysBetween(a, b) {
  const out = [];
  for (let d = addDays(a, 1); d < b && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

function blankToday(day = '') {
  return { day, closed: [], checkin: false, all: false, announced: false, nudged: false };
}

function blank() {
  return {
    version: 3,
    stars: 0,
    earned: 0, // 累计获得的 ✦（决定等级）
    owned: ['classic'],
    streak: { count: 0, best: 0, through: '', freezes: 0 },
    today: blankToday(),
    totals: { rings: 0, checkins: 0 },
    log: {},
    dayNote: null,
    yesterday: null,
    welcomed: false,
  };
}

// 2.x 的经验值换算成 3.0 的累计 ✦，保证老用户等级不掉
const OLD_LEVEL_UNLOCKS = { 2: ['bow'], 3: ['shades'], 4: ['flower'], 5: ['headphones'], 6: ['chef'], 7: ['glasses'], 8: ['grad'], 10: ['crown'] };
function oldLevelFor(xp) {
  let l = 1;
  while (25 * l * (l + 1) <= xp) l += 1;
  return l;
}

// 2.x → 3.0：星星、连续天数、已拥有的装扮都留着；随机任务、零食、礼物、成就这些去掉
function migrate(old = {}, progress = {}) {
  const g = blank();
  g.stars = Math.max(0, Math.round(old.stars || 0));
  const oldLevel = oldLevelFor(Math.max(0, progress.xp || 0));
  g.earned = Math.max(Math.round(old.starsEarned || 0), cat.starsForLevel(oldLevel));
  const owned = new Set(['classic', ...(old.skins || []), ...(progress.unlocked || [])]);
  for (const [l, ids] of Object.entries(OLD_LEVEL_UNLOCKS)) if (Number(l) <= oldLevel) ids.forEach((id) => owned.add(id));
  g.owned = [...owned].filter((id) => cat.ITEM[id]);
  if (old.streak) {
    const s = old.streak;
    g.streak = { count: s.count || 0, best: s.best || 0, through: s.through || '', freezes: s.freezes || 0 };
  }
  g.log = old.log || {};
  g.totals.checkins = Object.values(g.log).filter((e) => e && e.checkin).length;
  g.migratedFrom = old.version || (Object.keys(old).length ? 2 : 0);
  return { g, skin: old.skin };
}

class Growth extends EventEmitter {
  // deps: { data, settings, stats }
  constructor({ data, settings, stats }) {
    super();
    this.data = data;
    this.settings = settings;
    this.stats = stats;
    this.timer = null;
    this.checkQueued = false;
    this.pending = [];
  }

  // ================= 存取 =================
  raw() {
    const b = blank();
    const g = { ...b, ...(this.data.get('growth') || {}) };
    g.streak = { ...b.streak, ...(g.streak || {}) };
    g.today = { ...b.today, ...(g.today || {}) };
    g.totals = { ...b.totals, ...(g.totals || {}) };
    return g;
  }

  save(g, opts) {
    this.data.set({ growth: g }, opts);
    this.emit('change');
  }

  config() {
    return { weekendRest: true, morning: true, ...(this.settings.get('growth') || {}) };
  }

  logDay(g, fn, day = dayKey()) {
    const entry = g.log[day] || {};
    fn(entry);
    g.log[day] = entry;
    const keys = Object.keys(g.log).sort();
    while (keys.length > KEEP_LOG_DAYS) delete g.log[keys.shift()];
  }

  // 加 ✦：同时算累计和等级，升级了记一笔、发事件
  addStars(g, n) {
    if (!n) return;
    const before = cat.levelFor(g.earned);
    g.stars += n;
    g.earned += n;
    this.logDay(g, (e) => { e.stars = (e.stars || 0) + n; });
    const after = cat.levelFor(g.earned);
    if (after > before) {
      this.logDay(g, (e) => { e.levelups = [...(e.levelups || []), after]; });
      this.pending.push({ type: 'levelup', level: after });
    }
  }

  // ================= 启动 =================
  start() {
    const stored = this.data.get('growth');
    if (!stored || stored.version !== 3) {
      const { g, skin } = migrate(stored || {}, this.data.get('progress') || {});
      this.data.set({ growth: g }, { quiet: true });
      // 皮肤和帽子一样放进衣柜设置（settings.outfit）
      if (skin && g.owned.includes(skin)) this.settings.set({ outfit: { ...(this.settings.get('outfit') || {}), skin } }, { quiet: true });
    }
    this.ensureDay();
    const g = this.raw();
    if (!g.welcomed) {
      g.welcomed = true;
      this.save(g);
      this.emit('event', { type: 'welcome', upgraded: !!g.migratedFrom });
    }
    this.check();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.ensureDay(), 30000);
    // 每日统计变了（喝水、活动、专注、Claude Code）就看看环有没有合上
    this.data.on('change', (keys) => { if (keys.includes('days')) this.queueCheck(); });
    this.settings.on('change', (keys) => { if (keys.includes('waterGoal') || keys.includes('care')) this.queueCheck(); });
  }

  stop() {
    clearInterval(this.timer);
  }

  queueCheck() {
    if (this.checkQueued) return;
    this.checkQueued = true;
    setImmediate(() => {
      this.checkQueued = false;
      this.check();
    });
  }

  // ================= 新的一天 =================
  ensureDay() {
    const today = dayKey();
    const g = this.raw();
    if (g.today.day === today) return g;
    g.dayNote = this.settleStreak(g, today);
    g.yesterday = g.today.day ? { day: g.today.day, closed: g.today.closed.length, all: g.today.all } : null;
    g.today = blankToday(today);
    this.save(g);
    this.emit('event', { type: 'newday', day: today });
    return g;
  }

  // 结算没打卡的日子：周末休息（可关）→ 补签卡 → 断签
  settleStreak(g, today) {
    const s = g.streak;
    if (!s.through || s.count <= 0 || s.through >= addDays(today, -1)) return null;
    const missed = daysBetween(s.through, today);
    const rest = this.config().weekendRest;
    const need = missed.filter((d) => !(rest && isWeekend(d))).length;
    s.through = addDays(today, -1);
    if (need === 0) return null;
    if (need <= s.freezes) {
      s.freezes -= need;
      return { kind: 'freeze', used: need, streak: s.count, left: s.freezes };
    }
    const was = s.count;
    s.count = 0;
    return { kind: 'broken', was };
  }

  // ================= 今日三环 =================
  rings(day = this.stats.today()) {
    const st = this.settings.all();
    const g = this.raw();
    return cat.RINGS.map((r) => {
      const goal = Math.max(1, r.goal(st));
      const value = r.value(day);
      return { id: r.id, icon: r.icon, name: r.name, unit: r.unit, how: r.how, value, goal, closed: g.today.closed.includes(r.id) || value >= goal };
    });
  }

  // 统计变了之后：合环、打卡、三环全满、里程碑解锁
  check() {
    const g = this.ensureDay();
    this.pending = [];
    const before = JSON.stringify(g);
    const st = this.settings.all();
    const day = this.stats.today();
    for (const r of cat.RINGS) {
      if (g.today.closed.includes(r.id) || r.value(day) < Math.max(1, r.goal(st))) continue;
      g.today.closed.push(r.id);
      g.totals.rings += 1;
      this.addStars(g, cat.RING_STARS);
      this.logDay(g, (e) => { e.rings = g.today.closed.length; });
      this.pending.push({ type: 'ring', id: r.id, icon: r.icon, name: r.name, stars: cat.RING_STARS, closed: g.today.closed.length });
    }
    if (!g.today.checkin && g.today.closed.length >= cat.CHECKIN_RINGS) this.checkin(g);
    if (!g.today.all && g.today.closed.length >= cat.RINGS.length) {
      g.today.all = true;
      this.addStars(g, cat.ALL_RINGS_BONUS);
      this.logDay(g, (e) => { e.all = true; });
      this.pending.push({ type: 'allrings', stars: cat.ALL_RINGS_BONUS });
    }
    this.checkUnlocks(g);
    const events = this.pending;
    this.pending = [];
    if (JSON.stringify(g) !== before) this.save(g);
    events.forEach((ev) => this.emit('event', ev));
  }

  checkin(g) {
    const today = g.today.day;
    const s = g.streak;
    g.today.checkin = true;
    if (s.through === today) return;
    // 换日时已经结算过：没断的话 through 是昨天
    s.count = s.count > 0 && s.through >= addDays(today, -1) ? s.count + 1 : 1;
    s.through = today;
    s.best = Math.max(s.best, s.count);
    g.totals.checkins += 1;
    this.logDay(g, (e) => { e.checkin = true; e.streak = s.count; });
    const ev = { type: 'checkin', streak: s.count };
    if (s.count % cat.FREEZE_EVERY === 0 && s.freezes < cat.MAX_FREEZES) {
      s.freezes += 1;
      ev.freeze = true;
    }
    const m = cat.STREAK_MILESTONES[s.count];
    if (m) {
      this.addStars(g, m);
      ev.milestone = { days: s.count, stars: m };
    }
    this.pending.push(ev);
  }

  // 累计数据（里程碑用）
  lifetime(g = this.raw()) {
    const days = this.data.get('days') || {};
    let focus = 0;
    for (const d of Object.values(days)) focus += (d.focusMinutes || 0) + Math.round((d.ccSeconds || 0) / 60);
    return {
      level: cat.levelFor(g.earned),
      streak: g.streak.best,
      rings: g.totals.rings,
      checkins: g.totals.checkins,
      focus,
    };
  }

  checkUnlocks(g) {
    const life = this.lifetime(g);
    for (const item of cat.WARDROBE) {
      if (!item.unlock || g.owned.includes(item.id)) continue;
      if ((life[item.unlock.kind] || 0) < item.unlock.n) continue;
      g.owned.push(item.id);
      this.logDay(g, (e) => { e.unlocked = [...(e.unlocked || []), item.id]; });
      this.pending.push({ type: 'unlock', id: item.id, name: item.name, why: item.unlock.text });
    }
  }

  // ================= 衣柜 =================
  owned() {
    const g = this.raw();
    return [...new Set(['classic', ...g.owned])];
  }

  buy(id) {
    const item = cat.ITEM[id];
    if (!item) return { error: '没有这件' };
    const g = this.raw();
    if (item.free || g.owned.includes(id)) return { error: '已经有了' };
    if (!item.price) return { error: item.unlock ? `${item.unlock.text}解锁` : item.festival ? '节日当天自动收下' : '买不了' };
    if (g.stars < item.price) return { error: `✦ 不够，还差 ${item.price - g.stars}` };
    g.stars -= item.price;
    g.owned.push(id);
    this.save(g);
    return { ok: true, slot: item.slot };
  }

  // 节日帽：遇到过就永久收下
  collect(id) {
    const g = this.raw();
    if (!cat.ITEM[id] || g.owned.includes(id)) return false;
    g.owned.push(id);
    this.save(g);
    return true;
  }

  // ================= 心情 =================
  // 由今天的三环决定：跟得上进度就开心；下午了还几乎没动就有点闷；早上不会不开心
  mood(now = new Date()) {
    const rings = this.rings();
    const p = rings.reduce((a, r) => a + Math.min(1, r.value / r.goal), 0) / rings.length;
    const closed = rings.filter((r) => r.closed).length;
    const h = now.getHours() + now.getMinutes() / 60;
    const expected = Math.max(0, Math.min(1, (h - 9) / 12)); // 9 点到 21 点
    if (closed >= cat.CHECKIN_RINGS || p >= expected + 0.15) return 90;
    if (h >= 15 && p < expected - 0.35) return 25;
    return 65;
  }

  // ================= 早安 / 晚间 =================
  morning() {
    const g = this.ensureDay();
    if (g.today.announced) return null;
    g.today.announced = true;
    const note = g.dayNote || null;
    g.dayNote = null;
    this.save(g, { quiet: true });
    if (!this.config().morning) return null;
    return { type: 'morning', streak: this.liveStreak(g), yesterday: g.yesterday || null, note };
  }

  // 晚上 8 点到 11 点还没打卡：提醒一次，说说离哪个环最近
  evening(hour = new Date().getHours()) {
    if (hour < 20 || hour >= 23 || !this.config().morning) return null;
    const g = this.ensureDay();
    if (g.today.checkin || g.today.nudged) return null;
    g.today.nudged = true;
    this.save(g, { quiet: true });
    const open = this.rings().filter((r) => !r.closed).sort((a, b) => b.value / b.goal - a.value / a.goal);
    const near = open[0];
    return {
      type: 'evening',
      need: cat.CHECKIN_RINGS - g.today.closed.length,
      near: near ? { name: near.name, icon: near.icon, left: near.goal - near.value, unit: near.unit } : null,
      streak: this.liveStreak(g),
    };
  }

  // 现在的连续天数：今天还没打卡也不算断（明天才结算）
  liveStreak(g = this.raw()) {
    const s = g.streak;
    if (!s.count || !s.through) return 0;
    return s.through >= addDays(dayKey(), -1) ? s.count : 0;
  }

  // ================= 给界面看的 =================
  // 小人用（随设置一起发过去）
  summary() {
    const g = this.raw();
    return {
      stars: g.stars,
      level: cat.levelFor(g.earned),
      streak: this.liveStreak(g),
      checkedToday: g.today.checkin,
      rings: this.rings().map((r) => ({ id: r.id, icon: r.icon, name: r.name, unit: r.unit, value: r.value, goal: r.goal, closed: r.closed })),
    };
  }

  calendar(n = 14) {
    const g = this.raw();
    const today = dayKey();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const e = g.log[d] || {};
      out.push({ day: d, checkin: !!e.checkin, all: !!e.all, rings: e.rings || 0, weekend: isWeekend(d), today: d === today });
    }
    return out;
  }

  // 衣柜：每件东西的状态
  wardrobe(g = this.raw()) {
    const life = this.lifetime(g);
    return cat.WARDROBE.map((x) => {
      const out = { id: x.id, slot: x.slot, name: x.name, owned: !!x.free || g.owned.includes(x.id) };
      if (x.price) out.price = x.price;
      if (x.festival) { out.festival = true; out.how = '节日当天收下'; }
      if (x.unlock) {
        out.how = x.unlock.text;
        out.progress = [Math.min(life[x.unlock.kind] || 0, x.unlock.n), x.unlock.n];
      }
      return out;
    });
  }

  view() {
    const g = this.ensureDay();
    const level = cat.levelFor(g.earned);
    const live = this.liveStreak(g);
    const next = Object.keys(cat.STREAK_MILESTONES).map(Number).find((d) => d > live) || null;
    return {
      stars: g.stars,
      earned: g.earned,
      level,
      levelFrom: cat.starsForLevel(level),
      levelTo: cat.starsForLevel(level + 1),
      rings: this.rings(),
      closed: g.today.closed.length,
      checkinRings: cat.CHECKIN_RINGS,
      ringStars: cat.RING_STARS,
      allBonus: cat.ALL_RINGS_BONUS,
      streak: {
        count: live,
        best: g.streak.best,
        freezes: g.streak.freezes,
        maxFreezes: cat.MAX_FREEZES,
        checkedToday: g.today.checkin,
        next,
        nextStars: next ? cat.STREAK_MILESTONES[next] : 0,
      },
      calendar: this.calendar(14),
      milestones: cat.STREAK_MILESTONES,
      wardrobe: this.wardrobe(g),
      mood: this.mood(),
      config: this.config(),
    };
  }

  log() {
    return this.raw().log;
  }
}

module.exports = { Growth, migrate, addDays, isWeekend, daysBetween };
