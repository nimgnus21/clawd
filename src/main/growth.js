// 成长 2.0：星星、每日任务、连续打卡、成就、小卖部、每日礼物、日记素材
// 所有“发生了一件事”都走 record(kind, amount)，这里统一加经验、记累计、检查任务和成就
const EventEmitter = require('events');
const { dayKey } = require('./config');
const cat = require('./growth-catalog');

const KEEP_LOG_DAYS = 60;
const TOTAL_KEYS = ['water', 'sit', 'eye', 'todo', 'focus', 'cc', 'pet', 'dance', 'feed', 'gift', 'quests', 'chests'];
// 这些事情的“今天次数”记在每日统计里（任务进度要用）；喝水等其他字段由各自的模块记
const STAT_FIELD = { pet: 'pets', dance: 'dances', feed: 'feeds', gift: 'gifts' };
const SNACK_WEIGHTS = { cookie: 40, fish: 30, pudding: 20, cake: 10 };
const WELCOME = { stars: 50, snack: 'cookie' };

// ---------- 日期小工具（都用本地时间的 'YYYY-MM-DD'） ----------
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

function blank() {
  return {
    stars: 0,
    starsEarned: 0,
    totals: Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])),
    skins: ['classic'],
    skin: 'classic',
    snacks: {},
    streak: { count: 0, best: 0, through: '', freezes: 0 },
    achievements: {},
    flags: {},
    quests: { day: '', list: [], done: [], chest: false, checkin: false, announced: false },
    gift: { day: '', at: 0, state: '' },
    log: {},
    pendingNotes: [],
    welcomed: false,
    seeded: false,
  };
}

class Growth extends EventEmitter {
  // deps: { data, settings, stats, progress, ccOn: () => bool }
  constructor({ data, settings, stats, progress, ccOn }) {
    super();
    this.data = data;
    this.settings = settings;
    this.stats = stats;
    this.progress = progress;
    this.ccOn = ccOn || (() => false);
    this.rng = Math.random; // 测试时可以换成固定的
    this.giftBlocked = () => false; // 勿扰、小人藏起来时不出礼物
    this.timer = null;
    this.checkQueued = false;
  }

  // ================= 存取 =================
  raw() {
    const b = blank();
    const g = { ...b, ...(this.data.get('growth') || {}) };
    g.totals = { ...b.totals, ...(g.totals || {}) };
    g.streak = { ...b.streak, ...(g.streak || {}) };
    g.quests = { ...b.quests, ...(g.quests || {}) };
    g.gift = { ...b.gift, ...(g.gift || {}) };
    return g;
  }

  save(g, opts) {
    this.data.set({ growth: g }, opts);
    this.emit('change');
  }

  config() {
    return { weekendRest: true, morning: true, gift: true, ...(this.settings.get('growth') || {}) };
  }

  // 今天的日记素材
  logDay(g, fn, day = dayKey()) {
    const entry = g.log[day] || {};
    fn(entry);
    g.log[day] = entry;
    const keys = Object.keys(g.log).sort();
    while (keys.length > KEEP_LOG_DAYS) delete g.log[keys.shift()];
  }

  addStars(g, n, why) {
    g.stars += n;
    g.starsEarned = (g.starsEarned || 0) + n;
    this.logDay(g, (e) => { e.stars = (e.stars || 0) + n; });
    return why;
  }

