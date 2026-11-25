// Clawd 日记：根据每天的统计和成长记录，用模板拼出一篇小日记（不联网、不需要 API key）
const { ITEM } = require('./growth-catalog');

// 按字符串固定的随机数：同一天的日记每次打开都一样
function seededRandom(str) {
  let a = 2166136261;
  for (let i = 0; i < str.length; i++) { a ^= str.charCodeAt(i); a = Math.imul(a, 16777619); }
  a >>>= 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickOne = (rnd, list) => list[Math.floor(rnd() * list.length)];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dateTitle(key) {
  const [y, m, d] = key.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return `${m}月${d}日 ${WEEKDAYS[w]}`;
}

const OPENERS = {
  great: ['今天是超棒的一天！', '今天心情好得想转圈圈 ✨', '今天过得特别充实！'],
  good: ['今天还不错～', '平平稳稳的一天。', '今天也一起努力了。'],
  quiet: ['今天你好像很忙。', '今天有点安静。', '今天没怎么说上话。'],
};

const CLOSERS = {
  great: ['明天也要这样哦！', '我们真是最佳搭档 🤝', '晚安，做个好梦 🌙'],
  good: ['明天继续加油～', '晚安，明天见！', '记得早点休息哦。'],
  quiet: ['不过没关系，我一直在这儿等你。', '明天记得来摸摸我呀。', '我会乖乖在桌面上等你的。'],
};


// 一天的日记：{ day, title, mood: 'great'|'good'|'quiet', lines: [...] }
function entry(day, stat = {}, log = {}, waterGoal = 8) {
  const rnd = seededRandom(`diary:${day}`);
  const lines = [];
  let score = 0;

  const water = stat.water || 0;
  if (water >= waterGoal) {
    lines.push(pickOne(rnd, [`喝够了 ${water} 杯水，咕嘟咕嘟，好满足 💧`, `今天的 ${waterGoal} 杯水目标完成啦！一共喝了 ${water} 杯 💧`]));
    score += 2;
  } else if (water > 0) {
    lines.push(pickOne(rnd, [`陪你喝了 ${water} 杯水，离 ${waterGoal} 杯还差一点点。`, `喝了 ${water} 杯水，明天要多喝一点哦。`]));
    score += 1;
  }

  const focus = (stat.focusMinutes || 0) + Math.round((stat.ccSeconds || 0) / 60);
  if (focus > 0) {
    lines.push(pickOne(rnd, [`专注了 ${focus} 分钟，我在旁边安静地敲键盘陪着。`, `一起专注了 ${focus} 分钟，认真的样子好帅！`]));
    score += focus >= 60 ? 2 : 1;
  }

  const breaks = (stat.sitBreaks || 0) + (stat.eyeBreaks || 0);
  if (breaks > 0) {
    lines.push(pickOne(rnd, [`起来活动、让眼睛休息了 ${breaks} 次，身体最重要！`, `休息了 ${breaks} 次，伸懒腰的时候我也跟着伸了。`]));
    score += 1;
  }

  const ccBreaks = stat.ccBreaks || 0;
  if (ccBreaks > 0) {
    lines.push(pickOne(rnd, [`趁 Claude 干活的时候休息了 ${ccBreaks} 次，会摸鱼才会干活 ✻`, `Claude 在跑的时候你去歇了 ${ccBreaks} 次，节奏刚刚好`]));
    score += 1;
  }

  const todos = stat.todosDone || 0;
  if (todos > 0) {
    lines.push(todos > 1 ? `划掉了 ${todos} 件待办，效率满分 ✅` : '划掉了一件待办 ✅');
    score += 1;
  }

  const cc = stat.ccTasks || 0;
  if (cc > 0) {
    const min = Math.round((stat.ccSeconds || 0) / 60);
    lines.push(min > 0 ? `Claude Code 完成了 ${cc} 个任务，一共忙了 ${min} 分钟。我在旁边加油！` : `Claude Code 完成了 ${cc} 个任务。`);
    score += 1;
  }

  if (log.all) {
    lines.push('三个环全合上了，完美的一天 🎉');
    score += 2;
  } else if (log.rings) {
    lines.push(`合上了 ${log.rings} 个环${log.checkin ? '，打卡成功' : ''}。`);
    score += 1;
  }
  if (log.checkin && log.streak > 1) lines.push(`连续打卡第 ${log.streak} 天 🔥`);
  for (const id of log.unlocked || []) if (ITEM[id]) lines.push(`衣柜里多了「${ITEM[id].name}」！`);
  for (const lv of log.levelups || []) lines.push(`升到了 Lv.${lv}！`);

  const mood = score >= 6 ? 'great' : score >= 2 ? 'good' : 'quiet';
  return {
    day,
    title: dateTitle(day),
    mood,
    opener: pickOne(rnd, OPENERS[mood]),
    lines,
    closer: pickOne(rnd, CLOSERS[mood]),
  };
}

// 最近 n 天的日记，新的在前；没有任何记录的日子跳过（今天总是有）
function recent(stats, log = {}, waterGoal = 8, n = 14) {
  return stats.lastDays(n).reverse()
    .map((d, i) => {
      const { date, ...stat } = d;
      const e = log[date] || {};
      const empty = !Object.values(stat).some((v) => v > 0) && !Object.keys(e).length;
      if (empty && i > 0) return null;
      return entry(date, stat, e, waterGoal);
    })
    .filter(Boolean);
}

// 本周回顾：最近 7 天和再之前 7 天比
function weekRecap(stats, log = {}) {
  const days = stats.lastDays(14);
  const prev = days.slice(0, 7);
  const cur = days.slice(7);
  const sum = (list, f) => list.reduce((a, d) => a + (d[f] || 0), 0);
  const sumLog = (list, f) => list.reduce((a, d) => a + (typeof f === 'function' ? f(log[d.date] || {}) : 0), 0);
  const items = [
    { key: 'water', label: '💧 喝水', unit: '杯', now: sum(cur, 'water'), before: sum(prev, 'water') },
    { key: 'breaks', label: '🚶 活动', unit: '次', now: sum(cur, 'sitBreaks') + sum(cur, 'eyeBreaks'), before: sum(prev, 'sitBreaks') + sum(prev, 'eyeBreaks') },
    { key: 'focus', label: '⏱ 专注', unit: '分钟', now: sum(cur, 'focusMinutes') + Math.round(sum(cur, 'ccSeconds') / 60), before: sum(prev, 'focusMinutes') + Math.round(sum(prev, 'ccSeconds') / 60) },
    { key: 'ccBreaks', label: '☕ 趁 Claude 跑时休息', unit: '次', now: sum(cur, 'ccBreaks'), before: sum(prev, 'ccBreaks') },
    { key: 'todo', label: '完成待办', unit: '件', now: sum(cur, 'todosDone'), before: sum(prev, 'todosDone') },
    { key: 'cc', label: 'Claude Code 任务', unit: '个', now: sum(cur, 'ccTasks'), before: sum(prev, 'ccTasks') },
    { key: 'checkin', label: '打卡', unit: '天', now: sumLog(cur, (e) => (e.checkin ? 1 : 0)), before: sumLog(prev, (e) => (e.checkin ? 1 : 0)) },
    { key: 'stars', label: '获得 ✦', unit: '✦', now: sumLog(cur, (e) => e.stars || 0), before: sumLog(prev, (e) => e.stars || 0) },
  ];
  // 一句总结：挑进步最大的一项真实习惯夸一下（星星、打卡这种游戏数字不算）
  const habits = items.filter((x) => !['stars', 'checkin'].includes(x.key));
  const ratio = (x) => (x.now - x.before) / (x.before || 1);
  const better = habits.filter((x) => x.now > x.before && x.now > 0).sort((a, b) => ratio(b) - ratio(a) || habits.indexOf(a) - habits.indexOf(b));
  let headline;
  if (!items.some((x) => x.now > 0)) headline = '这周还没什么记录，从喝一杯水开始吧 💧';
  else if (better.length) headline = `这周${better[0].label.replace(/^\S+\s/, '')}比上周多了 ${better[0].now - better[0].before} ${better[0].unit}，进步看得见！`;
  else headline = '这周稳稳的，保持住就很棒～';
  return { items, headline };
}

module.exports = { entry, recent, weekRecap, dateTitle };
