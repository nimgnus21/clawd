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
const { Progress, UNLOCKS } = require('./progress');
const { Chat, MODELS } = require('./chat');
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
let progress;
let chat;
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
    level: progress ? progress.status().level : 1,
    mood: progress ? progress.status().mood : 70,
    unlocked: progress ? progress.status().unlocked : [],
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
    if (!['dance', 'drink', 'pet'].includes(cmd)) return { error: 'unknown' };
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
  setOutfit(patch = {}) {
    const o = { hat: 'none', face: 'none', ...(settings.get('outfit') || {}) };
    const unlocked = progress.status().unlocked;
    for (const key of ['hat', 'face']) {
      if (typeof patch[key] !== 'string') continue;
      const id = patch[key].slice(0, 20);
      if (id !== 'none' && !unlocked.includes(id)) return { error: '这件还没解锁' };
      o[key] = id;
    }
    settings.set({ outfit: o });
    return { ok: true };
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
  // ---- 聊天 ----
  chatSend(text) {
    return chat.send(text);
  },
  chatReset() {
    chat.reset();
  },
  chatSetKey(key) {
    return chat.setKey(key);
  },
  chatClearKey() {
    return chat.clearKey();
  },
  chatSetModel(model) {
    if (!MODELS[model]) return { error: '不认识这个模型' };
    chat.setConfig({ model });
    return { ok: true };
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
  openKeyPage() {
    shell.openExternal('https://console.anthropic.com/settings/keys');
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
  const safe = { ...all, claudeCode: { ...(all.claudeCode || {}), token: undefined }, chat: undefined };
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
    progress: progress.status(),
    unlocks: UNLOCKS,
    history: stats.lastDays(30),
    chat: chat.status(),
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
    if (info.away && REMINDER_STAT[kind]) {
      stats.add(REMINDER_STAT[kind], 1);
      progress.gain(kind);
    }
  });

  // 页面里处理了提醒（点了小人）
  ipcMain.handle('reminder-done', (_e, kind) => {
    reminders.ack(kind);
    if (['water', 'sit', 'eye'].includes(kind)) progress.gain(kind);
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
function wireProgress() {
  const { ITEM_NAMES } = require('./items'); // eslint-disable-line global-require
  progress.on('levelup', ({ level, unlocked }) => {
    const names = unlocked.map((id) => ITEM_NAMES[id] || id);
    pet.send('levelup', { level, unlocked: names });
    notify(`Clawd 升级啦！Lv.${level}`, names.length ? `解锁了：${names.join('、')}，去控制面板的衣柜看看吧` : '继续加油～');
  });
  progress.on('change', sendSettings);
  todos.on('done', () => progress.gain('todo'));
  cc.on('event', (ev) => { if (ev.type === 'done' && !ev.demo) progress.gain('cc'); });
  // 小人页面：摸头、点击、跳舞
  ipcMain.on('interact', (e) => { if (pet.fromPet(e)) progress.gain('pet'); });
  // 专注完成（分钟）
  ipcMain.on('focus-done', (e, min) => {
    if (!pet.fromPet(e)) return;
    const m = Math.max(0, Math.min(180, Math.round(Number(min) || 0)));
    stats.add('focusMinutes', m);
    progress.gain('focus', m);
  });
  // 遇到节日：节日帽收进衣柜，每天第一次 +20 经验
  ipcMain.on('festival-seen', (e, info = {}) => {
    if (!pet.fromPet(e)) return;
    if (typeof info.hat === 'string') progress.collect(info.hat);
    const key = `festival:${dayKey()}`;
    if (data.get('lastFestivalXp') !== key) {
      data.set({ lastFestivalXp: key });
      progress.gain('festival');
    }
  });
  // 心情会随时间下降：每 10 分钟同步一次给小人
  setInterval(sendSettings, 10 * 60000);
  // 好久不见
  const away = progress.touchSeen();
  if (away > 12) pet.once('loaded', () => setTimeout(() => pet.send('say', '好久不见！想你了～'), 6500));
}

// ---------------- 聊天 ----------------
// 每轮对话附带一条“当前情况”，让 Clawd 能回答“我今天喝了几杯水”之类的问题
function chatContext() {
  const d = new Date();
  const p = progress.status();
  const open = todos.open();
  const firstTodos = open.slice(0, 3).map((t) => `「${t.text}」`).join('、');
  return [
    `当前情况（应用自动提供，不是用户说的）：现在是 ${d.getMonth() + 1}月${d.getDate()}日 ${config.pad2(d.getHours())}:${config.pad2(d.getMinutes())}。`,
    `用户今天喝了 ${stats.get('water')}/${settings.get('waterGoal')} 杯水，起来活动 ${stats.get('sitBreaks')} 次，专注 ${stats.get('focusMinutes')} 分钟，Claude Code 完成 ${stats.get('ccTasks')} 个任务。`,
    open.length ? `还有 ${open.length} 件待办，比如${firstTodos}。` : '待办都做完了。',
    `你（Clawd）现在 Lv.${p.level}，心情 ${p.mood}/100。`,
  ].join('');
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

function wireChat() {
  chat.on('start', () => pet.send('chat', { kind: 'start' }));
  chat.on('delta', (d) => panel.send('panel:chat-delta', d));
  chat.on('done', (d) => {
    pet.send('chat', { kind: 'done', text: d.text });
    progress.gain('pet');
  });
  chat.on('error', (d) => pet.send('chat', { kind: 'error', text: d.message }));
  chat.on('update', () => panel.push());
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
  progress = new Progress(data);
  chat = new Chat(settings, chatContext);
  updater = new Updater(settings, process.env.CLAWD_TEST && process.env.CLAWD_FAKE_UPDATER ? fakeAutoUpdater(process.env.CLAWD_FAKE_UPDATER) : null);
  sysmon = new SysMon();
  sysmon.on('sample', (smp) => {
    if (pet.isVisible()) pet.send('sys', smp);
    if (panel.alive()) panel.push();
  });
  menus = new Menus({ settings, pet, reminders, stats, actions, cc, dnd, todos });

  wireIpc();
  wireReminders();
  wireClaudeCode();
  wireTodos();
  wireProgress();
  wireChat();
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
      actions, settings, data, stats, pet, reminders, menus, cc, panel, panelState, dnd, winapi, todos, sysmon, progress, chat, updater,
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