  // ================= 启动 =================
  start() {
    let g = this.raw();
    // 老用户：从以前的每日统计里算出累计数据，已经达成的成就直接给（不一个个庆祝）
    if (!g.seeded) {
      const days = this.data.get('days') || {};
      const sum = (f) => Object.values(days).reduce((a, d) => a + ((d && d[f]) || 0), 0);
      g.totals.water = Math.max(g.totals.water, sum('water'));
      g.totals.sit = Math.max(g.totals.sit, sum('sitBreaks'));
      g.totals.eye = Math.max(g.totals.eye, sum('eyeBreaks'));
      g.totals.todo = Math.max(g.totals.todo, sum('todosDone'));
      g.totals.focus = Math.max(g.totals.focus, sum('focusMinutes'));
      g.totals.cc = Math.max(g.totals.cc, sum('ccTasks'));
      g.seeded = true;
      this.data.set({ growth: g }, { quiet: true });
    }
    g = this.ensureDay();
    if (!g.welcomed) {
      g = this.raw();
      const got = this.checkAchievements(g, { quiet: true });
      g.welcomed = true;
      this.addStars(g, WELCOME.stars);
      g.snacks[WELCOME.snack] = (g.snacks[WELCOME.snack] || 0) + 1;
      this.save(g);
      this.emitEvent({ type: 'welcome', stars: WELCOME.stars, snack: WELCOME.snack, achievements: got.length, achievementStars: got.reduce((a, x) => a + x.stars, 0) });
    } else {
      this.check();
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 30000);
    // 每日统计变了（喝水、待办、Claude Code…）就看看任务有没有完成
    this.data.on('change', (keys) => { if (keys.includes('days')) this.queueCheck(); });
  }

  stop() {
    clearInterval(this.timer);
  }

  tick() {
    this.ensureDay();
    this.maybeShowGift();
  }

  queueCheck() {
    if (this.checkQueued) return;
    this.checkQueued = true;
    setImmediate(() => {
      this.checkQueued = false;
      this.check();
    });
  }

  emitEvent(ev) {
    this.emit('event', ev);
  }

  // ================= 新的一天 =================
  // 换日：结算没打卡的日子（周末休息 / 补签卡 / 断签），生成今天的任务和礼物时间
  ensureDay() {
    const today = dayKey();
    const g = this.raw();
    if (g.quests.day === today) return g;
    const note = this.settleStreak(g, today);
    // 昨天的礼物没拆就过期了：小人那边收起来
    if (g.gift.state === 'shown') this.emit('gift', { show: false, quiet: true });
    g.quests = { day: today, list: this.rollQuests(today), done: [], chest: false, checkin: false, announced: false };
    g.gift = { day: today, at: this.giftTime(today), state: 'waiting' };
    g.dayNote = note; // 早安播报时说（断签、用了补签卡）
    this.save(g);
    this.emitEvent({ type: 'newday', day: today });
    return g;
  }

  settleStreak(g, today) {
    const s = g.streak;
    if (!s.through || s.count <= 0 || s.through >= today) return null;
    const yesterday = addDays(today, -1);
    if (s.through >= yesterday) return null;
    const missed = daysBetween(s.through, today);
    const rest = this.config().weekendRest;
    const need = missed.filter((d) => !(rest && isWeekend(d))).length;
    s.through = yesterday;
    if (need === 0) return null;
    if (need <= s.freezes) {
      s.freezes -= need;
      return { kind: 'freeze', used: need, streak: s.count, left: s.freezes };
    }
    const was = s.count;
    s.count = 0;
    return { kind: 'broken', was };
  }

  // 今天的三个任务：按日期固定（同一天怎么算都一样）
  rollQuests(day) {
    const rnd = cat.seededRandom(`quests:${day}`);
    const st = this.settings.all();
    const rem = st.reminders || {};
    const ctx = {
      waterGoal: st.waterGoal || 8,
      sitOn: (rem.sit || 0) > 0,
      eyeOn: (rem.eye || 0) > 0,
      ccOn: this.ccOn(),
    };
    return ['health', 'work', 'fun'].map((group) => {
      const pool = cat.QUEST_POOL[group].filter((q) => !q.when || q.when(ctx));
      const q = cat.pickOne(rnd, pool);
      const target = cat.pickOne(rnd, q.targets(ctx));
      return { id: q.id, group, field: q.field, target, title: q.title(target) };
    });
  }

  favoriteSnack(day = dayKey()) {
    const rnd = cat.seededRandom(`fav:${day}`);
    return cat.pickOne(rnd, cat.SNACKS).id;
  }

