// 控制面板：设置页（照顾自己、外观与行为、Claude Code、勿扰、关于）
// 以前是 5 个单独的页面，现在是一页里的 5 个小节，顶上有小导航
(() => {
  'use strict';

  const {
    h, row, section, toggle, select, number, button, text, status, toast, act, ago, hhmm, parts, watch,
  } = window.ClawdPanel;
  parts.settings = parts.settings || [];
  const addPart = (p) => parts.settings.push(p);

  const S = (s) => s.settings;

  // 生日选择：月 + 日
  function birthdayPicker() {
    const month = h('select', {}, h('option', { value: '' }, '月'), ...Array.from({ length: 12 }, (_, i) => h('option', { value: String(i + 1).padStart(2, '0') }, `${i + 1} 月`)));
    const day = h('select', {}, h('option', { value: '' }, '日'), ...Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1).padStart(2, '0') }, `${i + 1} 日`)));
    const save = () => {
      if (month.value && day.value) act('setBirthday', `${month.value}-${day.value}`);
    };
    month.addEventListener('change', save);
    day.addEventListener('change', save);
    const clear = button('清除', () => act('setBirthday', ''), { disabled: (s) => !S(s).birthday });
    watch((s) => {
      const [m, d] = (S(s).birthday || '-').split('-');
      if (document.activeElement !== month) month.value = m || '';
      if (document.activeElement !== day) day.value = d || '';
    });
    return h('span', { class: 'ctrl' }, month, day, clear);
  }

  // ================= 外观与行为 =================
  addPart({
    id: 'look',
    order: 20,
    title: '外观与行为',
    render(el) {
      el.append(
        section('外观',
          row('大小', '中号 80×50，小号 64×40，大号 112×70', select([['small', '小'], ['medium', '中'], ['large', '大']], (s) => S(s).size, (v) => act('setSize', v))),
          row('头顶时钟', '时间、今日三环和连续打卡天数；点一下看详细进度', toggle((s) => S(s).clock, (v) => act('setFlag', 'clock', v))),
          row('整点报时', '每到整点跳一下报时', toggle((s) => S(s).chime, (v) => act('setFlag', 'chime', v)))),
        section('行为',
          row('散步模式', '站在任务栏上走来走去', toggle((s) => S(s).walk, (v) => act('setWalk', v))),
          row('爬窗口', '散步时能站到其他窗口顶上、偶尔跳上去，窗口拖动时跟着走（仅 Windows）',
            toggle((s) => S(s).climb !== false, (v) => act('setFlag', 'climb', v), { disabled: (s) => s.platform !== 'win32' })),
          row('总在最前', '不会被其他窗口挡住', toggle((s) => S(s).onTop, (v) => act('setOnTop', v))),
          row('开机自启', '用安装包装好的版本才能用',
            toggle((s) => s.autoStart, (v) => act('setAutoStart', v), { disabled: (s) => !s.isPackaged || s.platform === 'linux' }))),
        section('Clawd 本体',
          row(
            text((s) => (s.petVisible ? 'Clawd 正在桌面上' : 'Clawd 藏起来了')),
            '藏起来以后可以从这里或托盘叫回来',
            button((s) => (s.petVisible ? '藏起来' : '叫出来'), () => act('togglePet')),
          ),
          row('打个招呼', '让它在桌面上跳支舞', button('跳个舞', () => act('petCommand', 'dance')))),
        section('节日',
          h('div', { class: 'row' },
            h('div', { class: 'label' },
              h('b', {}, '节日自动换装'),
              text((s) => {
                const f = window.Clawd.outfits.festival(new Date(), S(s).birthday || '');
                return f ? `今天是${f.name}，戴${window.Clawd.outfits.ITEMS[f.hat].name}` : '元旦、春节、情人节、万圣节、圣诞、中秋、你的生日会自动戴上节日帽，戴过的收进衣柜';
              }, { class: 'small-muted' })),
            h('div', { class: 'ctrl' }, toggle((s) => S(s).festival !== false, (v) => act('setFlag', 'festival', v)))),
          row('你的生日', '那天 Clawd 会戴派对帽给你庆祝', birthdayPicker())),
        section('电脑状态',
          row('状态提醒', '电量低、CPU 一直很忙、内存快满时，Clawd 会流汗或者提醒你',
            toggle((s) => S(s).sysAlerts !== false, (v) => act('setFlag', 'sysAlerts', v))),
          row(
            text((s) => `CPU ${(s.sys && s.sys.cpu) || 0}%  ·  内存 ${(s.sys && s.sys.mem) || 0}%`, { class: 'mono' }),
            null,
            batteryText,
          )),
      );
    },
  });

  // 电量：面板自己用 Battery API 读
  const batteryText = h('span', { class: 'muted' }, '');
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const upd = () => {
        const pct = Math.round(b.level * 100);
        batteryText.textContent = b.charging && pct >= 100 ? '电量 100%（已接电源）' : `电量 ${pct}%${b.charging ? ' · 充电中' : ''}`;
      };
      b.addEventListener('levelchange', upd);
      b.addEventListener('chargingchange', upd);
      upd();
    }).catch(() => {});
  }

  // ================= 照顾自己（三环的目标 + 提醒） =================
  const intervalOptions = (unit = '分钟') => [[0, '关闭'], [20, `每 20 ${unit}`], [30, `每 30 ${unit}`], [45, `每 45 ${unit}`], [60, `每 60 ${unit}`], [90, `每 90 ${unit}`], [120, `每 120 ${unit}`]];

  function reminderStatus(s, kind) {
    const r = (s.reminders || {})[kind];
    if (!r || !r.interval) return ['', '已关闭'];
    if (r.pending) return ['warn', '现在就该提醒了'];
    if (r.paused) return ['', '勿扰中，提醒先攒着'];
    if (r.activity) return ['ok', `还要用电脑 ${Math.ceil(r.remaining / 60)} 分钟`];
    return ['ok', r.due ? `下次提醒 ${hhmm(r.due)}` : '计时中'];
  }

  const today = (s, key) => (s.today && s.today[key]) || 0;

  const care = (s) => S(s).care || {};
  const growthCfg = (s) => ((s.growth && s.growth.config) || {});

  addPart({
    id: 'care',
    order: 10,
    title: '照顾自己',
    render(el) {
      el.append(
        section('今日三环的目标',
          row('💧 喝水', '每天喝几杯', number((s) => S(s).waterGoal, (v) => act('setWaterGoal', v), { min: 1, max: 20, suffix: '杯' })),
          row('🚶 活动', '起来走走、看看远处，各算一次', number((s) => care(s).moveGoal || 4, (v) => act('careSet', { moveGoal: v }), { min: 1, max: 20, suffix: '次' })),
          row('⏱ 专注', '专注计时 + Claude Code 干活的时间', number((s) => care(s).focusGoal || 60, (v) => act('careSet', { focusGoal: v }), { min: 5, max: 600, step: 5, suffix: '分钟' })),
          row('周末休息不断签', '周六、周日没合环不算断', toggle((s) => growthCfg(s).weekendRest !== false, (v) => act('growthSet', { weekendRest: v }))),
          row('早安和晚间播报', '早上第一次见面打个招呼；晚上 8 点还没打卡会提醒一次', toggle((s) => growthCfg(s).morning !== false, (v) => act('growthSet', { morning: v })))),
        section('喝水提醒',
          row('提醒间隔', '到点 Clawd 举起水杯，点它就“喝掉”',
            select(intervalOptions(), (s) => (S(s).reminders || {}).water || 0, (v) => act('setReminder', 'water', v))),
          row(
            text((s) => `今天喝了 ${(s.today && s.today.water) || 0} / ${S(s).waterGoal} 杯`),
            null,
            status((s) => reminderStatus(s, 'water')),
            button('我刚喝过水', () => act('petCommand', 'drink')),
          )),
        section('久坐提醒',
          row('连续用电脑多久提醒', '只算你在用电脑的时间；离开 5 分钟就算活动过了，重新计时',
            select([[0, '关闭'], [30, '30 分钟'], [45, '45 分钟'], [60, '60 分钟'], [90, '90 分钟'], [120, '120 分钟']],
              (s) => (S(s).reminders || {}).sit || 0, (v) => act('setReminder', 'sit', v))),
          row(
            text((s) => {
              const r = (s.reminders || {}).sit || {};
              return r.interval ? `已经连续用了 ${Math.floor((r.active || 0) / 60)} 分钟` : '久坐提醒已关闭';
            }),
            text((s) => `今天起来活动了 ${today(s, 'sitBreaks')} 次`),
            status((s) => reminderStatus(s, 'sit')),
          )),
        section('护眼提醒',
          row('20-20-20 护眼', '每用 20 分钟电脑，看 6 米外的地方 20 秒；点 Clawd 开始倒计时',
            toggle((s) => ((S(s).reminders || {}).eye || 0) > 0, (v) => act('setReminder', 'eye', v ? 20 : 0))),
          row(
            text((s) => `今天让眼睛休息了 ${today(s, 'eyeBreaks')} 次`),
            null,
            status((s) => reminderStatus(s, 'eye')),
          )),
      );
    },
  });

  // ================= Claude Code =================
  function ccStatus(s) {
    const c = s.cc || {};
    if (c.error) return ['err', '读取 Claude Code 设置出错'];
    if (!c.enabled) return ['', '联动已关闭'];
    if (!c.listening) return ['err', c.serverError || '本机服务没有启动'];
    if (!c.installed) return ['warn', '还没接入 Claude Code'];
    if (c.stale) return ['warn', '端口改过，需要重新接入'];
    if (c.outdated) return ['warn', '有新功能（测试结果），点「重新接入」补上'];
    if (c.active) return ['ok', `已接入 · ${c.active} 个任务进行中`];
    return ['ok', '已接入'];
  }

  addPart({
    id: 'claude',
    order: 30,
    title: 'Claude Code',
    desc: 'Claude Code 干活时 Clawd 陪着敲键盘，做完了跳起来喊你，等你批准时举手；干活的时间也算进专注环',
    render(el) {
      const cfg = (s) => S(s).claudeCode || {};
      const rh = (s) => ((s.rhythm && s.rhythm.config) || {});
      el.append(
        section('状态',
          h('div', { class: 'hero' },
            h('div', {},
              h('div', { class: 'big' }, status(ccStatus)),
              text((s) => `最近一次收到 Claude Code 的消息：${ago((s.cc || {}).lastEventAt)}`, { class: 'muted' })),
            h('div', { class: 'spacer' }),
            button((s) => ((s.cc || {}).installed && !(s.cc || {}).stale ? '重新接入' : '一键接入'), async () => {
              const r = await act('ccInstall');
              if (r && !r.error) toast('已写入 Claude Code 设置，马上生效');
            }, { primary: true, disabled: (s) => !(s.cc || {}).enabled }),
            button('移除', async () => {
              const r = await act('ccUninstall');
              if (r && !r.error) toast('已从 Claude Code 设置里移除');
            }, { danger: true, disabled: (s) => !(s.cc || {}).installed })),
          h('div', { class: 'note' },
            '接入会在 ', text((s) => (s.cc || {}).settingsFile || '~/.claude/settings.json', { class: 'mono' }),
            ' 里加几条 hooks（改之前会备份成 settings.json.clawd-backup），让 Claude Code 把开始、用工具、等确认、完成这些事件发到本机的 Clawd。只在你自己的电脑上传递，不联网。')),
        section('选项',
          row('开启联动', '关掉后 Clawd 不再接收 Claude Code 的消息', toggle((s) => cfg(s).enabled, (v) => act('ccSet', { enabled: v }))),
          row('显示正在用的工具', '气泡里显示 “Edit main.js”、“Bash npm test” 这类信息', toggle((s) => cfg(s).tools, (v) => act('ccSet', { tools: v }))),
          row('系统通知', '完成、等你批准、出错时弹 Windows 通知', toggle((s) => cfg(s).notify, (v) => act('ccSet', { notify: v }))),
          row('完成通知门槛', '任务超过这么久才弹“完成”通知，短任务不打扰',
            number((s) => cfg(s).notifyMinSec, (v) => act('ccSet', { notifyMinSec: v }), { min: 0, max: 3600, suffix: '秒' })),
          row('本机端口', '一般不用改；改了之后要重新接入',
            number((s) => cfg(s).port, (v) => act('ccSet', { port: v }), { min: 1024, max: 65535 }))),
        section('Claude 干活，你休息',
          row('一个会话一只 Clawd', '同时开几个 Claude Code，旁边就多几只小 Clawd，头顶写项目名，各干各的（最多再来 3 只）',
            toggle((s) => cfg(s).crew !== false, (v) => act('ccSet', { crew: v }))),
          row('趁 Claude 跑的时候提醒休息', '喝水、活动、护眼到点时：你正在操作就先等等（最多 10 分钟）；Claude 跑长任务、你手离开键盘时提前提醒',
            toggle((s) => rh(s).smartBreaks !== false, (v) => act('rhythmSet', { smartBreaks: v }))),
          row('叫你回来', '离开电脑时记下 Claude 做了什么、谁在等你；回来时告诉你。等批准 2 分钟、10 分钟各再提醒一次',
            toggle((s) => rh(s).recall !== false, (v) => act('rhythmSet', { recall: v }))),
          row('提示音', 'Claude 等你批准、或者你不在时做完了，轻轻响一声（勿扰时不响）',
            toggle((s) => rh(s).sound !== false, (v) => act('rhythmSet', { sound: v })))),
        section('试一试',
          row('演示一遍', '假装同时跑了两个任务：看小 Clawd 怎么翻代码、跑测试、等批准、庆祝', button('开始演示', () => act('ccDemo'))),
          row('打开设置文件位置', null, button('打开文件夹', () => act('ccReveal')))),
        h('p', { class: 'muted', style: 'font-size:12.5px' },
          '提示：如果你在 WSL 里用 Claude Code，需要在 WSL 的 ~/.claude/settings.json 里手动加 hooks，地址用 Windows 主机的 IP。没开 Clawd 时 Claude Code 可能会显示一行 “hook error”，不影响使用。'),
      );
    },
  });

  // ================= 关于 =================
  function updateStatus(s) {
    const u = s.update || {};
    if (!u.supported) return ['', '开发模式下不检查更新（用安装包装好的版本才行）'];
    if (!u.repo) return ['warn', '还没设置发布新版本的 GitHub 仓库'];
    switch (u.phase) {
      case 'checking': return ['', '正在检查…'];
      case 'downloading': return ['', `发现 v${u.version}，下载中 ${u.percent || 0}%`];
      case 'ready': return ['ok', `v${u.version} 已下载，退出时自动安装`];
      case 'latest': return ['ok', `已经是最新版（${hhmm(u.checkedAt)} 检查过）`];
      case 'error': return ['err', u.error || '检查失败'];
      default: return ['', '会在启动后和每 6 小时自动检查一次'];
    }
  }

  function repoInput() {
    const input = h('input', { type: 'text', placeholder: 'owner/repo', class: 'mono', spellcheck: 'false' });
    const save = h('button', { class: 'btn' }, '保存');
    save.addEventListener('click', async () => {
      const r = await act('updateSet', { repo: input.value });
      if (r && !r.error) toast('已保存');
    });
    watch((s) => { if (document.activeElement !== input) input.value = (s.update && s.update.repo) || ''; });
    return h('span', { class: 'ctrl' }, input, save);
  }

  addPart({
    id: 'about',
    order: 50,
    title: '关于和更新',
    render(el) {
      el.append(
        section('',
          row('版本', null, text((s) => `v${s.version}`, { class: 'mono' })),
          row('数据文件夹', '设置、统计、日志（clawd.log）都存在这里', button('打开', () => act('openDataDir')))),
        section('更新',
          row(status(updateStatus), null,
            button('检查更新', async () => {
              const r = await act('updateCheck');
              if (r && !r.error) toast('开始检查');
            }, { disabled: (s) => !(s.update && s.update.supported && s.update.repo) }),
            button('重启并更新', () => act('updateInstall'), { primary: true, disabled: (s) => !(s.update && s.update.phase === 'ready') })),
          row('自动检查更新', '有新版本就在后台下载，退出时安装',
            toggle((s) => (s.update ? s.update.auto !== false : true), (v) => act('updateSet', { auto: v }))),
          row('发布仓库', '新版本的安装包放在这个 GitHub 仓库的 Releases 里', repoInput())),
        h('p', { class: 'muted', style: 'font-size:12.5px' }, '非官方粉丝作品，仅供个人使用。'),
      );
    },
  });
})();

