// Clawd 桌面宠物 —— Electron 主进程入口：把各个模块连起来
const { app, ipcMain, screen, shell, powerMonitor, Notification } = require('electron');
const path = require('path');
const config = require('./config');
const { JsonStore } = require('./store');
const { Stats } = require('./stats');
const { PetWindow } = require('./pet-window');
const { Reminders, KINDS } = require('./reminders');
const { Menus } = require('./menu');
const { ClaudeCode } = require('./claude-code');
const { PanelWindow } = require('./panel-window');
const { Dnd } = require('./dnd');
const { Todos } = require('./todos');
const { SysMon } = require('./sysmon');
const { Growth } = require('./growth');
const catalog = require('./growth-catalog');
const diary = require('./diary');
const { Updater, fakeAutoUpdater } = require('./updater');
const winapi = require('./winapi');
const log = require('./log');

const { IS_MAC, IS_WIN, IS_LINUX, SCALES, dayKey } = config;
const ROOT = path.join(__dirname, '..', '..');

if (IS_LINUX) {
  // Linux 下透明窗口需要这两项
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.disableHardwareAcceleration();
}
if (IS_WIN) app.setAppUserModelId('com.clawd.desktoppet');

let settings;
let data;
let stats;
let pet;
let reminders;
let menus;
let cc;
let panel;
let dnd;
let todos;
let sysmon;
let growth;
let updater;
let hiddenByDnd = false;
let idleOverride = null; // 测试用：假装系统空闲了多少秒

// ---------------- 通知 ----------------
function notify(title, body) {
  if (!Notification.isSupported()) return;
  if (dnd && dnd.active()) return; // 勿扰时不弹通知
  new Notification({
    title: String(title || 'Clawd'),
    body: String(body || ''),
    icon: path.join(ROOT, 'assets', 'icon.png'),
  }).show();
}

// ---------------- 发给小人页面的设置 ----------------
function publicSettings() {
  return {
    ...settings.all(),
    scale: SCALES[settings.get('size')],
    platform: process.platform,
    waterToday: stats.get('water'),
    // 点小人时偶尔念一下还没做完的事
    todosOpen: todos ? todos.open().slice(0, 3).map((t) => t.text) : [],
    todosOpenCount: todos ? todos.open().length : 0,
    level: growth ? growth.summary().level : 1,
    mood: growth ? growth.mood() : 65,
    unlocked: growth ? growth.owned() : [],
    growth: growth ? growth.summary() : {},
  };
}

function sendSettings() {
  pet.send('settings', publicSettings());
}