  // ================= 记录一件事 =================
  // kind: water | sit | eye | todo | focus（amount = 分钟） | cc | pet | dance | feed | gift | festival
  record(kind, amount = 1, meta = {}) {
    this.ensureDay();
    if (STAT_FIELD[kind]) this.stats.add(STAT_FIELD[kind], amount);
    if (kind !== 'feed' && kind !== 'gift') this.progress.gain(kind === 'dance' ? 'dance' : kind, amount);
    const g = this.raw();
    if (kind in g.totals) g.totals[kind] += amount;
    // 隐藏成就的条件
    const h = new Date().getHours();
    if (h >= 1 && h < 4 && ['water', 'sit', 'eye', 'todo', 'focus', 'cc', 'pet', 'dance', 'feed'].includes(kind)) g.flags.nightowl = true;
    if (kind === 'water' && h >= 4 && h < 7) g.flags.earlybird = true;
    if (kind === 'festival' && meta.birthday) g.flags.birthday = true;
    this.data.set({ growth: g }, { quiet: true });
    this.check();
  }

  // ================= 检查：任务、打卡、宝箱、成就 =================
  check() {
    const g = this.ensureDay();
    const before = JSON.stringify(g);
    this.checkQuests(g);
    this.checkAchievements(g);
    if (JSON.stringify(g) !== before) this.save(g);
  }

  questProgress(g = this.raw()) {
    const today = this.stats.today();
    return g.quests.list.map((q) => ({
      ...q,
      have: Math.min(q.target, today[q.field] || 0),
      done: g.quests.done.includes(q.id),
    }));
  }

  checkQuests(g) {
    const today = this.stats.today();
    for (const q of g.quests.list) {
      if (g.quests.done.includes(q.id) || (today[q.field] || 0) < q.target) continue;
      g.quests.done.push(q.id);
      g.totals.quests += 1;
      this.addStars(g, cat.QUEST_REWARD.stars);
      this.progress.bonus(cat.QUEST_REWARD.xp, 3);
      this.logDay(g, (e) => { e.quests = (e.quests || 0) + 1; });
      this.emitEvent({ type: 'quest', title: q.title, stars: cat.QUEST_REWARD.stars, xp: cat.QUEST_REWARD.xp, left: g.quests.list.length - g.quests.done.length });
    }
    if (!g.quests.checkin && g.quests.done.length >= cat.CHECKIN_QUESTS) this.checkin(g);
    if (!g.quests.chest && g.quests.list.length && g.quests.done.length >= g.quests.list.length) {
      g.quests.chest = true;
      g.totals.chests += 1;
      this.addStars(g, cat.CHEST_REWARD.stars);
      const snack = this.randomSnack();
      g.snacks[snack] = (g.snacks[snack] || 0) + 1;
      if (isWeekend(g.quests.day)) g.flags.weekend = true;
      this.logDay(g, (e) => { e.chest = true; });
      this.emitEvent({ type: 'chest', stars: cat.CHEST_REWARD.stars, snack });
    }
    // 完美的一天：喝够水 + 任务全完成 + 专注 1 小时
    if (!g.flags.perfect && g.quests.chest && (today.water || 0) >= (this.settings.get('waterGoal') || 8) && (today.focusMinutes || 0) >= 60) {
      g.flags.perfect = true;
    }
  }

  checkin(g) {
    const today = g.quests.day;
    const s = g.streak;
    g.quests.checkin = true;
    if (s.through === today) return;
    // 换日时已经结算过：没断的话 through 是昨天
    s.count = s.count > 0 && s.through >= addDays(today, -1) ? s.count + 1 : 1;
    s.through = today;
    s.best = Math.max(s.best, s.count);
    this.logDay(g, (e) => { e.checkin = true; e.streak = s.count; });
    const ev = { type: 'checkin', streak: s.count };
    // 每满 7 天送一张补签卡
    if (s.count % 7 === 0 && s.freezes < cat.MAX_FREEZES) {
      s.freezes += 1;
      ev.freeze = true;
    }
    const m = cat.STREAK_MILESTONES[s.count];
    if (m) {
      this.addStars(g, m.stars);
      ev.milestone = { days: s.count, stars: m.stars };
      if (m.skin && !g.skins.includes(m.skin)) {
        g.skins.push(m.skin);
        ev.milestone.skin = m.skin;
      }
    }
    this.emitEvent(ev);
  }

