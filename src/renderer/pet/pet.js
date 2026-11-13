// Clawd 的行为：状态机、动画姿势、提醒、鼠标互动
(() => {
  'use strict';

  const C = (window.Clawd = window.Clawd || {});
  const { sprite, ui } = C;
  const { LINES, FOCUS_VERBS, rand, pick, greeting, clickLine, hourLine, mmss } = C.lines;
  const { bubble, clock, particle } = ui;

  // 在 Electron 里用 preload 暴露的 API；直接用浏览器打开页面时用一个假的，方便预览
  const api = window.clawd || createMockApi();

  // ================= 画布 =================
  const root = document.documentElement;
  const petEl = document.getElementById('pet');
  const canvas = document.getElementById('sprite');
  const ctx = canvas.getContext('2d');
  const propEl = document.getElementById('prop');
  const propCtx = propEl.getContext('2d');
  const hatEl = document.getElementById('hat');
  const hatCtx = hatEl.getContext('2d');
  const giftEl = document.getElementById('gift');
  const giftCtx = giftEl.getContext('2d');
  const { outfits } = C;

  let scale = 7;
  let dpr = window.devicePixelRatio || 1;
  let lastPoseKey = '';
  let lastPropKey = '';

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    const w = sprite.GRID_W * scale;
    const h = sprite.GRID_H * scale;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    root.style.setProperty('--s', `${scale}px`);
    root.style.setProperty('--pw', `${w}px`);
    root.style.setProperty('--ph', `${h}px`);
    propEl.width = Math.round(sprite.CUP_W * scale * dpr);
    propEl.height = Math.round(sprite.CUP_H * scale * dpr);
    propEl.style.width = `${sprite.CUP_W * scale}px`;
    propEl.style.height = `${sprite.CUP_H * scale}px`;
    hatEl.width = Math.round(outfits.HAT_W * scale * dpr);
    hatEl.height = Math.round(outfits.HAT_H * scale * dpr);
    hatEl.style.width = `${outfits.HAT_W * scale}px`;
    hatEl.style.height = `${outfits.HAT_H * scale}px`;
    // 礼物盒比小人小一点
    const gs = Math.max(3, Math.round(scale * 0.75));
    giftEl.width = Math.round(sprite.GIFT_W * gs * dpr);
    giftEl.height = Math.round(sprite.GIFT_H * gs * dpr);
    giftEl.style.width = `${sprite.GIFT_W * gs}px`;
    giftEl.style.height = `${sprite.GIFT_H * gs}px`;
    root.style.setProperty('--gw', `${sprite.GIFT_W * gs}px`);
    lastGiftKey = '';
    lastPoseKey = '';
    lastPropKey = '';
    lastHatKey = '';
  }

  // ================= 装扮 =================
  let lastHatKey = '';
  let outfitCache = { at: 0, value: { hat: '', face: '', festival: null } };

  // 今天穿什么：节日帽优先，其次是衣柜里选的
  function currentOutfit() {
    const now = Date.now();
    if (now - outfitCache.at < 1000) return outfitCache.value;
    const fest = S.settings.festival !== false ? outfits.festival(new Date(), S.settings.birthday || '') : null;
    const o = S.settings.outfit || {};
    const unlocked = S.settings.unlocked || [];
    const pickId = (id) => (id && id !== 'none' && outfits.ITEMS[id] && unlocked.includes(id) ? id : '');
    const value = {
      hat: (fest && fest.hat) || pickId(o.hat),
      face: pickId(o.face),
      festival: fest,
    };
    outfitCache = { at: now, value };
    return value;
  }

  // 头顶的帽子跟着身体上下动（呼吸、坐下）
  function drawHat(hat, pose) {
    const top = (pose.sit ? 2 : 0) + (pose.squish ? 1 : 0);
    const key = `${hat}|${top}|${scale}`;
    if (key === lastHatKey) return;
    lastHatKey = key;
    hatEl.classList.toggle('show', !!hat);
    root.style.setProperty('--hat-h', hat ? `${(outfits.HAT_H - outfits.HAT_OVERLAP) * scale}px` : '0px');
    if (!hat) return;
    hatEl.style.transform = `translateY(${top * scale}px)`;
    sprite.paint(hatCtx, outfits.HAT_W, outfits.HAT_H, outfits.hatPixels(hat));
  }

  // 遇到节日：告诉主进程（节日帽收进衣柜 + 经验）
  let festivalReportedOn = '';
  function reportFestival() {
    const f = currentOutfit().festival;
    const today = new Date().toDateString();
    if (!f || festivalReportedOn === today || !api.festivalSeen) return;
    festivalReportedOn = today;
    api.festivalSeen({ id: f.id, hat: f.hat });
  }

  // 节日问候：每天第一次见面说一次
  let festivalSaidOn = '';
  function festivalGreeting() {
    const f = currentOutfit().festival;
    const today = new Date().toDateString();
    if (!f || festivalSaidOn === today) return null;
    festivalSaidOn = today;
    return f.line;
  }

  // 当前皮肤（小卖部买的 / 打卡和成就解锁的）
  function skinId() {
    const g = S.settings.growth || {};
    return g.skin && sprite.SKINS[g.skin] ? g.skin : 'classic';
  }

  function draw(pose) {
    const p = { ...pose, skin: skinId() };
    const key = JSON.stringify(p);
    if (key === lastPoseKey) return;
    lastPoseKey = key;
    sprite.paint(ctx, sprite.GRID_W, sprite.GRID_H, sprite.pixels(p));
  }

  // prop: null（不拿东西）、水杯 { level, bottom } 或零食 { snack, bites, bottom }，bottom 以像素格为单位
  function drawProp(prop) {
    const key = prop ? `${prop.snack || 'cup'}|${prop.snack ? prop.bites : prop.level}|${prop.bottom}` : 'none';
    if (key === lastPropKey) return;
    lastPropKey = key;
    propEl.classList.toggle('show', !!prop);
    if (!prop) return;
    propEl.style.bottom = `${prop.bottom * scale}px`;
    sprite.paint(propCtx, sprite.CUP_W, sprite.CUP_H, prop.snack ? sprite.snackPixels(prop.snack, prop.bites) : sprite.cupPixels(prop.level));
  }

  // 礼物盒：放在小人左边的地上
  let lastGiftKey = '';
  function drawGift() {
    const show = !!S.gift && !S.walking && ['idle', 'react', 'dance', 'sit', 'sleep', 'eat', 'wave'].includes(S.mode);
    const open = !!S.giftOpening;
    const key = `${show}|${open}`;
    if (key === lastGiftKey) return;
    lastGiftKey = key;
    giftEl.classList.toggle('show', show);
    giftEl.classList.toggle('opening', open);
    if (show) sprite.paint(giftCtx, sprite.GIFT_W, sprite.GIFT_H, sprite.giftPixels(open));
  }

  // ================= 状态 =================
  const SLEEP_AFTER_S = 90; // 电脑空闲多久后睡觉
  const TIMED_MODES = ['react', 'dance', 'drink', 'stretch', 'yawn', 'wave', 'sit', 'sulk', 'eat']; // 到时间自动回到 idle 的模式
  const EAT_MS = 2600;
  const IDLE_ACTS = ['yawn', 'wave', 'sit', 'sulk']; // 闲着时的小动作：有正事就马上停
  const EYE_REST_MS = 20000;

  const S = {
    settings: { size: 'medium', walk: false, onTop: true, clock: true, chime: true, sysAlerts: true },
    mode: 'idle', // idle | drag | fall | sleep | react | dance | drink
    modeUntil: 0,
    grounded: false,
    walking: false,
    walkUntil: 0,
    restUntil: 0,
    dir: 1,
    moveInflight: false,
    lastStep: 0,
    look: 0,
    cursorLook: 0,
    glance: 0,
    glanceUntil: 0,
    nextBlink: performance.now() + rand(1500, 4000),
    blinkUntil: 0,
    wideUntil: 0,
    idleSecs: 0,
    hoverSince: 0,
    focus: null, // { end, min }
    reminders: {}, // kind -> { line, lastNag }
    todoQueue: [], // 到点的待办 [{ id, text, remindAt }]
    cc: { active: 0, top: null }, // Claude Code 的状态（主进程发来）
    ccDismissed: '', // 点过“知道了”的那次等待确认
    ccLastNag: 0,
    lastHour: new Date().getHours(),
    nextIdleAct: performance.now() + rand(20000, 45000), // 下次闲着做小动作的时间
    cursorRel: null, // 鼠标相对小人头顶中心的位置 { x, y }
    chasing: false,
    chaseUntil: 0,
    nextChase: performance.now() + 8000,
    nextClimb: performance.now() + 15000, // 下次试着跳上窗口的时间
    lookUpUntil: 0,
    lastZ: 0,
    lastNote: 0,
    lastHeart: 0,
  };

  function setMode(mode, ms = 0) {
    S.mode = mode;
    S.modeUntil = performance.now() + ms;
    petEl.classList.remove('jump', 'dance', 'wiggle', 'land', 'stretch');
    void petEl.offsetWidth; // 重启 CSS 动画
    if (mode === 'react') petEl.classList.add('jump');
    if (mode === 'dance') petEl.classList.add('dance');
    if (mode === 'drag') petEl.classList.add('wiggle');
    if (mode === 'stretch' || mode === 'yawn') petEl.classList.add('stretch');
    if (mode !== 'idle') {
      S.walking = false;
      S.chasing = false;
    }
  }

  function bump(cls) {
    petEl.classList.remove(cls);
    void petEl.offsetWidth;
    petEl.classList.add(cls);
  }
  petEl.addEventListener('animationend', (e) => {
    if (e.animationName === 'land' || e.animationName === 'jump') petEl.classList.remove('land', 'jump');
  });

  // ================= 提醒 =================
  // 每种提醒在小人身上怎么表现。priority 越大越优先显示。
  const DRINK_MS = 1800;
  const REMINDERS = {
    water: {
      priority: 30,
      line: () => pick(LINES.water),
      dim: '点我喝一口',
      pose: (p) => ({ ...p, look: 1, armR: 'mid' }),
      prop: (pose) => ({ level: 3, bottom: pose.squish ? 2 : 3 }),
      nag: '💧',
      act: () => drink(),
    },
    sit: {
      priority: 25,
      line: () => pick(LINES.sit),
      dim: '点我一起伸懒腰',
      pose: (p) => ({ ...p, armL: 'mid', armR: 'mid', look: 0 }),
      nag: '↑',
      act: () => stretch(),
    },
    todo: {
      priority: 40,
      text: () => `⏰ ${S.todoQueue[0] ? S.todoQueue[0].text : ''}`,
      dimFn: () => (S.todoQueue.length > 1 ? `点我完成 · 还有 ${S.todoQueue.length - 1} 条` : '点我完成 · 右键稍后'),
      pose: (p) => ({ ...p, armR: 'up', look: 0 }),
      nag: '⏰',
      act: () => completeTodo(),
    },
    eye: {
      priority: 20,
      line: () => pick(LINES.eye),
      dim: '点我开始 20 秒',
      pose: (p) => ({ ...p, eyes: p.eyes === 'blink' ? 'blink' : 'up' }),
      nag: '👀',
      act: () => startEyeRest(),
    },
  };

  // 现在要显示哪个提醒（专注时、睡觉时、正在处理提醒时先不打扰）
  function activeReminder() {
    if (S.focus || ['sleep', 'drink', 'stretch', 'eyeRest'].includes(S.mode)) return null;
    let best = null;
    for (const kind of Object.keys(S.reminders)) {
      const view = REMINDERS[kind];
      if (view && (!best || view.priority > REMINDERS[best].priority)) best = kind;
    }
    return best;
  }

  function onReminder(d = {}) {
    if (!REMINDERS[d.kind]) return;
    if (!d.due) {
      delete S.reminders[d.kind];
      // 提醒之后离开了电脑（起来活动过了）：回来时夸一句
      if (d.away && d.kind === 'sit') S.praiseOnWake = true;
      return;
    }
    const view = REMINDERS[d.kind];
    S.reminders[d.kind] = { line: view.line(), lastNag: performance.now() };
    if (activeReminder() === d.kind && S.mode === 'idle') {
      bump('jump');
      particle(view.nag, 'drop', 0.9);
    }
  }

  async function drink() {
    delete S.reminders.water;
    setMode('drink', DRINK_MS);
    for (let i = 0; i < 3; i++) setTimeout(() => particle('💧', 'drop', rand(0.75, 1.05)), 250 + i * 420);
    let res = { count: 1, goal: 8 };
    try {
      res = (await api.reminderDone('water')) || res;
    } catch {
      // 忽略
    }
    const done = res.count >= res.goal;
    bubble.say(`咕嘟咕嘟… 今天第 ${res.count}/${res.goal} 杯 ✓${done ? ' 目标达成！' : ''}`, 3800);
  }

  // ---- 待办 ----
  function onTodo(d = {}) {
    if (d.kind === 'due' && d.todo) {
      if (!S.todoQueue.some((t) => t.id === d.todo.id)) S.todoQueue.push(d.todo);
      const first = !S.reminders.todo;
      S.reminders.todo = { line: '', lastNag: performance.now() };
      if (first && !d.quiet && activeReminder() === 'todo' && S.mode === 'idle') {
        bump('jump');
        particle('⏰', 'spark', 0.5);
      }
    } else if (d.kind === 'clear') {
      S.todoQueue = S.todoQueue.filter((t) => t.id !== d.id);
      if (!S.todoQueue.length) delete S.reminders.todo;
    }
  }

  async function completeTodo() {
    const t = S.todoQueue.shift();
    if (!S.todoQueue.length) delete S.reminders.todo;
    if (!t) return;
    setMode('react', 650);
    for (let i = 0; i < 3; i++) setTimeout(() => particle('✓', 'spark', rand(0.2, 0.8)), i * 150);
    let r = { left: 0 };
    try { r = (await api.todoDone(t.id)) || r; } catch { /* 忽略 */ }
    bubble.say(r.left ? `✓ 搞定一件！还剩 ${r.left} 件` : '✓ 待办全部清空，太棒了！', 3500);
  }

  // 久坐：一起伸懒腰
  async function stretch() {
    delete S.reminders.sit;
    setMode('stretch', 2400);
    bubble.say(pick(LINES.sitDone), 3000);
    for (let i = 0; i < 3; i++) setTimeout(() => particle('✦', 'spark', rand(0.1, 0.9)), 300 + i * 400);
    try { await api.reminderDone('sit'); } catch { /* 忽略 */ }
  }

  // 护眼：一起看远处 20 秒（气泡里倒计时）
  function startEyeRest() {
    delete S.reminders.eye;
    setMode('eyeRest', EYE_REST_MS);
  }

  async function finishEyeRest() {
    setMode('react', 650);
    bubble.say(pick(LINES.eyeDone), 3000);
    try { await api.reminderDone('eye'); } catch { /* 忽略 */ }
  }

  // 一直没处理：每 30 秒跳一下提醒你
  function nagReminders(now) {
    const kind = activeReminder();
    if (!kind || S.mode !== 'idle') return;
    const r = S.reminders[kind];
    if (now - r.lastNag > 30000) {
      r.lastNag = now;
      bump('jump');
      particle(REMINDERS[kind].nag, 'drop', 0.9);
    }
  }

  // ================= Claude Code 联动 =================
  const ccKey = (top) => (top ? `${top.project}|${top.since}|${top.message}` : '');

  function ccWaiting() {
    const top = S.cc.top;
    return !!(top && top.state === 'waiting' && ccKey(top) !== S.ccDismissed);
  }

  function ccWorking() {
    return !!(S.cc.top && S.cc.top.state === 'working');
  }

  function fmtTook(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  }

  function onCC(d = {}) {
    if (d.kind === 'sessions') {
      const wasWaiting = ccWaiting();
      S.cc = { active: d.active || 0, top: d.top || null };
      if (ccWaiting() && !wasWaiting) {
        // 正在庆祝（任务、成就…）：先让位给“等你批准”，庆祝放回队列，批准完再说
        if (S.announcing && performance.now() < S.announcing.until) {
          bubble.hush();
          S.announces.unshift({ ...S.announcing.a, notBefore: 0 });
          if (S.mode === 'dance') setMode('idle');
        }
        S.announcing = null;
        if (S.mode === 'sleep') wakeUp();
        S.wideUntil = performance.now() + 900;
        S.ccLastNag = performance.now();
        if (S.mode === 'idle') bump('jump');
        particle('!', 'spark', 0.5);
      }
      return;
    }
    if (d.kind !== 'event') return;
    if (d.type === 'done') {
      if (S.mode === 'sleep') wakeUp();
      setMode('react', 650);
      setTimeout(() => { if (S.mode === 'idle' || S.mode === 'react') dance(2200); }, 650);
      const where = d.project ? `${d.project} · ` : '';
      bubble.say(`✓ ${pick(LINES.ccDone)} ${where}${fmtTook(d.took || 0)}`, 6000);
      for (let i = 0; i < 4; i++) setTimeout(() => particle('✦', 'spark', rand(0.1, 0.9)), i * 150);
    } else if (d.type === 'error') {
      if (S.mode === 'sleep') wakeUp();
      S.wideUntil = performance.now() + 1500;
      bubble.say(`出错了：${d.message || 'Claude Code 停下了'}`, 6000);
    }
  }

  // 等确认时一直没理：每 20 秒挥手跳一下
  function nagClaudeCode(now) {
    if (!ccWaiting() || S.mode !== 'idle') return;
    if (now - S.ccLastNag > 20000) {
      S.ccLastNag = now;
      bump('jump');
      particle('!', 'spark', 0.5);
    }
  }

  // ================= 电脑状态 =================
  const SYS = {
    cpu: 0,
    mem: 0,
    hotSince: 0,
    hot: false,
    lastHotSay: -Infinity,
    memSince: 0,
    lastMemSay: -Infinity,
    battery: null, // { level 0~1, charging }
    lastLowSaid: 101, // 上次提醒过的电量档位（20 / 10 / 5）
    lastSweat: 0,
  };
  const HOT_CPU = 85;
  const COOL_CPU = 60;
  const HOT_AFTER_MS = 15000;
  const FULL_MEM = 90;

  // 没在说别的、也没在忙别的时候才插话
  function canChat() {
    return S.mode === 'idle' && !bubble.visible && !activeReminder() && !ccWaiting();
  }

  function onSys(d = {}) {
    SYS.cpu = d.cpu || 0;
    SYS.mem = d.mem || 0;
    if (!S.settings.sysAlerts) {
      SYS.hot = false;
      SYS.hotSince = 0;
      return;
    }
    const now = performance.now();
    if (SYS.cpu >= HOT_CPU) {
      if (!SYS.hotSince) SYS.hotSince = now;
      if (!SYS.hot && now - SYS.hotSince >= HOT_AFTER_MS) {
        SYS.hot = true;
        if (now - SYS.lastHotSay > 10 * 60000 && canChat()) {
          SYS.lastHotSay = now;
          bubble.say(`${pick(LINES.hot)} CPU ${SYS.cpu}%`, 4000);
        }
      }
    } else if (SYS.cpu < COOL_CPU) {
      if (SYS.hot && canChat() && Math.random() < 0.5) bubble.say(pick(LINES.cool), 2500);
      SYS.hot = false;
      SYS.hotSince = 0;
    }
    if (SYS.mem >= FULL_MEM) {
      if (!SYS.memSince) SYS.memSince = now;
      if (now - SYS.memSince > 30000 && now - SYS.lastMemSay > 30 * 60000 && canChat()) {
        SYS.lastMemSay = now;
        bubble.say(`内存快满了（${SYS.mem}%），关几个用不到的程序吧`, 5000);
      }
    } else {
      SYS.memSince = 0;
    }
  }

  function onBattery(bat) {
    const prev = SYS.battery;
    SYS.battery = bat;
    if (!S.settings.sysAlerts || !bat) return;
    const pct = Math.round(bat.level * 100);
    if (prev && !prev.charging && bat.charging) {
      if (S.mode === 'idle') setMode('react', 650);
      bubble.say(pick(LINES.charging), 3000);
    }
    if (bat.charging) {
      SYS.lastLowSaid = 101;
      if (prev && pct === 100 && Math.round(prev.level * 100) < 100) bubble.say('电充满啦 ✓ 可以拔掉了', 3500);
      return;
    }
    for (const th of [5, 10, 20]) {
      if (pct <= th && SYS.lastLowSaid > th) {
        SYS.lastLowSaid = th;
        if (S.mode === 'sleep') wakeUp();
        S.wideUntil = performance.now() + 900;
        bubble.say(th === 5 ? `电量只剩 ${pct}% 了！马上要没电啦` : `电量只剩 ${pct}%，快插上电源吧`, 5000);
        break;
      }
    }
  }

  function lowBattery() {
    const b = SYS.battery;
    return !!(S.settings.sysAlerts && b && !b.charging && b.level <= 0.2);
  }

  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const upd = () => onBattery({ level: b.level, charging: b.charging });
      b.addEventListener('levelchange', upd);
      b.addEventListener('chargingchange', upd);
      upd();
    }).catch(() => {});
  }

  // ================= 闲着时的小动作 =================
  function canIdleAct() {
    return S.mode === 'idle' && !S.walking && !S.focus && !S.hoverSince
      && !activeReminder() && !ccWaiting() && !ccWorking() && !bubble.visible;
  }

  function cursorNear(maxX = 400) {
    const c = S.cursorRel;
    return !!(c && Math.abs(c.x) < maxX && c.y > -320 && c.y < 160);
  }

  function doIdleAct() {
    const h = new Date().getHours();
    const sleepy = h >= 23 || h < 7 || h === 14; // 深夜、清早、午后容易犯困
    const mood = S.settings.mood == null ? 70 : S.settings.mood;
    const choices = [
      ['yawn', sleepy ? 4 : 1.5],
      ['sit', 2.5],
      ['look', 2],
      ['hop', mood >= 80 ? 2.5 : 1],
      ['muse', 1],
      ['wave', cursorNear() ? 1.5 : 0],
      ['stretch', 0.8],
      ['sulk', mood < 30 ? 3 : 0], // 心情差：委屈巴巴
      ['joy', mood >= 80 ? 1.5 : 0], // 心情好：自己跳起舞
    ];
    let r = Math.random() * choices.reduce((a, [, w]) => a + w, 0);
    let act = 'look';
    for (const [name, w] of choices) {
      r -= w;
      if (r <= 0) { act = name; break; }
    }
    switch (act) {
      case 'yawn':
        setMode('yawn', 2200);
        if (Math.random() < 0.4) bubble.say(pick(LINES.yawn), 2200);
        break;
      case 'sit':
        setMode('sit', rand(8000, 22000));
        break;
      case 'hop':
        bump('jump');
        particle('✦', 'spark', rand(0.3, 0.7));
        break;
      case 'muse':
        bubble.think(pick(LINES.muse));
        break;
      case 'wave':
        setMode('wave', 1800);
        break;
      case 'stretch':
        setMode('stretch', 2400);
        break;
      case 'sulk':
        setMode('sulk', 3500);
        bubble.say(pick(LINES.sulk), 3500);
        break;
      case 'joy':
        dance(1800);
        if (Math.random() < 0.5) bubble.say(pick(LINES.joy), 2000);
        break;
      default: // look：左右张望一下
        S.glance = Math.random() < 0.5 ? -1 : 1;
        S.glanceUntil = performance.now() + 1500;
        setTimeout(() => { S.glance = -S.glance; S.glanceUntil = performance.now() + 1200; }, 1500);
        break;
    }
    return act;
  }

  // ================= 行为 =================
  // 互动：给主进程记经验和心情（每天有上限）
  const interact = (kind) => { if (api.interact) api.interact(kind); };

  function react() {
    setMode('react', 650);
    interact('click');
    const open = S.settings.todosOpenCount || 0;
    let line = clickLine();
    if (open && Math.random() < 0.25) {
      const first = (S.settings.todosOpen || [])[0] || '';
      line = open === 1 ? `别忘了：${first}` : `还有 ${open} 件待办，比如「${first}」`;
    }
    if (Math.random() < 0.35) bubble.think(line);
    else bubble.say(line);
    for (let i = 0; i < 2; i++) setTimeout(() => particle('✦', 'spark', rand(0.2, 0.8)), i * 120);
  }

  function dance(ms = 2600) {
    setMode('dance', ms);
  }

  function danceForYou() {
    dance();
    interact('dance');
  }

  function petHead() {
    setMode('react', 650);
    interact('pet');
    bubble.say(pick(LINES.pet));
    for (let i = 0; i < 3; i++) setTimeout(() => particle('♥', 'heart', rand(0.25, 0.75)), i * 180);
  }

  function wakeUp() {
    setMode('idle');
    S.wideUntil = performance.now() + 800;
    bump('land');
    if (S.praiseOnWake) {
      S.praiseOnWake = false;
      bubble.say('欢迎回来！活动过了精神多了吧 ✓', 3000);
    } else if (Math.random() < 0.5) {
      bubble.say(pick(LINES.wake), 2200);
    }
  }

  function startFocus(min) {
    S.focus = { end: Date.now() + min * 60000, min };
    bubble.say(`开始专注 ${min} 分钟，我陪着你 ✻`, 2600);
  }

  function stopFocus() {
    if (!S.focus) return;
    S.focus = null;
    bubble.say('好，先歇一会儿～', 2000);
  }

  function finishFocus() {
    const { min } = S.focus;
    S.focus = null;
    if (api.focusDone) api.focusDone(min);
    dance(3200);
    bubble.say(`${min} 分钟专注完成！起来活动一下吧`, 8000);
    api.notify('Clawd', `${min} 分钟专注完成，休息一下吧！`);
  }

  // 整点报时
  function checkChime() {
    const d = new Date();
    const h = d.getHours();
    if (h === S.lastHour) return;
    S.lastHour = h;
    // 过了零点：新的一天如果是节日，打个招呼
    if (h === 0 || (festivalSaidOn && festivalSaidOn !== d.toDateString())) {
      const fest = festivalGreeting();
      if (fest && S.mode !== 'sleep') {
        dance(2400);
        bubble.say(fest, 5000);
        return;
      }
    }
    // 电脑睡眠醒来时可能已经过了整点好几分钟，就不报了
    if (d.getMinutes() > 1) return;
    if (!S.settings.chime || S.mode === 'sleep' || S.focus) return;
    setMode('react', 650);
    bubble.say(hourLine(h), 5000);
  }

  // 追到了：停下、抬头看、蹦一下
  function finishChase(now) {
    S.chasing = false;
    S.walking = false;
    S.restUntil = now + rand(2500, 4000);
    S.nextChase = now + rand(20000, 40000);
    S.lookUpUntil = now + 1500;
    bump('jump');
    if (Math.random() < 0.4) bubble.say(pick(LINES.chase), 1500);
  }

  function updateWalk(now) {
    const can = S.settings.walk && S.grounded && S.mode === 'idle' && !S.focus && !S.hoverSince
      && !activeReminder() && !ccWaiting() && !ccWorking();
    if (!can) {
      // 追到身边、鼠标碰到小人了：追鼠标结束
      if (S.chasing && S.hoverSince) finishChase(now);
      S.walking = false;
      return;
    }
    // 追鼠标：鼠标在地面附近晃来晃去时跑过去
    const c = S.cursorRel;
    if (!S.chasing && now > S.nextChase && S.idleSecs < 1 && cursorNear(350) && Math.abs(c.x) > 60) {
      S.chasing = true;
      S.walking = true;
      S.chaseUntil = now + 5000;
      S.walkUntil = S.chaseUntil;
    }
    if (S.chasing) {
      if (!c || now > S.chaseUntil || !cursorNear(450)) {
        S.chasing = false;
        S.nextChase = now + rand(20000, 40000);
      } else if (Math.abs(c.x) < 18) {
        finishChase(now);
        return;
      } else {
        S.dir = Math.sign(c.x);
        S.walking = true;
      }
    }
    if (!S.walking) {
      // 歇着的时候偶尔试着跳上附近的窗口（只有 Windows 上开了爬窗口才会成功）
      if (now > S.nextClimb && api.climb) {
        S.nextClimb = now + rand(20000, 50000);
        if (Math.random() < 0.5) Promise.resolve(api.climb()).catch(() => {});
      }
      if (now > S.restUntil) {
        S.walking = true;
        S.walkUntil = now + rand(2500, 7000);
        if (Math.random() < 0.35) S.dir = -S.dir;
      }
      return;
    }
    if (now > S.walkUntil && !S.chasing) {
      S.walking = false;
      S.restUntil = now + rand(1500, 5000);
      return;
    }
    if (!S.moveInflight && now - S.lastStep >= 33) {
      S.lastStep = now;
      S.moveInflight = true;
      const step = Math.max(1, Math.round(scale * (S.chasing ? 0.6 : 0.3))) * S.dir;
      Promise.resolve(api.moveBy(step))
        .then((r) => {
          if (r && r.edge) S.dir = -r.edge;
          if (r && r.fell) S.walking = false;
        })
        .catch(() => {})
        .finally(() => { S.moveInflight = false; });
    }
  }

  function update(now) {
    if (TIMED_MODES.includes(S.mode) && now > S.modeUntil) {
      const wasSit = S.mode === 'sit';
      setMode('idle');
      if (wasSit) bump('jump'); // 坐够了，蹦起来
    }
    // 闲着的小动作碰上正事就停下
    if (IDLE_ACTS.includes(S.mode) && (activeReminder() || ccWaiting() || ccWorking() || S.focus)) setMode('idle');
    if (now > S.nextIdleAct) {
      if (canIdleAct()) doIdleAct();
      S.nextIdleAct = now + rand(25000, 60000);
    }
    if (S.mode === 'eyeRest' && now > S.modeUntil) finishEyeRest();

    if (S.focus && Date.now() >= S.focus.end) finishFocus();

    checkChime();
    nagReminders(now);
    playAnnouncement(now);
    nagClaudeCode(now);

    // 睡觉 / 醒来（专注时、Claude Code 干活时不睡）
    if (S.mode === 'idle' && !S.focus && !ccWorking() && !ccWaiting() && S.idleSecs >= SLEEP_AFTER_S) {
      setMode('sleep');
      if (Math.random() < 0.5) bubble.say('困了…先眯一会儿', 2200);
    }
    if (S.mode === 'sleep' && S.idleSecs < 1) wakeUp();

    // 眨眼
    if (now > S.nextBlink) {
      S.blinkUntil = now + 140;
      S.nextBlink = now + (Math.random() < 0.2 ? 320 : rand(2200, 6000));
    }

    // 鼠标长时间不动时，自己左右张望
    if (S.idleSecs > 4 && now > S.glanceUntil && Math.random() < 0.004) {
      S.glance = [-1, 0, 1][Math.floor(Math.random() * 3)];
      S.glanceUntil = now + rand(900, 2200);
    }
    S.look = now < S.glanceUntil ? S.glance : S.cursorLook;
    // 鼠标就在头顶上方：抬头看
    const c = S.cursorRel;
    if (c && Math.abs(c.x) < 40 && c.y < -10 && c.y > -260) S.lookUpUntil = now + 300;

    updateWalk(now);

    // 飘字
    if (S.mode === 'sleep' && now - S.lastZ > 1500) {
      S.lastZ = now;
      particle(Math.random() < 0.5 ? 'z' : 'Z', 'zzz', 0.78);
    }
    if (SYS.hot && S.mode === 'idle' && !S.walking && now - SYS.lastSweat > 2600) {
      SYS.lastSweat = now;
      particle('💦', 'drop', 0.92);
    }
    if (S.mode === 'dance' && now - S.lastNote > 380) {
      S.lastNote = now;
      particle(['♪', '♫', '✦'][Math.floor(Math.random() * 3)], 'note', rand(0.1, 0.9));
    }
    if (S.mode === 'idle' && S.hoverSince && now - S.hoverSince > 900 && now - S.lastHeart > 1100) {
      S.lastHeart = now;
      particle('♥', 'heart', rand(0.3, 0.7));
      if (S.pettedAt !== S.hoverSince && now - S.hoverSince > 1500) {
        S.pettedAt = S.hoverSince; // 每次摸头只算一次
        interact('pet');
      }
    }
  }

  function currentPose(now) {
    const blink = now < S.blinkUntil;
    const breathe = Math.floor(now / 600) % 2 === 1;

    switch (S.mode) {
      case 'drag': {
        const f = Math.floor(now / 110) % 2;
        return { eyes: 'wide', armL: f ? 'up' : 'mid', armR: f ? 'mid' : 'up', legs: f ? 'walkA' : 'walkB' };
      }
      case 'fall':
        return { eyes: 'wide', armL: 'up', armR: 'up' };
      case 'jumpUp':
        return { eyes: 'happy', armL: 'up', armR: 'up', legs: 'walkA' };
      case 'sleep':
        return { eyes: 'closed', squish: Math.floor(now / 1100) % 2 === 1 };
      case 'react':
        return { eyes: 'happy', blush: true, armL: 'up', armR: 'up' };
      case 'drink':
        return { eyes: 'happy', blush: true, look: 1, armR: 'up' };
      case 'eat': {
        // 啊呜啊呜：嘴一张一合
        const f = Math.floor(now / 230) % 2;
        return { eyes: 'happy', blush: true, look: 1, armR: 'mid', mouth: f ? 'o' : 'small', squish: f === 1 };
      }
      case 'stretch': {
        const f = Math.floor(now / 600) % 2;
        return { eyes: f ? 'closed' : 'happy', armL: 'up', armR: 'up', squish: false };
      }
      case 'yawn': {
        // 前半段张嘴举手，后半段闭眼放下
        const t = 1 - Math.max(0, S.modeUntil - now) / 2200;
        return t < 0.6
          ? { eyes: 'closed', mouth: 'o', armL: 'up', armR: 'up' }
          : { eyes: 'closed', mouth: 'small', squish: true };
      }
      case 'wave': {
        const f = Math.floor(now / 220) % 2;
        return { eyes: 'happy', armR: f ? 'up' : 'mid', look: S.cursorLook };
      }
      case 'sulk':
        return { eyes: 'sad', look: 0, squish: Math.floor(now / 1200) % 2 === 1 };
      case 'sit':
        return { sit: true, eyes: blink ? 'blink' : (now < S.lookUpUntil ? 'up' : 'open'), look: S.look, squish: Math.floor(now / 1000) % 2 === 1 };
      case 'eyeRest': {
        // 慢慢左右看远处
        const f = Math.floor(now / 2500) % 3;
        return { eyes: blink ? 'blink' : 'up', look: [-1, 0, 1][f], squish: breathe };
      }
      case 'dance': {
        const f = Math.floor(now / 200) % 2;
        return {
          eyes: 'happy', blush: true,
          armL: f ? 'up' : 'down', armR: f ? 'down' : 'up',
          legs: f ? 'walkA' : 'walkB', squish: f === 1,
        };
      }
      default:
        break;
    }

    if (S.walking) {
      const f = Math.floor(now / (S.chasing ? 90 : 150)) % 2;
      return { eyes: blink ? 'blink' : 'open', look: S.dir, legs: f ? 'walkA' : 'walkB', squish: f === 1 };
    }
    const eyes = now < S.wideUntil ? 'wide' : blink ? 'blink' : 'open';
    // Claude Code 等你确认：举手挥动
    if (ccWaiting()) {
      const f = Math.floor(now / 260) % 2;
      return { eyes, armR: f ? 'up' : 'mid' };
    }
    // 有提醒：按提醒的样子摆姿势（比如举着水杯）
    const rem = activeReminder();
    if (rem) {
      return REMINDERS[rem].pose({ eyes: blink ? 'blink' : 'open', squish: breathe });
    }
    // 鼠标在身上停留 = 被摸头
    if (S.hoverSince && now - S.hoverSince > 900) {
      return { eyes: 'happy', blush: true, squish: breathe };
    }
    // 电脑太忙：流汗、喘气
    if (SYS.hot && !S.focus && !ccWorking()) {
      return { eyes: blink ? 'blink' : 'open', sweat: true, squish: Math.floor(now / 280) % 2 === 1, look: S.look };
    }
    // 电量低：没精神
    if (lowBattery() && !S.focus && !ccWorking()) {
      return { eyes: 'blink', squish: Math.floor(now / 1100) % 2 === 1 };
    }
    if (S.focus || ccWorking()) {
      // 专注时两只手交替敲键盘
      const f = Math.floor(now / 160) % 2;
      return { eyes, armL: f ? 'mid' : 'down', armR: f ? 'down' : 'mid' };
    }
    const sad = (S.settings.mood == null ? 70 : S.settings.mood) < 30 && eyes === 'open' && Math.floor(now / 4000) % 3 === 0;
    return { eyes: sad ? 'sad' : (eyes === 'open' && now < S.lookUpUntil ? 'up' : eyes), look: S.look, squish: breathe };
  }

  // 手里的水杯：提醒时拿在身边，喝水时举高、水位慢慢下降
  function currentProp(now, pose) {
    if (S.mode === 'eat' && S.eating) {
      const t = 1 - Math.max(0, S.modeUntil - now) / EAT_MS;
      return { snack: S.eating.id, bites: Math.min(3, Math.floor(t * 4)), bottom: 3 };
    }
    if (S.mode === 'drink') {
      const t = 1 - Math.max(0, S.modeUntil - now) / DRINK_MS;
      return { level: Math.max(0, 3 - Math.floor(t * 4)), bottom: 5 };
    }
    const rem = activeReminder();
    if (rem && REMINDERS[rem].prop && S.mode === 'idle' && !S.walking) return REMINDERS[rem].prop(pose);
    return null;
  }

  // 气泡里常驻显示的内容：Claude Code 等确认 > 提醒 > Claude Code 工作中 > 专注倒计时
  bubble.setPersistent((now) => {
    const top = S.cc.top;
    if (ccWaiting()) {
      return { glyph: '!', text: top.message || 'Claude Code 等你确认', dim: top.project };
    }
    if (S.mode === 'eyeRest') {
      return { glyph: '👀', text: '看看远处…', dim: `${Math.max(0, Math.ceil((S.modeUntil - now) / 1000))}s` };
    }
    const rem = activeReminder();
    if (rem) {
      const view = REMINDERS[rem];
      return {
        text: view.text ? view.text() : S.reminders[rem].line,
        dim: view.dimFn ? view.dimFn() : view.dim,
      };
    }
    if (ccWorking()) {
      const more = S.cc.active > 1 ? ` +${S.cc.active - 1}` : '';
      return {
        glyph: bubble.spinnerGlyph(now),
        text: top.tool || 'Clauding…',
        dim: `${mmss(Date.now() - top.since)}${more}`,
      };
    }
    if (S.focus) {
      return {
        glyph: bubble.spinnerGlyph(now),
        text: `${FOCUS_VERBS[Math.floor(Date.now() / 10000) % FOCUS_VERBS.length]}…`,
        dim: mmss(S.focus.end - Date.now()),
      };
    }
    return null;
  });

  function ackClaudeCode() {
    S.ccDismissed = ccKey(S.cc.top);
    bubble.say(pick(LINES.ccWaitAck), 2200);
  }

  bubble.onClick(() => {
    if (ccWaiting()) { ackClaudeCode(); return; }
    const rem = activeReminder();
    if (rem) REMINDERS[rem].act();
  });

  // ================= 鼠标：点击 / 双击 / 拖动 =================
  let press = null;
  let lastClick = 0;

  petEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    petEl.setPointerCapture(e.pointerId);
    press = { x: e.screenX, y: e.screenY, dragging: false };
    setIgnore(false);
  });

  petEl.addEventListener('pointermove', (e) => {
    if (!press || press.dragging) return;
    if (Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
      press.dragging = true;
      startDrag();
    }
  });

  petEl.addEventListener('pointerup', () => {
    if (!press) return;
    const wasDrag = press.dragging;
    press = null;
    if (wasDrag) endDrag();
    else onClick();
  });

  petEl.addEventListener('pointercancel', () => {
    if (!press) return;
    const wasDrag = press.dragging;
    press = null;
    if (wasDrag) endDrag();
  });

  function onClick() {
    const now = performance.now();
    if (S.mode === 'sleep') { wakeUp(); return; }
    if (ccWaiting()) { ackClaudeCode(); return; }
    const rem = activeReminder();
    if (rem) { REMINDERS[rem].act(); return; }
    if (['drink', 'stretch', 'eyeRest'].includes(S.mode)) return;
    if (now - lastClick < 350) {
      lastClick = 0;
      danceForYou();
      return;
    }
    lastClick = now;
    react();
  }

  function startDrag() {
    api.dragStart();
    S.grounded = false;
    setMode('drag');
    if (Math.random() < 0.35) bubble.say(pick(LINES.drag), 1800);
  }

  function endDrag() {
    api.dragEnd();
    if (S.settings.walk) {
      setMode('fall');
    } else {
      setMode('idle');
      bump('land');
    }
  }

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.contextMenu({
      focusing: !!S.focus,
      focusLeft: S.focus ? mmss(S.focus.end - Date.now()) : '',
      todo: activeReminder() === 'todo' && S.todoQueue[0] ? S.todoQueue[0].id : null,
    });
  });

  // ================= 透明区域鼠标穿透 =================
  const canIgnore = api.platform === 'win32' || api.platform === 'darwin';
  let ignoring = canIgnore; // 主进程启动时默认开启穿透

  function setIgnore(v) {
    if (!canIgnore || v === ignoring) return;
    ignoring = v;
    api.setIgnore(v);
  }

  function inRect(r, x, y, pad = 0) {
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function overInteractive(x, y) {
    return inRect(petEl.getBoundingClientRect(), x, y, 3)
      || (bubble.visible && inRect(bubble.el.getBoundingClientRect(), x, y, 2))
      || (!clock.el.classList.contains('hidden') && inRect(clock.el.getBoundingClientRect(), x, y, 2))
      || (propEl.classList.contains('show') && inRect(propEl.getBoundingClientRect(), x, y, 2))
      || (giftEl.classList.contains('show') && inRect(giftEl.getBoundingClientRect(), x, y, 3));
  }

  window.addEventListener('mousemove', (e) => {
    if (press) { setIgnore(false); return; }
    setIgnore(!overInteractive(e.clientX, e.clientY));
  });
  root.addEventListener('mouseleave', () => {
    if (!press) setIgnore(true);
  });

  // ================= 主进程消息 =================
  function onTick(d) {
    S.idleSecs = d.idle;
    const r = petEl.getBoundingClientRect();
    const dx = d.cx - (r.left + r.width / 2);
    S.cursorLook = Math.abs(dx) < r.width * 0.35 ? 0 : Math.sign(dx);
    S.cursorRel = { x: dx, y: d.cy - r.top };
    const inside = inRect(r, d.cx, d.cy);
    if (inside && !press) {
      if (!S.hoverSince) S.hoverSince = performance.now();
    } else {
      S.hoverSince = 0;
    }
    if ((window.devicePixelRatio || 1) !== dpr) resizeCanvas();
  }

  function applySettings(s) {
    if (!s) return;
    outfitCache.at = 0; // 生日、衣柜可能变了
    const wasWalk = S.settings.walk;
    S.settings = { ...S.settings, ...s };
    if (s.scale && s.scale !== scale) {
      scale = s.scale;
      resizeCanvas();
    }
    if (wasWalk && !S.settings.walk) S.walking = false;
  }

  // ================= 成长：公告队列 =================
  // 几件好事同时发生（任务完成 + 打卡 + 宝箱）时一句一句说，不互相顶掉
  S.announces = [];
  function announce(text, { celebrate = false, delay = 800, ms = 5200, glyph = '' } = {}) {
    S.announces.push({ text, celebrate, ms, glyph, notBefore: performance.now() + delay });
  }

  function playAnnouncement(now) {
    const a = S.announces[0];
    // Claude Code 等你批准时不抢气泡，批准完再庆祝
    if (!a || now < a.notBefore || bubble.busy() || ccWaiting()) return;
    if (!['idle', 'react', 'dance', 'sleep', 'sit', 'wave', 'yawn', 'stretch', 'sulk'].includes(S.mode) || S.walking) return;
    if (S.mode === 'sleep') wakeUp();
    S.announces.shift();
    S.announcing = { a, until: now + a.ms };
    if (a.celebrate) {
      dance(3000);
      for (let i = 0; i < 6; i++) setTimeout(() => particle('✦', 'spark', rand(0.05, 0.95)), i * 160);
    } else {
      setMode('react', 650);
    }
    bubble.say(a.glyph ? `${a.glyph} ${a.text}` : a.text, a.ms);
    // 下一句至少隔一会儿
    if (S.announces[0]) S.announces[0].notBefore = Math.max(S.announces[0].notBefore, now + a.ms + 600);
  }

  const SNACK_EMOJI = { cookie: '🍪', fish: '🐟', pudding: '🍮', cake: '🍰' };
  const SNACK_NAME = { cookie: '饼干', fish: '小鱼干', pudding: '布丁', cake: '蛋糕' };

  function eat(d) {
    if (S.mode === 'sleep') wakeUp();
    S.eating = { id: d.id, favorite: !!d.favorite };
    setMode('eat', EAT_MS);
    bubble.say(d.favorite ? `是${d.name || SNACK_NAME[d.id]}！今天最想吃的就是这个 💕` : `啊呜——${d.name || SNACK_NAME[d.id]}好好吃！`, 3200);
    const n = d.favorite ? 6 : 3;
    for (let i = 0; i < n; i++) setTimeout(() => particle('♥', 'heart', rand(0.3, 0.9)), 300 + i * 260);
  }

  function onGrowth(ev = {}) {
    switch (ev.type) {
      case 'welcome': {
        let t = `成长系统升级啦！每天 3 个小任务、连续打卡 🔥、小卖部和成就。送你 ${ev.stars}✦ 和一块饼干 🍪，右键喂我吧～`;
        if (ev.achievements) t += `\n以前的努力也算数：解锁了 ${ev.achievements} 个成就（+${ev.achievementStars}✦）`;
        announce(t, { celebrate: true, delay: 5600, ms: 9000 });
        break;
      }
      case 'morning': {
        const lines = [];
        if (ev.note && ev.note.kind === 'broken' && ev.note.was > 1) lines.push(`之前连续打卡 ${ev.note.was} 天断掉了…没关系，今天重新开始 💪`);
        if (ev.note && ev.note.kind === 'freeze') lines.push(`用掉 ${ev.note.used} 张补签卡，🔥${ev.note.streak} 天保住啦！`);
        lines.push(`今天的任务：${(ev.quests || []).join('、')}`);
        if (ev.streak) lines.push(`🔥 已经连续 ${ev.streak} 天，完成 2 个任务就能续上`);
        announce(lines.join('\n'), { delay: 300, ms: 8000, glyph: '☀' });
        break;
      }
      case 'quest':
        announce(`任务完成：${ev.title}　+${ev.stars}✦${ev.left ? `（还剩 ${ev.left} 个）` : ''}`, { glyph: '✓', delay: 1200, ms: 4200 });
        break;
      case 'checkin': {
        let t = `今天打卡成功！🔥 连续 ${ev.streak} 天`;
        if (ev.milestone) t += `\n连续 ${ev.milestone.days} 天的奖励：${ev.milestone.stars}✦${ev.milestone.skin === 'gold' ? '，还解锁了金色皮肤！' : ''}`;
        if (ev.freeze) t += '\n攒到一张补签卡 🎫 偶尔忘了也不怕';
        announce(t, { celebrate: true, ms: 6000 });
        break;
      }
      case 'chest':
        announce(`三个任务全部完成！🧰 宝箱里有 ${ev.stars}✦ 和一个${SNACK_EMOJI[ev.snack] || ''}${SNACK_NAME[ev.snack] || ''}`, { celebrate: true, ms: 6000 });
        break;
      case 'achievement':
        announce(`成就解锁 ${ev.icon}「${ev.name}」　+${ev.stars}✦`, { celebrate: true, ms: 5000 });
        break;
      case 'skin':
        announce(`解锁新皮肤：${ev.name} ✨ 去衣柜换上试试`, { celebrate: true });
        break;
      case 'feed':
        eat(ev);
        break;
      case 'gift':
        announce(`礼物里是：${ev.reward && ev.reward.text}！`, { celebrate: true, delay: 900, glyph: '🎁' });
        break;
      case 'bought':
        announce(ev.kind === 'skin' ? `换上${ev.name}啦，好看吗？` : `谢谢！${ev.name}我很喜欢 💕`, { delay: 200, ms: 3500 });
        break;
      default:
        break;
    }
  }

  async function openGift() {
    if (!S.gift || S.giftOpening) return;
    S.giftOpening = true;
    bump('jump');
    for (let i = 0; i < 6; i++) setTimeout(() => particle('✦', 'spark', rand(-0.3, 0.2)), i * 120);
    let r = {};
    try { r = (await api.openGift()) || {}; } catch { /* 忽略 */ }
    setTimeout(() => {
      S.giftOpening = false;
      S.gift = false;
    }, 1400);
    if (r.error) bubble.say(r.error, 2500);
  }
  giftEl.addEventListener('click', openGift);

  function onMenu(cmd) {
    if (cmd === 'pet') petHead();
    else if (cmd === 'dance') danceForYou();
    else if (cmd === 'drink') drink();
    else if (cmd === 'focus-stop') stopFocus();
    else if (typeof cmd === 'string' && cmd.startsWith('focus-')) startFocus(Number(cmd.slice(6)) || 25);
  }

  api.on('tick', onTick);
  api.on('settings', applySettings);
  api.on('menu', onMenu);
  api.on('reminder', onReminder);
  api.on('cc', onCC);
  api.on('todo', onTodo);
  api.on('sys', onSys);
  // 升级公告：等手上这句话说完再宣布（比如喝水时升级，先说“咕嘟咕嘟”）
  api.on('levelup', (d = {}) => {
    const extra = d.unlocked && d.unlocked.length ? ` 解锁了：${d.unlocked.join('、')}` : '';
    announce(`升级啦！Lv.${d.level} ✦${extra}`, { celebrate: true });
  });
  api.on('growth', onGrowth);
  api.on('gift', (d = {}) => {
    const was = S.gift;
    S.gift = !!d.show;
    if (S.gift && !was && !d.quiet) announce('咦，地上有个礼物 🎁 点一下拆开看看！', { glyph: '🎁', delay: 400 });
  });
  // 勿扰的“安静”模式：变淡、不说话
  api.on('quiet', (on) => document.body.classList.toggle('quiet', !!on));
  api.on('say', (text) => {
    if (S.mode === 'sleep') wakeUp();
    setMode('react', 650);
    bubble.say(String(text || ''), 4000);
  });
  api.on('jumping', (d = {}) => {
    S.grounded = false;
    S.dir = d.dir || S.dir;
    setMode('jumpUp');
  });
  api.on('falling', () => {
    S.grounded = false;
    if (S.mode !== 'drag') setMode('fall');
  });
  api.on('landed', (d = {}) => {
    S.grounded = true;
    S.restUntil = performance.now() + rand(600, 1500);
    if (S.mode === 'fall' || S.mode === 'idle' || S.mode === 'jumpUp') {
      setMode('idle');
      if (d.impact > 6) bump('land');
      if (d.impact > 24 && Math.random() < 0.6) bubble.say(pick(LINES.land), 1800);
    }
  });

  // ================= 启动 =================
  function loop() {
    const now = performance.now();
    update(now);
    const pose = currentPose(now);
    const outfit = currentOutfit();
    if (outfit.festival) reportFestival();
    const acc = [outfit.face, outfit.hat].filter((id) => id && outfits.ITEMS[id].face);
    if (acc.length) pose.acc = acc;
    draw(pose);
    drawHat(outfit.hat, pose);
    drawProp(currentProp(now, pose));
    drawGift();
    bubble.render(now);
    clock.render(S.settings.clock !== false, (S.settings.growth || {}).streak || 0);
    requestAnimationFrame(loop);
  }

  resizeCanvas();
  requestAnimationFrame(loop);
  // 拿到设置（生日等）之后再打招呼，免得节日问候被普通问候顶掉
  const greet = () => {
    const fest = festivalGreeting();
    if (fest) {
      dance(2400);
      bubble.say(fest, 5000);
    } else {
      setMode('react', 650);
      bubble.say(greeting(), 4200);
    }
  };
  Promise.resolve(api.getSettings()).then(applySettings).catch(() => {})
    .finally(() => setTimeout(greet, 900));

  // 调试用（浏览器预览 / 自动化测试）
  window.__clawd = {
    S,
    setMode,
    say: bubble.say,
    think: bubble.think,
    dance,
    petHead,
    startFocus,
    stopFocus,
    pixels: sprite.pixels,
    cupPixels: sprite.cupPixels,
    draw,
    currentPose,
    onReminder,
    onCC,
    onTodo,
    onSys,
    onBattery,
    SYS,
    doIdleAct,
    currentOutfit,
    outfits,
    danceForYou,
    onWater: (d = {}) => onReminder({ kind: 'water', ...d }),
    drink,
    onGrowth,
    openGift,
    skinId,
  };

  // ================= 浏览器预览用的假 API =================
  function createMockApi() {
    const listeners = {};
    const emit = (ch, data) => (listeners[ch] || []).forEach((fn) => fn(data));
    window.addEventListener('mousemove', (e) => emit('tick', { cx: e.clientX, cy: e.clientY, idle: 0 }));
    return {
      mock: true,
      platform: 'browser',
      dragStart() {},
      dragEnd() {},
      moveBy: async () => ({ edge: 0 }),
      climb: async () => ({ ok: false }),
      fall() { setTimeout(() => emit('landed', { impact: 10 }), 200); },
      setIgnore() {},
      contextMenu() {},
      notify(title, body) { console.log('[notify]', title, body); },
      getSettings: async () => ({ size: 'medium', scale: 7, walk: false, onTop: true, clock: true, chime: true, sysAlerts: true, festival: true, birthday: '', outfit: { hat: 'none', face: 'none' } }),
      reminderDone: async () => ({ count: 1, goal: 8 }),
      todoDone: async () => ({ ok: true, left: 0 }),
      openGift: async () => ({ ok: true, reward: { text: '20✦' } }),
      on(ch, fn) { (listeners[ch] = listeners[ch] || []).push(fn); },
      emit,
    };
  }
})();