// ---------------- 各种设置操作（菜单、以后的面板都调用这些） ----------------
const actions = {
  setSize(size) {
    if (!SCALES[size]) return;
    settings.set({ size });
  },
  setOnTop(on) {
    settings.set({ onTop: !!on });
  },
  setWalk(on) {
    settings.set({ walk: !!on });
  },
  setFlag(key, on) {
    settings.set({ [key]: !!on });
  },
  setReminder(kind, minutes) {
    settings.update('reminders', (r) => { r[kind] = Math.max(0, Number(minutes) || 0); });
  },
  // ---- Claude Code ----
  ccInstall() {
    try {
      const st = cc.install();
      pet.send('say', st.listening
        ? '接入好了！之后 Claude Code 干活我都知道 ✻'
        : `接入好了，不过本机服务没开起来：${st.serverError || '未知原因'}`);
      return st;
    } catch (err) {
      notify('接入 Claude Code 失败', String(err.message || err));
      return { error: String(err.message || err) };
    }
  },
  ccUninstall() {
    try {
      const st = cc.uninstall();
      pet.send('say', '已经从 Claude Code 里移除了');
      return st;
    } catch (err) {
      notify('移除失败', String(err.message || err));
      return { error: String(err.message || err) };
    }
  },
  ccSet(patch) {
    const before = cc.config();
    cc.setConfig(patch);
    // 开关“显示工具”要增减 PreToolUse hook，已接入的话自动重新写一次
    if ('tools' in patch && patch.tools !== before.tools && cc.status().installed) cc.install();
  },
  ccDemo() {
    cc.demo();
  },
  ccReveal() {
    shell.showItemInFolder(cc.status().settingsFile);
  },
  setWaterGoal(n) {
    settings.set({ waterGoal: Math.min(20, Math.max(1, Math.round(Number(n) || 8))) });
  },
  setAutoStart(on) {
    if (!app.isPackaged || IS_LINUX) return { error: '用安装包装好的版本才能设置开机自启' };
    app.setLoginItemSettings({ openAtLogin: !!on });
    return { ok: true };
  },
  togglePet() {
    pet.toggle();
  },
  // 面板上让小人做点事（只允许这几个）
  petCommand(cmd) {
    if (!['dance', 'drink', 'pet', 'focus-25', 'focus-45', 'focus-stop'].includes(cmd)) return { error: 'unknown' };
    pet.show();
    pet.send('menu', cmd);
    return { ok: true };
  },
  openDataDir() {
    shell.openPath(app.getPath('userData'));
  },
  openPanel(tab) {
    panel.open(tab);
  },
  // ---- 装扮 ----
  setBirthday(mmdd) {
    const ok = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(mmdd || ''));
    settings.set({ birthday: ok ? mmdd : '' });
  },
  // 穿衣服：hat / face / skin，只能穿衣柜里有的
  setOutfit(patch = {}) {
    const o = { hat: 'none', face: 'none', skin: 'classic', ...(settings.get('outfit') || {}) };
    const owned = growth.owned();
    for (const slot of ['hat', 'face', 'skin']) {
      if (typeof patch[slot] !== 'string') continue;
      const id = patch[slot].slice(0, 20);
      const none = slot === 'skin' ? 'classic' : 'none';
      if (id !== none) {
        const item = catalog.ITEM[id];
        if (!item || item.slot !== slot) return { error: '这件不能穿在这里' };
        if (!owned.includes(id)) return { error: '这件还没有' };
      }
      o[slot] = id;
    }
    settings.set({ outfit: o });
    return { ok: true };
  },
  // 衣柜里买东西，买完直接穿上
  wardrobeBuy(id) {
    const r = growth.buy(String(id));
    if (r.ok) actions.setOutfit({ [r.slot]: String(id) });
    return r;
  },
  growthSet(patch = {}) {
    const p = {};
    for (const k of ['weekendRest', 'morning']) if (k in patch) p[k] = !!patch[k];
    settings.set({ growth: { ...growth.config(), ...p } });
    return { ok: true };
  },
  // 三环的目标：活动几次、专注几分钟（喝水目标用 setWaterGoal）
  careSet(patch = {}) {
    const c = { moveGoal: 4, focusGoal: 60, ...(settings.get('care') || {}) };
    if ('moveGoal' in patch) c.moveGoal = Math.min(20, Math.max(1, Math.round(Number(patch.moveGoal) || 4)));
    if ('focusGoal' in patch) c.focusGoal = Math.min(600, Math.max(5, Math.round(Number(patch.focusGoal) || 60)));
    settings.set({ care: c });
    return { ok: true };
  },
  // 手动记一次活动（起来走了走、看了看远处）
  logBreak() {
    if (reminders.status('sit').pending) reminders.ack('sit');
    const count = stats.add('sitBreaks', 1);
    pet.send('say', `活动 +1 ✓ 今天第 ${count} 次`);
    return { ok: true, count };
  },
  // ---- 待办 ----
  todoAdd(text, remindAt) {
    return todos.add(text, remindAt);
  },
  todoEdit(id, patch) {
    return todos.edit(id, patch);
  },
  todoDone(id, done = true) {
    const r = todos.setDone(id, done);
    if (done && r.ok) pet.send('say', r.left ? `✓ 搞定一件！还剩 ${r.left} 件` : '✓ 待办全部清空，太棒了！');
    return r;
  },
  todoRemove(id) {
    todos.remove(id);
  },
  todoClearDone() {
    todos.clearDone();
  },
  todoSnooze(id, minutes = 10) {
    todos.snooze(id, minutes);
  },
  // ---- 更新 ----
  updateCheck() {
    return updater.check();
  },
  updateInstall() {
    return updater.install();
  },
  updateSet(patch) {
    return updater.setConfig(patch || {});
  },
  openReleases() {
    const { repo } = updater.config();
    if (repo) shell.openExternal(`https://github.com/${repo}/releases`);
  },
  // ---- 勿扰 ----
  dndManual(minutes) {
    dnd.setManual(minutes);
  },
  dndSet(patch) {
    const p = {};
    if ('auto' in patch) p.auto = !!patch.auto;
    if (['hide', 'quiet'].includes(patch.action)) p.action = patch.action;
    dnd.setConfig(p);
    if (dnd.active()) applyDnd(dnd.status());
  },
};

// ---------------- 勿扰 ----------------
// 勿扰开始：暂停提醒；“隐藏”就把小人藏起来，“安静”就变淡不说话。结束后恢复。
function applyDnd(st) {
  reminders.setSuppressed(st.active);
  todos.setSuppressed(st.active);
  if (st.active && st.action === 'hide') {
    if (pet.isVisible()) {
      hiddenByDnd = true;
      pet.hide();
    }
    pet.send('quiet', false);
  } else {
    if (hiddenByDnd) {
      hiddenByDnd = false;
      pet.show();
    }
    pet.send('quiet', !!st.active);
  }
}