  achievementCtx(g) {
    const unlocked = this.progress.status().unlocked;
    return {
      totals: g.totals,
      streakBest: g.streak.best,
      level: this.progress.status().level,
      festivalHats: unlocked.filter((id) => cat.FESTIVAL_HATS.includes(id)).length,
      ownedCount: unlocked.length + g.skins.filter((s) => s !== 'classic').length,
      flags: g.flags,
    };
  }

  checkAchievements(g, { quiet = false } = {}) {
    const got = [];
    // 拿到成就会加星星、可能解锁皮肤，进而影响别的成就：多跑几轮
    for (let round = 0; round < 3; round++) {
      const ctx = this.achievementCtx(g);
      let any = false;
      for (const a of cat.ACHIEVEMENTS) {
        if (g.achievements[a.id] || !a.check(ctx)) continue;
        g.achievements[a.id] = Date.now();
        this.addStars(g, a.stars);
        this.logDay(g, (e) => { e.achievements = [...(e.achievements || []), a.id]; });
        got.push(a);
        any = true;
        if (!quiet) this.emitEvent({ type: 'achievement', id: a.id, icon: a.icon, name: a.name, desc: a.desc, stars: a.stars });
      }
      const count = Object.keys(g.achievements).length;
      if (count >= cat.GALAXY_ACHIEVEMENTS && !g.skins.includes('galaxy')) {
        g.skins.push('galaxy');
        if (!quiet) this.emitEvent({ type: 'skin', id: 'galaxy', name: '星空', why: `解锁了 ${cat.GALAXY_ACHIEVEMENTS} 个成就` });
        any = true;
      }
      if (g.streak.best >= 30 && !g.skins.includes('gold')) {
        g.skins.push('gold');
        any = true;
      }
      if (!any) break;
    }
    return got;
  }

  // ================= 小卖部 =================
  buy(kind, id) {
    const g = this.raw();
    if (kind === 'snack') {
      const s = cat.SNACKS.find((x) => x.id === id);
      if (!s) return { error: '没有这个零食' };
      if (g.stars < s.price) return { error: `星星不够（还差 ${s.price - g.stars}✦）` };
      g.stars -= s.price;
      g.snacks[id] = (g.snacks[id] || 0) + 1;
      this.save(g);
      return { ok: true, have: g.snacks[id] };
    }
    if (kind === 'skin') {
      const s = cat.SKINS.find((x) => x.id === id);
      if (!s || !s.price) return { error: s && s.unlock ? `${s.unlock}解锁` : '这个买不了' };
      if (g.skins.includes(id)) return { error: '已经有了' };
      if (g.stars < s.price) return { error: `星星不够（还差 ${s.price - g.stars}✦）` };
      g.stars -= s.price;
      g.skins.push(id);
      g.skin = id;
      this.checkAchievements(g);
      this.save(g);
      this.emitEvent({ type: 'bought', kind, id, name: s.name });
      return { ok: true };
    }
    if (kind === 'item') {
      const s = cat.SHOP_ITEMS.find((x) => x.id === id);
      if (!s) return { error: '没有这件' };
      if (this.progress.status().unlocked.includes(id)) return { error: '已经有了' };
      if (g.stars < s.price) return { error: `星星不够（还差 ${s.price - g.stars}✦）` };
      g.stars -= s.price;
      this.data.set({ growth: g }, { quiet: true });
      this.progress.collect(id);
      const g2 = this.raw();
      this.checkAchievements(g2);
      this.save(g2);
      this.emitEvent({ type: 'bought', kind, id, name: s.name });
      return { ok: true };
    }
    return { error: 'unknown' };
  }

  setSkin(id) {
    const g = this.raw();
    if (!g.skins.includes(id)) return { error: '这个皮肤还没有' };
    g.skin = id;
    this.save(g);
    return { ok: true };
  }

