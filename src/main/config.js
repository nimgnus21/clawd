// 全局常量、默认设置和旧版本设置的迁移
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

// 像素网格大小（和 src/renderer/pet/sprite.js 保持一致）
const GRID_W = 16;
const GRID_H = 10;
// 每个像素点在屏幕上多大
const SCALES = { small: 5, medium: 7, large: 10 };

// settings.json：用户可以改的选项
const SETTINGS_DEFAULTS = {
  version: 2,
  size: 'medium',
  walk: false,
  climb: true, // 散步时能站到其他窗口顶上（仅 Windows）
  onTop: true,
  clock: true, // 头顶显示时钟
  chime: true, // 整点报时
  // 各种提醒的间隔（分钟），0 = 关闭。久坐、护眼按“用电脑的时间”算
  reminders: { water: 45, sit: 60, eye: 0 },
  waterGoal: 8, // 每天目标杯数
  sysAlerts: true, // 电量低、CPU 太忙、内存快满时提醒
  festival: true, // 节日自动换装
  birthday: '', // 生日 'MM-DD'，那天戴派对帽
  outfit: { hat: 'none', face: 'none' }, // 衣柜里选的配饰
  x: null,
  y: null,
};

// data.json：Clawd 自己记录的数据（每日统计等）
const DATA_DEFAULTS = {
  version: 1,
  days: {}, // { '2026-11-11': { water: 3, ... } }
};

const pad2 = (n) => String(n).padStart(2, '0');

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function migrateSettings(s, raw) {
  if (!SCALES[s.size]) s.size = 'medium';
  // 1.x 版本的喝水间隔是顶层的 water 字段
  if (typeof raw.water === 'number' && !(raw.reminders && 'water' in raw.reminders)) {
    s.reminders = { ...s.reminders, water: raw.water };
  }
  s.reminders = { ...SETTINGS_DEFAULTS.reminders, ...(s.reminders || {}) };
  delete s.water;
  delete s.waterLog; // 搬到 data.json 里了
  delete s.chat; // 2.1 起没有聊天功能了，顺手删掉以前存的 API key
  s.version = SETTINGS_DEFAULTS.version;
}

// 把 1.x 版本 settings.json 里的“今天喝了几杯”搬进 data.json
function migrateData(d, oldSettingsRaw) {
  if (!d.days || typeof d.days !== 'object') d.days = {};
  const log = oldSettingsRaw && oldSettingsRaw.waterLog;
  if (log && log.date && log.count) {
    const [y, m, day] = String(log.date).split('-').map(Number);
    if (y && m && day) {
      const key = `${y}-${pad2(m)}-${pad2(day)}`;
      d.days[key] = { ...(d.days[key] || {}), water: Math.max(log.count, (d.days[key] || {}).water || 0) };
    }
  }
}

module.exports = {
  IS_MAC,
  IS_WIN,
  IS_LINUX,
  GRID_W,
  GRID_H,
  SCALES,
  SETTINGS_DEFAULTS,
  DATA_DEFAULTS,
  dayKey,
  pad2,
  migrateSettings,
  migrateData,
};
