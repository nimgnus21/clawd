// 养成：经验值 → 等级（升级解锁配饰），心情值（随时间慢慢下降，互动时上升）
const EventEmitter = require('events');
const { dayKey } = require('./config');

// 每种事情给多少经验、心情
const GAINS = {
  water: { xp: 10, mood: 5 },
  sit: { xp: 8, mood: 4 },
  eye: { xp: 5, mood: 3 },
  todo: { xp: 6, mood: 3 },
  focus: { xp: 2, mood: 0 }, // 每分钟
  cc: { xp: 5, mood: 2 },
  pet: { xp: 1, mood: 3 }, // 摸头、点击、跳舞
  festival: { xp: 20, mood: 10 },
};
const DAILY_PET_XP = 20; // 摸头每天最多给这么多经验

// 升级解锁的配饰
const UNLOCKS = {
  2: ['bow'],
  3: ['shades'],
  4: ['flower'],
  5: ['headphones'],
  6: ['chef'],
  7: ['glasses'],
  8: ['grad'],
  10: ['crown'],
};

const MOOD_DECAY_PER_HOUR = 4;
const MOOD_MIN = 10;

// 到 L 级一共需要的经验：50, 150, 300, 500, 750 …
function xpForLevel(level) {
  return 25 * (level - 1) * level;
}

function levelFor(xp) {
  let l = 1;
  while (xpForLevel(l + 1) <= xp) l += 1;
  return l;
}

class Progress extends EventEmitter {
  constructor(data) {
    super();
    this.data = data;
  }

  raw() {
    return {
      xp: 0,
      mood: 70,
      moodAt: Date.now(),
      unlocked: [],
      petXpDay: '',
      petXp: 0,
      lastSeen: Date.now(),
      ...(this.data.get('progress') || {}),
    };
  }

  // 心情按时间衰减后的值
  mood(p = this.raw()) {
    const hours = Math.max(0, (Date.now() - (p.moodAt || Date.now())) / 3600000);
    return Math.max(MOOD_MIN, Math.round(p.mood - hours * MOOD_DECAY_PER_HOUR));
  }

  status() {
    const p = this.raw();
    const level = levelFor(p.xp);
    const cur = xpForLevel(level);
    const next = xpForLevel(level + 1);
    return {
      xp: p.xp,
      level,
      levelXp: p.xp - cur, // 这一级已经攒了多少
      levelNeed: next - cur, // 这一级一共要多少
      mood: this.mood(p),
      unlocked: this.unlocked(p),
      nextUnlock: Object.keys(UNLOCKS).map(Number).filter((l) => l > level).sort((a, b) => a - b)[0] || null,
    };
  }

  unlocked(p = this.raw()) {
    const level = levelFor(p.xp);
    const byLevel = Object.entries(UNLOCKS).filter(([l]) => Number(l) <= level).flatMap(([, ids]) => ids);
    return [...new Set([...byLevel, ...(p.unlocked || [])])];
  }

  // 节日帽子：遇到过就永久收进衣柜
  collect(id) {
    const p = this.raw();
    if ((p.unlocked || []).includes(id)) return false;
    this.data.set({ progress: { ...p, unlocked: [...(p.unlocked || []), id] } });
    this.emit('change');
    return true;
  }

  // 获得经验和心情；times 用于按分钟给的（专注）
  gain(kind, times = 1) {
    const g = GAINS[kind];
    if (!g) return null;
    const p = this.raw();
    let xp = Math.round(g.xp * times);
    if (kind === 'pet') {
      const today = dayKey();
      if (p.petXpDay !== today) { p.petXpDay = today; p.petXp = 0; }
      xp = Math.max(0, Math.min(xp, DAILY_PET_XP - p.petXp));
      p.petXp += xp;
    }
    const before = levelFor(p.xp);
    const mood = Math.min(100, this.mood(p) + g.mood * (kind === 'focus' ? 0 : 1));
    p.xp += xp;
    p.mood = mood;
    p.moodAt = Date.now();
    p.lastSeen = Date.now();
    this.data.set({ progress: p });
    const after = levelFor(p.xp);
    if (after > before) {
      const unlocked = [];
      for (let l = before + 1; l <= after; l++) unlocked.push(...(UNLOCKS[l] || []));
      this.emit('levelup', { level: after, unlocked });
    }
    this.emit('change');
    return { xp, level: after, mood };
  }

  // 距离上次见面多久了（小时）；同时记下这次
  touchSeen() {
    const p = this.raw();
    const hours = (Date.now() - (p.lastSeen || Date.now())) / 3600000;
    this.data.set({ progress: { ...p, lastSeen: Date.now() } }, { quiet: true });
    return hours;
  }
}

module.exports = { Progress, UNLOCKS, GAINS, xpForLevel, levelFor };