  // 喂零食：心情 +，今天的最爱心情翻倍
  feed(id) {
    const s = cat.SNACKS.find((x) => x.id === id);
    if (!s) return { error: '没有这个零食' };
    const g = this.raw();
    if (!(g.snacks[id] > 0)) return { error: `没有${s.name}了，去小卖部买一些吧` };
    g.snacks[id] -= 1;
    const favorite = this.favoriteSnack() === id;
    this.logDay(g, (e) => { e.feeds = [...(e.feeds || []), id]; });
    this.data.set({ growth: g }, { quiet: true });
    this.progress.bonus(3, s.mood * (favorite ? 2 : 1));
    this.emitEvent({ type: 'feed', id, name: s.name, emoji: s.emoji, favorite });
    this.record('feed');
    return { ok: true, favorite, left: g.snacks[id] };
  }

  randomSnack() {
    const total = Object.values(SNACK_WEIGHTS).reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (const [id, w] of Object.entries(SNACK_WEIGHTS)) {
      r -= w;
      if (r < 0) return id;
    }
    return 'cookie';
  }

  // ================= 每日礼物 =================
  // 每天 10:00~16:30 之间某个固定时间出现；开着电脑晚了就开机后几分钟出现
  giftTime(day) {
    const rnd = cat.seededRandom(`gift:${day}`);
    const d = parseDay(day);
    d.setHours(10, 0, 0, 0);
    let at = d.getTime() + Math.floor(rnd() * 390) * 60000;
    const soon = Date.now() + (3 + Math.floor(this.rng() * 6)) * 60000;
    if (day === dayKey() && at < soon) at = soon;
    return at;
  }

  maybeShowGift(force = false) {
    if (!this.config().gift && !force) return false;
    const g = this.raw();
    if (g.gift.day !== dayKey() || g.gift.state !== 'waiting') return false;
    if (!force && (Date.now() < g.gift.at || this.giftBlocked())) return false;
    g.gift.state = 'shown';
    this.save(g);
    this.emit('gift', { show: true });
    return true;
  }

  giftShowing() {
    const g = this.raw();
    return g.gift.day === dayKey() && g.gift.state === 'shown';
  }

  openGift() {
    const g = this.raw();
    if (g.gift.day !== dayKey() || g.gift.state !== 'shown') return { error: '今天的礼物已经拆过了' };
    g.gift.state = 'opened';
    const roll = this.rng();
    const slot = cat.GIFT_TABLE.find((x) => roll < x.p) || cat.GIFT_TABLE[0];
    let reward;
    if (slot.kind === 'snack') {
      const id = this.randomSnack();
      g.snacks[id] = (g.snacks[id] || 0) + 1;
      const s = cat.SNACKS.find((x) => x.id === id);
      reward = { kind: 'snack', id, text: `${s.emoji} ${s.name}` };
    } else if (slot.kind === 'item') {
      const owned = this.progress.status().unlocked;
      const left = cat.SHOP_ITEMS.filter((x) => !owned.includes(x.id));
      if (left.length) {
        const it = left[Math.floor(this.rng() * left.length)];
        reward = { kind: 'item', id: it.id, text: `稀有配饰「${it.name}」` };
      } else {
        this.addStars(g, 80);
        reward = { kind: 'stars', n: 80, text: '80✦' };
      }
    } else if (slot.kind === 'freeze' && g.streak.freezes < cat.MAX_FREEZES) {
      g.streak.freezes += 1;
      reward = { kind: 'freeze', text: '一张补签卡 🎫' };
    } else {
      const n = slot.kind === 'stars' ? slot.min + Math.floor(this.rng() * (slot.max - slot.min + 1)) : 40;
      this.addStars(g, n);
      reward = { kind: 'stars', n, text: `${n}✦` };
    }
    this.logDay(g, (e) => { e.gift = reward.text; });
    this.data.set({ growth: g }, { quiet: true });
    if (reward.kind === 'item') this.progress.collect(reward.id);
    this.progress.bonus(5, 5);
    this.emit('gift', { show: false });
    this.emitEvent({ type: 'gift', reward });
    this.record('gift');
    return { ok: true, reward };
  }

