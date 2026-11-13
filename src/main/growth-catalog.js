// 成长系统的所有“配置”：每日任务、连续打卡奖励、成就、小卖部商品
// 想调数值（价格、奖励、目标）改这里就行

// ---------- 小工具：按字符串固定的随机数（同一天每次算出来都一样） ----------
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let a = typeof seed === 'number' ? seed : hashString(String(seed));
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOne = (rnd, list) => list[Math.floor(rnd() * list.length)];

// ---------- 每日任务 ----------
// 每天三类各挑一个：身体 / 做事 / 陪伴。field = 今天统计里的字段
const QUEST_POOL = {
  health: [
    { id: 'water', field: 'water', targets: (ctx) => [Math.min(ctx.waterGoal, 5), Math.min(ctx.waterGoal, 6)], title: (n) => `喝 ${n} 杯水` },
    { id: 'sit', field: 'sitBreaks', targets: () => [2, 3], title: (n) => `起来活动 ${n} 次`, when: (ctx) => ctx.sitOn },
    { id: 'eye', field: 'eyeBreaks', targets: () => [2, 3], title: (n) => `让眼睛休息 ${n} 次`, when: (ctx) => ctx.eyeOn },
  ],
  work: [
    { id: 'focus', field: 'focusMinutes', targets: () => [25, 45], title: (n) => `专注 ${n} 分钟` },
    { id: 'todo', field: 'todosDone', targets: () => [1, 2], title: (n) => `完成 ${n} 件待办` },
    { id: 'cc', field: 'ccTasks', targets: () => [2, 3], title: (n) => `让 Claude Code 完成 ${n} 个任务`, when: (ctx) => ctx.ccOn },
  ],
  fun: [
    { id: 'pet', field: 'pets', targets: () => [3, 5], title: (n) => `摸摸 Clawd ${n} 次` },
    { id: 'dance', field: 'dances', targets: () => [1, 2], title: (n) => (n > 1 ? `和 Clawd 跳 ${n} 支舞` : '和 Clawd 跳一支舞') },
    { id: 'feed', field: 'feeds', targets: () => [1], title: () => '喂 Clawd 吃一次零食' },
  ],
};

const QUEST_REWARD = { xp: 15, stars: 10 };
const CHEST_REWARD = { stars: 30 }; // 三个任务全部完成：再开一个宝箱（另外随机给零食）
const CHECKIN_QUESTS = 2; // 完成几个任务算今天打卡

// ---------- 连续打卡 ----------
// 到某一天给的奖励；每满 7 天额外送一张补签卡（最多存 2 张）
const STREAK_MILESTONES = {
  3: { stars: 30 },
  7: { stars: 70 },
  14: { stars: 140 },
  21: { stars: 210 },
  30: { stars: 300, skin: 'gold' },
  50: { stars: 500 },
  100: { stars: 1000 },
};
const MAX_FREEZES = 2;

// ---------- 小卖部 ----------
const SNACKS = [
  { id: 'cookie', name: '饼干', emoji: '🍪', price: 10, mood: 8 },
  { id: 'fish', name: '小鱼干', emoji: '🐟', price: 18, mood: 15 },
  { id: 'pudding', name: '布丁', emoji: '🍮', price: 30, mood: 25 },
  { id: 'cake', name: '蛋糕', emoji: '🍰', price: 50, mood: 40 },
];

// 皮肤：price 是星星；unlock 是另外的解锁条件（不能买）
const SKINS = [
  { id: 'classic', name: '经典橙', price: 0 },
  { id: 'mint', name: '薄荷绿', price: 200 },
  { id: 'lavender', name: '薰衣草', price: 200 },
  { id: 'sakura', name: '樱花粉', price: 260 },
  { id: 'ocean', name: '海盐蓝', price: 260 },
  { id: 'cocoa', name: '可可棕', price: 260 },
  { id: 'night', name: '夜幕', price: 360 },
  { id: 'gold', name: '金色传说', unlock: '连续打卡 30 天' },
  { id: 'galaxy', name: '星空', unlock: '解锁 10 个成就' },
];

