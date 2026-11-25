// 成长系统的全部配置。一条主线：你照顾好自己（合上今日三环）→ Clawd 开心、攒 ✦、换装扮
// 想调数值（目标、奖励、价格、解锁条件）改这里就行

// ---------- 今日三环 ----------
// value(day)：从当天的统计里算出进度；goal(settings)：目标
const RINGS = [
  {
    id: 'water',
    icon: '💧',
    name: '喝水',
    unit: '杯',
    goal: (st) => st.waterGoal || 8,
    value: (d) => d.water || 0,
    how: '喝水提醒时点 Clawd 的水杯，或右键「我刚喝过水」',
  },
  {
    id: 'move',
    icon: '🚶',
    name: '活动',
    unit: '次',
    goal: (st) => (st.care && st.care.moveGoal) || 4,
    value: (d) => (d.sitBreaks || 0) + (d.eyeBreaks || 0),
    how: '久坐提醒时起来走走、护眼时看看远处，都算一次',
  },
  {
    id: 'focus',
    icon: '⏱',
    name: '专注',
    unit: '分钟',
    goal: (st) => (st.care && st.care.focusGoal) || 60,
    value: (d) => (d.focusMinutes || 0) + Math.round((d.ccSeconds || 0) / 60),
    how: '专注计时，加上 Claude Code 干活的时间',
  },
];

const RING_STARS = 10; // 每合上一个环
const ALL_RINGS_BONUS = 10; // 三环全满再加
const CHECKIN_RINGS = 2; // 合上几个环算今天打卡

// ---------- 连续打卡 ----------
const STREAK_MILESTONES = { 3: 20, 7: 50, 14: 100, 30: 200, 50: 300, 100: 600 }; // 天数 → ✦
const FREEZE_EVERY = 7; // 每连续这么多天送一张补签卡
const MAX_FREEZES = 2;

// ---------- 等级：累计获得的 ✦ ----------
// 到 L 级一共要 15·L·(L-1) 个：Lv2 30、Lv3 90、Lv5 300、Lv10 1350
function starsForLevel(level) {
  return 15 * (level - 1) * level;
}
function levelFor(earned) {
  let l = 1;
  while (starsForLevel(l + 1) <= earned) l += 1;
  return l;
}

// ---------- 衣柜 ----------
// 每件东西只有一种获得方式：price（用 ✦ 买）、unlock（里程碑）、festival（节日当天收下）、free
// unlock.kind：level 等级 / streak 最长连续天数 / rings 累计合环 / focus 累计专注分钟 / checkins 累计打卡天数
const WARDROBE = [
  // 皮肤
  { id: 'classic', slot: 'skin', name: '经典橙', free: true },
  { id: 'mint', slot: 'skin', name: '薄荷绿', price: 150 },
  { id: 'lavender', slot: 'skin', name: '薰衣草', price: 150 },
  { id: 'sakura', slot: 'skin', name: '樱花粉', price: 200 },
  { id: 'ocean', slot: 'skin', name: '海盐蓝', price: 200 },
  { id: 'cocoa', slot: 'skin', name: '可可棕', price: 200 },
  { id: 'night', slot: 'skin', name: '夜幕', price: 300 },
  { id: 'gold', slot: 'skin', name: '金色传说', unlock: { kind: 'streak', n: 30, text: '连续打卡 30 天' } },
  { id: 'galaxy', slot: 'skin', name: '星空', unlock: { kind: 'rings', n: 100, text: '累计合上 100 个环' } },
  // 帽子
  { id: 'bow', slot: 'hat', name: '蝴蝶结', price: 60 },
  { id: 'flower', slot: 'hat', name: '小花', price: 60 },
  { id: 'sprout', slot: 'hat', name: '头顶小草', price: 80 },
  { id: 'starclip', slot: 'hat', name: '星星发卡', price: 100 },
  { id: 'chef', slot: 'hat', name: '厨师帽', price: 150 },
  { id: 'catears', slot: 'hat', name: '猫耳', price: 150 },
  { id: 'halo', slot: 'hat', name: '天使光环', price: 240 },
  { id: 'horns', slot: 'hat', name: '小恶魔角', price: 240 },
  { id: 'headphones', slot: 'hat', name: '耳机', unlock: { kind: 'focus', n: 1000, text: '累计专注 1000 分钟' } },
  { id: 'grad', slot: 'hat', name: '学士帽', unlock: { kind: 'checkins', n: 60, text: '累计打卡 60 天' } },
  { id: 'crown', slot: 'hat', name: '皇冠', unlock: { kind: 'level', n: 10, text: '升到 Lv.10' } },
  // 节日帽：节日当天自动戴上，并且永久收进衣柜
  { id: 'party', slot: 'hat', name: '派对帽', festival: true },
  { id: 'santa', slot: 'hat', name: '圣诞帽', festival: true },
  { id: 'witch', slot: 'hat', name: '巫师帽', festival: true },
  { id: 'cny', slot: 'hat', name: '新春帽', festival: true },
  { id: 'bunny', slot: 'hat', name: '兔耳朵', festival: true },
  { id: 'heart', slot: 'hat', name: '爱心', festival: true },
  // 脸上 / 身上
  { id: 'shades', slot: 'face', name: '墨镜', price: 100 },
  { id: 'glasses', slot: 'face', name: '眼镜', price: 100 },
  { id: 'scarf', slot: 'face', name: '红围巾', price: 180 },
];

const ITEM = Object.fromEntries(WARDROBE.map((x) => [x.id, x]));

module.exports = {
  RINGS,
  RING_STARS,
  ALL_RINGS_BONUS,
  CHECKIN_RINGS,
  STREAK_MILESTONES,
  FREEZE_EVERY,
  MAX_FREEZES,
  starsForLevel,
  levelFor,
  WARDROBE,
  ITEM,
};