  // ================= 早安播报 =================
  // 每天第一次见面：今天的任务、连续打卡情况（断签了温柔一点）
  morning() {
    const g = this.ensureDay();
    if (g.quests.announced) return null;
    g.quests.announced = true;
    const note = g.dayNote || null;
    g.dayNote = null;
    this.save(g, { quiet: true });
    if (!this.config().morning) return null;
    return {
      type: 'morning',
      quests: g.quests.list.map((q) => q.title),
      streak: this.liveStreak(g),
      favorite: this.favoriteSnack(),
      note,
    };
  }

  // 现在的连续天数：今天还没打卡也不算断（明天才结算）
  liveStreak(g = this.raw()) {
    const s = g.streak;
    if (!s.count || !s.through) return 0;
    const today = dayKey();
    if (s.through >= addDays(today, -1)) return s.count;
    return 0;
  }

  // ================= 给界面看的 =================
  summary() {
    const g = this.raw();
    return {
      stars: g.stars,
      streak: this.liveStreak(g),
      checkedToday: g.quests.checkin,
      skin: g.skins.includes(g.skin) ? g.skin : 'classic',
      gift: this.giftShowing(),
      snacks: g.snacks,
    };
  }

  achievementsView(g = this.raw()) {
    const ctx = this.achievementCtx(g);
    return cat.ACHIEVEMENTS.map((a) => {
      const at = g.achievements[a.id] || 0;
      const secret = a.hidden && !at;
      const goal = a.goal ? a.goal(ctx) : null;
      return {
        id: a.id,
        icon: secret ? '❔' : a.icon,
        name: secret ? '？？？' : a.name,
        desc: secret ? '隐藏成就，碰巧做到就会解锁' : a.desc,
        stars: a.stars,
        at,
        hidden: !!a.hidden,
        progress: goal && !at ? [Math.min(goal[0], goal[1]), goal[1]] : null,
      };
    });
  }

  // 最近 n 天的打卡情况（日历条用）
  calendar(n = 14) {
    const g = this.raw();
    const today = dayKey();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const e = g.log[d] || {};
      out.push({ day: d, checkin: !!e.checkin, chest: !!e.chest, weekend: isWeekend(d), today: d === today });
    }
    return out;
  }

  view() {
    const g = this.ensureDay();
    const owned = this.progress.status().unlocked;
    const nextMilestone = Object.keys(cat.STREAK_MILESTONES).map(Number).find((d) => d > this.liveStreak(g)) || null;
    return {
      stars: g.stars,
      starsEarned: g.starsEarned || 0,
      totals: g.totals,
      streak: {
        count: this.liveStreak(g),
        best: g.streak.best,
        freezes: g.streak.freezes,
        maxFreezes: cat.MAX_FREEZES,
        checkedToday: g.quests.checkin,
        next: nextMilestone,
        nextReward: nextMilestone ? cat.STREAK_MILESTONES[nextMilestone] : null,
      },
      quests: this.questProgress(g),
      questReward: cat.QUEST_REWARD,
      chestReward: cat.CHEST_REWARD,
      checkinNeed: cat.CHECKIN_QUESTS,
      chest: g.quests.chest,
      calendar: this.calendar(14),
      favorite: this.favoriteSnack(),
      snacks: cat.SNACKS.map((s) => ({ ...s, have: g.snacks[s.id] || 0 })),
      skins: cat.SKINS.map((s) => ({ ...s, owned: g.skins.includes(s.id) })),
      skin: g.skins.includes(g.skin) ? g.skin : 'classic',
      shopItems: cat.SHOP_ITEMS.map((s) => ({ ...s, owned: owned.includes(s.id) })),
      achievements: this.achievementsView(g),
      achievementCount: Object.keys(g.achievements).length,
      galaxyNeed: cat.GALAXY_ACHIEVEMENTS,
      milestones: cat.STREAK_MILESTONES,
      gift: g.gift.day === dayKey() ? g.gift.state : '',
      config: this.config(),
    };
  }

  log() {
    return this.raw().log;
  }

  // 日记里记一笔升级
  noteLevelup(level) {
    const g = this.raw();
    this.logDay(g, (e) => { e.levelups = [...(e.levelups || []), level]; });
    this.data.set({ growth: g }, { quiet: true });
  }
}

module.exports = { Growth, addDays, isWeekend, daysBetween };