// ---------------- 控制面板要显示的数据 ----------------
function panelState() {
  const all = settings.all();
  const safe = { ...all, claudeCode: { ...(all.claudeCode || {}), token: undefined } };
  return {
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    settings: safe,
    autoStart: app.isPackaged && !IS_LINUX ? app.getLoginItemSettings().openAtLogin : false,
    today: stats.today(),
    reminders: Object.fromEntries(KINDS.map((k) => [k, reminders.status(k)])),
    cc: cc.status(),
    dnd: dnd.status(),
    todos: todos.list(),
    sys: sysmon.last,
    growth: growth.view(),
    diary: diary.recent(stats, growth.log(), settings.get('waterGoal') || 8, 14),
    week: diary.weekRecap(stats, growth.log()),
    history: stats.lastDays(30),
    update: updater.status(),
    petVisible: pet.isVisible(),
    dataDir: app.getPath('userData'),
  };
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

// ---------------- Claude Code 联动 ----------------
function wireClaudeCode() {
  cc.on('sessions', (snap) => pet.send('cc', { kind: 'sessions', ...snap }));
  cc.on('event', (ev) => {
    pet.send('cc', { kind: 'event', ...ev });
    const cfg = cc.config();
    if (!cfg.notify || ev.demo) return;
    const where = ev.project ? `「${ev.project}」` : '';
    if (ev.type === 'done' && ev.took >= cfg.notifyMinSec * 1000) {
      notify('Claude Code 完成了 ✓', `${where}任务完成，用时 ${fmtDuration(ev.took)}`);
    } else if (ev.type === 'waiting') {
      notify('Claude Code 等你确认', `${where}${ev.message}`);
    } else if (ev.type === 'error') {
      notify('Claude Code 出错了', `${where}${ev.message}`);
    }
  });
  cc.start();
}

// 设置变化后各模块做出反应
function onSettingsChange(keys) {
  if (keys.includes('size')) pet.resize();
  if (keys.includes('onTop')) pet.setOnTop(settings.get('onTop'));
  if (keys.includes('walk') || keys.includes('climb')) {
    menus.refreshTray();
    if (settings.get('walk')) pet.startFall();
  }
  sendSettings();
}

// ---------------- 提醒 ----------------
const REMINDER_NOTIFY = {
  water: () => ['该喝水啦 💧', `已经 ${reminders.interval('water')} 分钟没喝水了，起来喝一杯吧！`],
  sit: () => ['起来活动一下吧', `已经连续用了 ${reminders.interval('sit')} 分钟电脑，站起来伸个懒腰～`],
  eye: () => ['让眼睛休息一下', '看看 6 米外的地方 20 秒吧（20-20-20 护眼法）'],
};
const REMINDER_STAT = { sit: 'sitBreaks', eye: 'eyeBreaks' };

function wireReminders() {
  reminders.on('due', (kind) => {
    pet.send('reminder', { kind, due: true });
    // 小人藏起来了就用系统通知提醒
    if (!pet.isVisible() && REMINDER_NOTIFY[kind]) notify(...REMINDER_NOTIFY[kind]());
  });
  reminders.on('clear', (kind, info = {}) => {
    pet.send('reminder', { kind, due: false, away: !!info.away });
    // 提醒之后离开了电脑：也算休息过
    if (info.away && REMINDER_STAT[kind]) stats.add(REMINDER_STAT[kind], 1);
  });

  // 页面里处理了提醒（点了小人）
  ipcMain.handle('reminder-done', (_e, kind) => {
    reminders.ack(kind);
    // 只记统计；三环的进度直接看统计，成长模块自己会去检查
    if (kind === 'water') {
      const count = stats.add('water', 1);
      sendSettings();
      return { count, goal: settings.get('waterGoal') };
    }
    if (REMINDER_STAT[kind]) return { count: stats.add(REMINDER_STAT[kind], 1) };
    return {};
  });
}

// ---------------- 待办 ----------------
function wireTodos() {
  const toPet = (t) => ({ id: t.id, text: t.text, remindAt: t.remindAt });
  todos.on('due', (t) => {
    pet.send('todo', { kind: 'due', todo: toPet(t) });
    if (!pet.isVisible()) notify('待办提醒 ⏰', t.text);
  });
  todos.on('clear', (id) => pet.send('todo', { kind: 'clear', id }));
  // 小人重新加载时，把已经提醒过、还没完成的再发一遍
  pet.on('loaded', () => todos.pendingReminders().forEach((t) => pet.send('todo', { kind: 'due', todo: toPet(t), quiet: true })));
  // 小人上点了“完成”
  ipcMain.handle('todo-done', (e, id) => {
    if (!pet.fromPet(e)) return {};
    return todos.setDone(id, true);
  });
  data.on('change', (keys) => { if (keys.includes('todos')) sendSettings(); });
}

// ---------------- 养成 ----------------
// 发给小人的成长消息：小人页面还没加载好就先攒着
let petReady = false;
const petQueue = [];
function sendGrowth(ev) {
  if (petReady) pet.send('growth', ev);
  else petQueue.push(ev);
}

// 早安（每天第一次见面）和晚间提醒（还没打卡）：人在电脑前、没勿扰时才说
function maybeMorning() {
  if (!petReady || !pet.isVisible() || dnd.active()) return;
  const idle = idleOverride !== null ? idleOverride : powerMonitor.getSystemIdleTime();
  if (idle > 60) return;
  const m = growth.morning() || growth.evening();
  if (m) sendGrowth(m);
}

function wireGrowth() {
  growth.on('change', () => {
    sendSettings();
    panel.push();
  });
  growth.on('event', (ev) => {
    if (ev.type === 'newday') {
      setTimeout(maybeMorning, 5000);
      return;
    }
    sendGrowth(ev);
    // 小人藏起来时，重要的事用通知说
    if (pet.isVisible()) return;
    if (ev.type === 'checkin' && ev.milestone) notify(`连续打卡 ${ev.milestone.days} 天 🔥`, `奖励 ${ev.milestone.stars}✦`);
    else if (ev.type === 'unlock') notify(`衣柜里多了「${ev.name}」`, ev.why);
    else if (ev.type === 'levelup') notify(`Clawd 升到 Lv.${ev.level} 了`, '继续照顾好自己～');
  });
  pet.on('loaded', () => {
    petReady = true;
    petQueue.splice(0).forEach((ev) => pet.send('growth', ev));
    setTimeout(maybeMorning, 9000);
  });
  setInterval(maybeMorning, 60000);

  // 专注完成（分钟）：记进统计，专注环会自己算
  ipcMain.on('focus-done', (e, min) => {
    if (!pet.fromPet(e)) return;
    const m = Math.max(0, Math.min(180, Math.round(Number(min) || 0)));
    if (m) stats.add('focusMinutes', m);
  });
  // 遇到节日：节日帽收进衣柜
  ipcMain.on('festival-seen', (e, info = {}) => {
    if (!pet.fromPet(e)) return;
    if (typeof info.hat === 'string') growth.collect(info.hat);
  });
  // 摸头、点击、跳舞只是玩，不算分
  ipcMain.on('interact', () => {});
  // 心情跟着三环和时间走：每 5 分钟同步一次给小人
  setInterval(sendSettings, 5 * 60000);
  // 好久不见
  const last = data.get('lastSeen') || (data.get('progress') || {}).lastSeen || Date.now();
  data.set({ lastSeen: Date.now() }, { quiet: true });
  setInterval(() => data.set({ lastSeen: Date.now() }, { quiet: true }), 10 * 60000);
  if (Date.now() - last > 12 * 3600000) pet.once('loaded', () => setTimeout(() => pet.send('say', '好久不见！想你了～'), 6500));
  growth.start();
}

function wireUpdater() {
  updater.on('state', () => panel.push());
  updater.on('ready', (version) => {
    pet.send('say', `新版本 v${version} 下载好啦，下次退出时自动装上`);
    notify('Clawd 有新版本', `v${version} 已下载，退出 Clawd 时会自动安装；也可以在控制面板「关于」里马上更新。`);
  });
  updater.configure();
  updater.start();
}

// ---------------- 其他页面请求 ----------------
function wireIpc() {
  ipcMain.handle('get-settings', () => publicSettings());
  ipcMain.on('notify', (_e, msg = {}) => notify(msg.title, msg.body));
  ipcMain.on('context-menu', (e, state) => {
    if (pet.fromPet(e)) menus.popupPet(state);
  });
}

// ---------------- Windows 接口自检（在 Wine 里测试用） ----------------
// 用一个普通窗口代替透明小人窗口（Wine 不支持透明窗口），把结果写到文件后退出
function winapiSelftest(outFile) {
  const fs = require('fs'); // eslint-disable-line global-require
  const report = {};
  const step = (name, fn) => {
    try {
      report[name] = fn();
    } catch (err) {
      report[name] = `ERROR ${err && err.stack}`;
    }
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  };
  // 先不建窗口（Wine 里 Electron 建窗口会卡住），直接查系统里的窗口
  step('available', () => winapi.available());
  step('loadError', () => winapi.loadError());
  step('quns', () => winapi.notificationState());
  step('foregroundFullscreen', () => winapi.foregroundFullscreen([]));
  step('windows', () => winapi.listWindows([]).slice(0, 20));
  step('firstInfo', () => {
    const list = winapi.listWindows([]);
    return list.length ? winapi.info(list[0].hwnd) : null;
  });
  app.exit(0);
}

// ---------------- 启动 ----------------
function start() {
  if (process.env.CLAWD_WINAPI_SELFTEST) {
    winapiSelftest(process.env.CLAWD_WINAPI_SELFTEST);
    return;
  }
  if (IS_MAC && app.dock) app.dock.hide();

  const userData = app.getPath('userData');
  log.init(userData);
  log.info(`Clawd ${app.getVersion()} starting on ${process.platform}`);
  settings = new JsonStore(path.join(userData, 'settings.json'), config.SETTINGS_DEFAULTS);
  settings.load(config.migrateSettings);
  data = new JsonStore(path.join(userData, 'data.json'), config.DATA_DEFAULTS);
  data.load((d) => config.migrateData(d, settings.raw));
  stats = new Stats(data);
  // 迁移过的旧字段马上写回去
  settings.flush();
  data.flush();

  const getIdle = () => (idleOverride !== null ? idleOverride : powerMonitor.getSystemIdleTime());
  pet = new PetWindow(settings, getIdle);
  reminders = new Reminders(settings, getIdle);
  cc = new ClaudeCode(settings, stats);
  panel = new PanelWindow({ getState: panelState, actions });
  dnd = new Dnd(settings, () => [pet.win, panel.win].filter((w) => w && !w.isDestroyed()).map((w) => winapi.hwndOf(w)));
  todos = new Todos(data, stats);
  growth = new Growth({ data, settings, stats });
  updater = new Updater(settings, process.env.CLAWD_TEST && process.env.CLAWD_FAKE_UPDATER ? fakeAutoUpdater(process.env.CLAWD_FAKE_UPDATER) : null);
  sysmon = new SysMon();
  sysmon.on('sample', (smp) => {
    if (pet.isVisible()) pet.send('sys', smp);
    if (panel.alive()) panel.push();
  });
  menus = new Menus({ settings, pet, reminders, stats, actions, cc, dnd, todos, growth });

  wireIpc();
  wireReminders();
  wireClaudeCode();
  wireTodos();
  wireGrowth();
  wireUpdater();
  settings.on('change', onSettingsChange);
  pet.on('loaded', sendSettings);

  // 这些东西一变，面板就刷新
  const push = () => panel.push();
  settings.on('change', push);
  data.on('change', push);
  cc.on('status', push);
  cc.on('sessions', push);
  reminders.on('due', push);
  reminders.on('clear', push);
  pet.on('visibility', push);
  dnd.on('change', (st) => {
    applyDnd(st);
    push();
  });
  // 勿扰把小人藏起来后，用户自己从托盘叫出来了，就不再管它
  pet.on('visibility', () => { if (pet.isVisible()) hiddenByDnd = false; });
  pet.on('loaded', () => pet.send('quiet', dnd.active() && dnd.config().action === 'quiet'));

  log.debug('start: pet.create');
  pet.create();
  log.debug('start: tray');
  menus.createTray();
  log.debug('start: reminders');
  reminders.start();
  log.debug('start: dnd');
  dnd.start();
  todos.start();
  sysmon.start();

  // 自动化测试用：只有设置了 CLAWD_TEST 环境变量才会暴露
  if (process.env.CLAWD_TEST) {
    globalThis.__clawd = {
      actions, settings, data, stats, pet, reminders, menus, cc, panel, panelState, dnd, winapi, todos, sysmon, growth, updater,
      setIdle: (n) => { idleOverride = n; },
    };
  }

  screen.on('display-removed', () => pet.ensureOnScreen());
  screen.on('display-metrics-changed', () => pet.ensureOnScreen());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => pet && pet.show());
  app.whenReady().then(start).catch((err) => {
    log.error('startup failed', err);
    throw err;
  });
  process.on('uncaughtException', (err) => log.error('uncaught', err));
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));
  app.on('before-quit', () => {
    if (settings) settings.flush();
    if (data) data.flush();
  });
  app.on('window-all-closed', () => app.quit());
}