// 小卖部配饰（帽子 / 脸上）；等级配饰在 progress.js 里
const SHOP_ITEMS = [
  { id: 'sprout', name: '头顶小草', price: 80 },
  { id: 'starclip', name: '星星发卡', price: 100 },
  { id: 'catears', name: '猫耳', price: 150 },
  { id: 'scarf', name: '红围巾', price: 180 },
  { id: 'halo', name: '天使光环', price: 260 },
  { id: 'horns', name: '小恶魔角', price: 260 },
];

const FESTIVAL_HATS = ['party', 'santa', 'witch', 'cny', 'bunny', 'heart'];

// ---------- 每日礼物 ----------
// roll 落在哪一段就给什么
const GIFT_TABLE = [
  { p: 0.55, kind: 'stars', min: 15, max: 40 },
  { p: 0.85, kind: 'snack' },
  { p: 0.95, kind: 'item' }, // 没有的小卖部配饰（都有了就换成星星）
  { p: 1.0, kind: 'freeze' }, // 补签卡（满了就换成星星）
];

// ---------- 成就 ----------
// check(ctx)：ctx = { totals, streakBest, level, achievementsCount, festivalHats, ownedCount, flags }
const ACHIEVEMENTS = [
  { id: 'water1', icon: '💧', name: '第一杯水', desc: '第一次和 Clawd 一起喝水', stars: 10, check: (c) => c.totals.water >= 1 },
  { id: 'water100', icon: '🚰', name: '补水达人', desc: '累计喝水 100 杯', stars: 50, check: (c) => c.totals.water >= 100, goal: (c) => [c.totals.water, 100] },
  { id: 'water500', icon: '🌊', name: '人形水桶', desc: '累计喝水 500 杯', stars: 150, check: (c) => c.totals.water >= 500, goal: (c) => [c.totals.water, 500] },
  { id: 'focus60', icon: '🎯', name: '专注新手', desc: '累计专注 60 分钟', stars: 20, check: (c) => c.totals.focus >= 60, goal: (c) => [c.totals.focus, 60] },
  { id: 'focus1000', icon: '🧘', name: '心流大师', desc: '累计专注 1000 分钟', stars: 120, check: (c) => c.totals.focus >= 1000, goal: (c) => [c.totals.focus, 1000] },
  { id: 'sit30', icon: '🚶', name: '拒绝久坐', desc: '累计起来活动 30 次', stars: 40, check: (c) => c.totals.sit >= 30, goal: (c) => [c.totals.sit, 30] },
  { id: 'eye50', icon: '👀', name: '护眼小卫士', desc: '累计让眼睛休息 50 次', stars: 40, check: (c) => c.totals.eye >= 50, goal: (c) => [c.totals.eye, 50] },
  { id: 'todo10', icon: '✅', name: '说到做到', desc: '完成 10 件待办', stars: 30, check: (c) => c.totals.todo >= 10, goal: (c) => [c.totals.todo, 10] },
  { id: 'todo100', icon: '📋', name: '清单杀手', desc: '完成 100 件待办', stars: 120, check: (c) => c.totals.todo >= 100, goal: (c) => [c.totals.todo, 100] },
  { id: 'cc10', icon: '🤝', name: 'Claude 搭档', desc: 'Claude Code 完成 10 个任务', stars: 30, check: (c) => c.totals.cc >= 10, goal: (c) => [c.totals.cc, 10] },
  { id: 'cc100', icon: '🚀', name: '代码二人组', desc: 'Claude Code 完成 100 个任务', stars: 120, check: (c) => c.totals.cc >= 100, goal: (c) => [c.totals.cc, 100] },
  { id: 'pet100', icon: '🫳', name: '摸头杀', desc: '摸了 Clawd 100 次', stars: 50, check: (c) => c.totals.pet >= 100, goal: (c) => [c.totals.pet, 100] },
  { id: 'streak3', icon: '🔥', name: '三天打鱼？才不', desc: '连续打卡 3 天', stars: 20, check: (c) => c.streakBest >= 3, goal: (c) => [c.streakBest, 3] },
  { id: 'streak7', icon: '📅', name: '一周不断', desc: '连续打卡 7 天', stars: 50, check: (c) => c.streakBest >= 7, goal: (c) => [c.streakBest, 7] },
  { id: 'streak30', icon: '🏅', name: '习惯养成', desc: '连续打卡 30 天', stars: 200, check: (c) => c.streakBest >= 30, goal: (c) => [c.streakBest, 30] },
  { id: 'level5', icon: '⭐', name: '小有所成', desc: '升到 Lv.5', stars: 50, check: (c) => c.level >= 5, goal: (c) => [c.level, 5] },
  { id: 'level10', icon: '👑', name: '王者 Clawd', desc: '升到 Lv.10', stars: 150, check: (c) => c.level >= 10, goal: (c) => [c.level, 10] },
  { id: 'quests30', icon: '📜', name: '任务达人', desc: '累计完成 30 个每日任务', stars: 60, check: (c) => c.totals.quests >= 30, goal: (c) => [c.totals.quests, 30] },
  { id: 'chest10', icon: '🧰', name: '宝箱猎人', desc: '打开 10 个每日宝箱', stars: 60, check: (c) => c.totals.chests >= 10, goal: (c) => [c.totals.chests, 10] },
  { id: 'feed1', icon: '🍪', name: '第一口零食', desc: '第一次喂 Clawd', stars: 10, check: (c) => c.totals.feed >= 1 },
  { id: 'feed30', icon: '🍰', name: '美食家', desc: '喂了 Clawd 30 次', stars: 60, check: (c) => c.totals.feed >= 30, goal: (c) => [c.totals.feed, 30] },
  { id: 'gift7', icon: '🎁', name: '拆礼物专家', desc: '拆开 7 个每日礼物', stars: 40, check: (c) => c.totals.gift >= 7, goal: (c) => [c.totals.gift, 7] },
  { id: 'collector', icon: '🎩', name: '节日收藏家', desc: '收集 3 顶节日帽', stars: 80, check: (c) => c.festivalHats >= 3, goal: (c) => [c.festivalHats, 3] },
  { id: 'fashion', icon: '👗', name: '时尚达人', desc: '拥有 5 件配饰或皮肤', stars: 50, check: (c) => c.ownedCount >= 5, goal: (c) => [c.ownedCount, 5] },
  // 隐藏成就：解锁前只显示“？？？”
  { id: 'nightowl', icon: '🦉', name: '夜猫子', desc: '凌晨 1 点到 4 点还在陪 Clawd', stars: 30, hidden: true, check: (c) => !!c.flags.nightowl },
  { id: 'earlybird', icon: '🐤', name: '早起鸟', desc: '早上 7 点前就喝了水', stars: 30, hidden: true, check: (c) => !!c.flags.earlybird },
  { id: 'weekend', icon: '🏖️', name: '周末也在线', desc: '周末完成了全部每日任务', stars: 40, hidden: true, check: (c) => !!c.flags.weekend },
  { id: 'dancer', icon: '🕺', name: '舞王', desc: '和 Clawd 跳了 30 支舞', stars: 50, hidden: true, check: (c) => c.totals.dance >= 30 },
  { id: 'birthday', icon: '🎂', name: '生日快乐', desc: '和 Clawd 一起过生日', stars: 100, hidden: true, check: (c) => !!c.flags.birthday },
  { id: 'perfect', icon: '🌈', name: '完美的一天', desc: '一天里喝够水、完成全部任务、专注超过 1 小时', stars: 80, hidden: true, check: (c) => !!c.flags.perfect },
];

// 成就数量达到多少解锁星空皮肤
const GALAXY_ACHIEVEMENTS = 10;

module.exports = {
  hashString,
  seededRandom,
  pickOne,
  QUEST_POOL,
  QUEST_REWARD,
  CHEST_REWARD,
  CHECKIN_QUESTS,
  STREAK_MILESTONES,
  MAX_FREEZES,
  SNACKS,
  SKINS,
  SHOP_ITEMS,
  FESTIVAL_HATS,
  GIFT_TABLE,
  ACHIEVEMENTS,
  GALAXY_ACHIEVEMENTS,
};