// ================= 勿扰 =================
(() => {
  'use strict';

  const {
    h, row, section, toggle, select, button, status, hhmm, addTab, act, parts, watch,
  } = window.ClawdPanel;

  const REASON = {
    fullscreen: '检测到全屏程序',
    game: '检测到全屏游戏',
    presentation: '演示模式中',
    manual: '手动勿扰',
  };

  function dndStatus(s) {
    const d = s.dnd || {};
    if (!d.active) return ['', '没有勿扰'];
    if (d.reason === 'manual') return ['warn', `手动勿扰到 ${hhmm(d.manualUntil)}`];
    const what = d.title ? `（${d.title.slice(0, 30)}）` : '';
    return ['warn', `${REASON[d.reason] || '勿扰中'}${what}`];
  }

  parts.settings.push({
    id: 'dnd',
    order: 40,
    title: '勿扰',
    desc: '看视频、玩游戏、开会时 Clawd 自动躲起来，提醒也先攒着',
    render(el) {
      const d = (s) => s.dnd || {};
      el.append(
        section('现在',
          row(status(dndStatus), '勿扰期间不弹通知，提醒暂停，结束后补上',
            button('结束勿扰', () => act('dndManual', 0), { disabled: (s) => !d(s).manualUntil }))),
        section('自动勿扰',
          row('全屏时自动勿扰', '全屏视频、全屏游戏、PPT 放映时自动开启（仅 Windows）',
            toggle((s) => d(s).auto, (v) => act('dndSet', { auto: v }), { disabled: (s) => !d(s).supported })),
          row('勿扰时 Clawd', '藏起来，或者变淡留在原地、不说话',
            select([['hide', '藏起来'], ['quiet', '变淡、不说话']], (s) => d(s).action, (v) => act('dndSet', { action: v })))),
        section('手动勿扰',
          h('div', { class: 'row' },
            h('div', { class: 'label' }, h('b', {}, '开会、专心做事时用'), h('small', {}, '到时间自动结束')),
            h('div', { class: 'ctrl' },
              button('30 分钟', () => act('dndManual', 30)),
              button('1 小时', () => act('dndManual', 60)),
              button('2 小时', () => act('dndManual', 120)),
              button('到明早', () => act('dndManual', 'tomorrow'))))),
      );
    },
  });
})();

// ================= 设置页：把上面几个小节放在一页里 =================
(() => {
  'use strict';

  const { h, addTab, parts } = window.ClawdPanel;

  addTab({
    id: 'settings',
    order: 40,
    title: '设置',
    icon: 'general',
    subtitle: '目标、提醒、外观、Claude Code、勿扰',
    render(el) {
      const list = [...(parts.settings || [])].sort((a, b) => a.order - b.order);
      const main = document.getElementById('main');
      const chips = list.map((p) => {
        const b = h('button', { class: 'chip-btn' }, p.title);
        b.addEventListener('click', () => {
          const t = el.querySelector(`[data-anchor="${p.id}"]`);
          if (t) main.scrollTo({ top: t.offsetTop - 64, behavior: 'smooth' });
        });
        return b;
      });
      el.append(h('div', { class: 'subnav' }, chips));
      for (const p of list) {
        const box = h('div', { class: 'part', 'data-anchor': p.id },
          h('h1', { class: 'part-title' }, p.title),
          p.desc ? h('p', { class: 'part-desc' }, p.desc) : null);
        p.render(box);
        el.append(box);
      }
    },
  });
})();
