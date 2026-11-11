// 右键菜单和托盘菜单
const { app, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('path');
const { IS_LINUX, pad2 } = require('./config');

const ROOT = path.join(__dirname, '..', '..');

function hhmm(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

class Menus {
  // deps: { settings, pet, reminders, stats, actions }
  constructor(deps) {
    Object.assign(this, deps);
    this.tray = null;
  }

  // 一个“提醒”子菜单：喝水 / 久坐 / 护眼
  remindersMenu() {
    const { reminders, actions } = this;
    const goal = this.settings.get('waterGoal');
    const radios = (kind, options) => options.map((m) => ({
      label: m ? `每 ${m} 分钟` : '关闭',
      type: 'radio',
      checked: reminders.interval(kind) === m,
      click: () => actions.setReminder(kind, m),
    }));
    const water = reminders.status('water');
    let waterStatus = '已关闭';
    if (water.pending) waterStatus = '现在就该喝水啦';
    else if (water.due) waterStatus = `下次 ${hhmm(water.due)}`;
    const sit = reminders.status('sit');
    const sitStatus = sit.interval ? `已连续用电脑 ${Math.floor(sit.active / 60)} 分钟` : '已关闭';
    return {
      label: '提醒',
      submenu: [
        { label: `我刚喝过水（今天 ${this.stats.get('water')}/${goal} 杯）`, click: () => this.pet.send('menu', 'drink') },
        { type: 'separator' },
        { label: `喝水（${waterStatus}）`, submenu: radios('water', [30, 45, 60, 90, 0]) },
        { label: `久坐（${sitStatus}）`, submenu: radios('sit', [30, 45, 60, 90, 0]) },
        {
          label: '护眼 20-20-20',
          type: 'checkbox',
          checked: reminders.interval('eye') > 0,
          click: (i) => actions.setReminder('eye', i.checked ? 20 : 0),
        },
        { type: 'separator' },
        { label: '提醒设置…', click: () => actions.openPanel('reminders') },
      ],
    };
  }

  claudeCodeMenu() {
    const { cc, actions } = this;
    const st = cc.status();
    const cfg = cc.config();
    let status;
    if (st.error) status = '读取 Claude Code 设置出错';
    else if (!cfg.enabled) status = '联动已关闭';
    else if (!st.listening) status = st.serverError || '本机服务没有启动';
    else if (!st.installed) status = '还没接入';
    else if (st.stale) status = '端口变了，需要重新接入';
    else if (st.active) status = `已接入 ✓ · ${st.active} 个任务进行中`;
    else status = '已接入 ✓';

    return {
      label: 'Claude Code 联动',
      submenu: [
        { label: status, enabled: false },
        { type: 'separator' },
        st.installed && !st.stale
          ? { label: '重新接入', click: () => actions.ccInstall() }
          : { label: '一键接入 Claude Code', click: () => actions.ccInstall() },
        { label: '移除接入', enabled: st.installed, click: () => actions.ccUninstall() },
        { type: 'separator' },
        { label: '显示正在用的工具', type: 'checkbox', checked: cfg.tools, click: (i) => actions.ccSet({ tools: i.checked }) },
        { label: '完成 / 等确认时弹通知', type: 'checkbox', checked: cfg.notify, click: (i) => actions.ccSet({ notify: i.checked }) },
        { label: '打开 Claude Code 设置文件位置', click: () => shell.showItemInFolder(st.settingsFile) },
        { label: '更多设置…', click: () => actions.openPanel('claude') },
      ],
    };
  }

  dndMenu() {
    const { dnd, actions } = this;
    const st = dnd.status();
    const REASON = { fullscreen: '检测到全屏程序', game: '检测到全屏游戏', presentation: '演示模式中', manual: '' };
    let status = '没有勿扰';
    if (st.reason === 'manual') status = `勿扰到 ${hhmm(st.manualUntil)}`;
    else if (st.active) status = `${REASON[st.reason] || '勿扰中'}，自动勿扰`;
    return {
      label: st.active ? '勿扰（进行中）' : '勿扰',
      submenu: [
        { label: status, enabled: false },
        { type: 'separator' },
        { label: '30 分钟', click: () => actions.dndManual(30) },
        { label: '1 小时', click: () => actions.dndManual(60) },
        { label: '2 小时', click: () => actions.dndManual(120) },
        { label: '到明天早上', click: () => actions.dndManual('tomorrow') },
        { label: '结束勿扰', enabled: !!st.manualUntil, click: () => actions.dndManual(0) },
        { type: 'separator' },
        { label: '全屏时自动勿扰', type: 'checkbox', checked: st.auto, enabled: st.supported, click: (i) => actions.dndSet({ auto: i.checked }) },
      ],
    };
  }

  // 开机自启只在打包后的版本里提供（开发模式下注册的是 electron 本体，没意义）
  autoStartItem() {
    if (!app.isPackaged || IS_LINUX) return [];
    return [{
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    }];
  }

  // state 来自页面：{ focusing, focusLeft }
  popupPet(state = {}) {
    if (!this.pet.alive()) return;
    const { settings, actions } = this;
    const send = (cmd) => this.pet.send('menu', cmd);

    const focusItem = state.focusing
      ? { label: `停止专注（还剩 ${state.focusLeft || ''}）`, click: () => send('focus-stop') }
      : {
        label: '专注计时',
        submenu: [25, 45, 15, 5].map((m) => ({ label: `${m} 分钟`, click: () => send(`focus-${m}`) })),
      };

    // 正在提醒某条待办：菜单最上面可以完成 / 稍后
    const t = state.todo && this.todos.find(state.todo);
    const todoItems = t && !t.done ? [
      { label: `✓ 完成：${t.text.length > 18 ? `${t.text.slice(0, 17)}…` : t.text}`, click: () => actions.todoDone(t.id) },
      { label: '⏰ 10 分钟后再提醒', click: () => actions.todoSnooze(t.id, 10) },
      { label: '⏰ 1 小时后再提醒', click: () => actions.todoSnooze(t.id, 60) },
      { type: 'separator' },
    ] : [];

    const template = [
      ...todoItems,
      { label: '控制面板…', click: () => actions.openPanel() },
      { label: '和 Clawd 聊天…', click: () => actions.openPanel('chat') },
      { label: `待办${this.todos.open().length ? `（${this.todos.open().length}）` : ''}…`, click: () => actions.openPanel('todo') },
      { type: 'separator' },
      { label: '摸摸头', click: () => send('pet') },
      { label: '跳个舞', click: () => send('dance') },
      { type: 'separator' },
      this.claudeCodeMenu(),
      this.remindersMenu(),
      focusItem,
      this.dndMenu(),
      {
        label: '时间',
        submenu: [
          { label: '显示时钟', type: 'checkbox', checked: settings.get('clock'), click: (i) => actions.setFlag('clock', i.checked) },
          { label: '整点报时', type: 'checkbox', checked: settings.get('chime'), click: (i) => actions.setFlag('chime', i.checked) },
        ],
      },
      { type: 'separator' },
      { label: '散步模式', type: 'checkbox', checked: settings.get('walk'), click: (i) => actions.setWalk(i.checked) },
      {
        label: '大小',
        submenu: [['small', '小'], ['medium', '中'], ['large', '大']].map(([k, label]) => ({
          label,
          type: 'radio',
          checked: settings.get('size') === k,
          click: () => actions.setSize(k),
        })),
      },
      { label: '总在最前', type: 'checkbox', checked: settings.get('onTop'), click: (i) => actions.setOnTop(i.checked) },
      ...this.autoStartItem(),
      { type: 'separator' },
      { label: '藏到托盘', click: () => this.pet.hide() },
      { label: '退出', click: () => app.quit() },
    ];
    Menu.buildFromTemplate(template).popup({ window: this.pet.win });
  }

  createTray() {
    const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
    this.tray = new Tray(icon);
    this.tray.setToolTip('Clawd');
    this.tray.on('click', () => this.pet.toggle());
    this.refreshTray();
  }

  refreshTray() {
    if (!this.tray) return;
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 / 隐藏 Clawd', click: () => this.pet.toggle() },
      { label: '控制面板…', click: () => this.actions.openPanel() },
      { label: '我刚喝过水', click: () => this.pet.send('menu', 'drink') },
      { label: '散步模式', type: 'checkbox', checked: this.settings.get('walk'), click: (i) => this.actions.setWalk(i.checked) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]));
  }
}

module.exports = { Menus };
