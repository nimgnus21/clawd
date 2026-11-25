// Clawd 小队：一个 Claude Code 会话一只 Clawd
//   第一个会话交给主 Clawd；之后每多一个会话，旁边就来一只小一号的 Clawd（最多 3 只，左右交替站）
//   每只头顶一个小牌子写项目名：干活时拿着对应的道具，等批准时举手、牌子变橙，做完了跳一下、牌子变绿，然后离开
(() => {
  'use strict';

  const C = (window.Clawd = window.Clawd || {});
  const { sprite, ccLook, ui } = C;
  const crewEl = document.getElementById('crew');
  const MAX = 3;
  const LEAVE_MS = 450;

  const st = {
    enabled: true,
    mainId: null,
    slots: new Array(MAX).fill(null), // 每个位置上是哪个会话
    workers: new Map(), // session id -> worker
    scale: 4, // 小 Clawd 每格多大
    petScale: 5,
    dpr: window.devicePixelRatio || 1,
    reported: -1,
    overflow: 0,
    skin: 'classic',
    report: () => {},
  };

  const overflowEl = document.createElement('div');
  overflowEl.className = 'crew-more hidden';
  crewEl.append(overflowEl);

  function workerScale(petScale) {
    return Math.max(3, petScale - 1);
  }

  // 第 i 个位置的中心离主 Clawd 中心多远（左右交替）
  function slotOffset(i) {
    const side = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const slot = Math.max(84, sprite.GRID_W * st.scale + 20);
    const pw = sprite.GRID_W * st.petScale;
    return side * (pw / 2 + 10 + k * slot + slot / 2);
  }

  function clip(t, n) {
    const s = String(t || '');
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }

  function makeWorker(id, slot) {
    const el = document.createElement('div');
    el.className = 'worker enter';
    const chip = document.createElement('div');
    chip.className = 'w-chip';
    const body = document.createElement('div');
    body.className = 'w-body';
    const cv = document.createElement('canvas');
    cv.className = 'w-sprite';
    const pv = document.createElement('canvas');
    pv.className = 'w-prop';
    body.append(cv, pv);
    el.append(chip, body);
    crewEl.append(el);
    const w = { id, slot, el, chip, body, cv, pv, session: null, poseKey: '', propKey: '', chipKey: '', dismissed: '', bornAt: performance.now(), hopUntil: 0, tripUntil: 0, lastResultAt: 0 };
    el.addEventListener('animationend', (e) => { if (e.animationName === 'workerIn') el.classList.remove('enter'); });
    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      poke(w);
    });
    layoutWorker(w);
    return w;
  }

  function layoutWorker(w) {
    const pw = sprite.GRID_W * st.scale;
    const ph = sprite.GRID_H * st.scale;
    const pad = sprite.padFor(st.scale);
    w.el.style.left = `calc(50% + ${slotOffset(w.slot)}px - ${pw / 2}px)`;
    w.el.style.width = `${pw}px`;
    w.body.style.width = `${pw}px`;
    w.body.style.height = `${ph}px`;
    w.cv.width = Math.round((pw + 2 * pad) * st.dpr);
    w.cv.height = Math.round((ph + 2 * pad) * st.dpr);
    w.cv.style.width = `${pw + 2 * pad}px`;
    w.cv.style.height = `${ph + 2 * pad}px`;
    w.cv.style.margin = `-${pad}px`;
    w.pad = pad;
    w.poseKey = '';
    w.propKey = '';
  }

  function removeWorker(w) {
    st.workers.delete(w.id);
    w.el.classList.add('leave');
    setTimeout(() => w.el.remove(), LEAVE_MS);
  }

  // 点一下小 Clawd：在等批准就表示“知道了”，否则蹦一下
  function poke(w) {
    const s = w.session;
    if (s && s.state === 'waiting') w.dismissed = `${s.id}|${s.waitSince}`;
    w.hopUntil = performance.now() + 600;
    if (ui && ui.particle) ui.particle('✦', 'spark', 0.5, w.body);
  }

  // 分配位置。返回交给主 Clawd 的那个会话（没有就是 null）
  function assign(sessions = [], enabled = true) {
    st.enabled = enabled;
    const byId = new Map(sessions.map((s) => [s.id, s]));
    if (!enabled) {
      st.mainId = null;
      st.slots.fill(null);
    } else {
      if (st.mainId && !byId.has(st.mainId)) st.mainId = null;
      st.slots = st.slots.map((id) => (id && byId.has(id) ? id : null));
      for (const s of sessions) {
        if (s.id === st.mainId || st.slots.includes(s.id) || s.state === 'done') continue;
        if (!st.mainId) { st.mainId = s.id; continue; }
        const free = st.slots.indexOf(null);
        if (free >= 0) st.slots[free] = s.id;
      }
    }
    st.slots.forEach((id, i) => {
      if (!id) return;
      let w = st.workers.get(id);
      if (!w) {
        w = makeWorker(id, i);
        st.workers.set(id, w);
      }
      w.session = byId.get(id);
    });
    for (const w of [...st.workers.values()]) if (!st.slots.includes(w.id)) removeWorker(w);
    // 放不下的会话：显示 “+N”
    const shown = new Set([st.mainId, ...st.slots].filter(Boolean));
    st.overflow = enabled ? sessions.filter((s) => s.state !== 'done' && !shown.has(s.id)).length : 0;
    overflowEl.textContent = st.overflow ? `+${st.overflow}` : '';
    overflowEl.classList.toggle('hidden', !st.overflow);
    // 窗口要多宽：用到的最远的位置
    let n = 0;
    st.slots.forEach((id, i) => { if (id) n = i + 1; });
    if (n !== st.reported) {
      st.reported = n;
      st.report(n);
    }
    return st.mainId ? byId.get(st.mainId) || null : null;
  }

  // 测试结果：通过蹦一下，没过摔一跤
  function onEvent(ev) {
    const w = st.workers.get(ev.session);
    if (!w) return false;
    const now = performance.now();
    if (ev.type === 'test') {
      if (ev.ok) w.hopUntil = now + 900;
      else w.tripUntil = now + 1400;
      ui.particle(ev.ok ? '✓' : '!', ev.ok ? 'spark' : 'drop', 0.5, w.body);
    } else if (ev.type === 'done') {
      w.hopUntil = now + 1200;
      for (let i = 0; i < 3; i++) setTimeout(() => ui.particle('✦', 'spark', 0.2 + i * 0.3, w.body), i * 140);
    } else if (ev.type === 'waiting') {
      w.hopUntil = now + 500;
      ui.particle('!', 'spark', 0.5, w.body);
    }
    return true;
  }

  function chipFor(w, now) {
    const s = w.session || {};
    const name = clip(s.project || 'Claude', 10);
    if (s.state === 'waiting' && w.dismissed !== `${s.id}|${s.waitSince}`) {
      const sec = Math.max(0, Math.round((Date.now() - (s.waitSince || Date.now())) / 1000));
      return { cls: 'wait', text: `! ${name}`, title: `${s.project} 在等你批准（${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}）` };
    }
    if (s.state === 'done') return { cls: 'done', text: `✓ ${name}`, title: `${s.project} 做完了` };
    const what = ccLook.KIND_TEXT[s.kind] || '干活中';
    return { cls: '', text: name, title: `${s.project} · ${s.tool || what}` };
  }

  function poseFor(w, now) {
    const s = w.session || {};
    const blink = (now + w.bornAt * 7) % 4200 < 140;
    const eyes = blink ? 'blink' : 'open';
    if (now < w.tripUntil) return { eyes: now < w.tripUntil - 900 ? 'wide' : 'sad', sweat: true, squish: true, armL: 'up', armR: 'up' };
    if (now < w.hopUntil || s.state === 'done') return { eyes: 'happy', blush: true, armL: 'up', armR: 'up' };
    if (s.state === 'waiting' && w.dismissed !== `${s.id}|${s.waitSince}`) {
      const f = Math.floor(now / 260) % 2;
      return { eyes, armR: f ? 'up' : 'mid' };
    }
    if (s.state === 'waiting') return { eyes, look: 0 };
    return ccLook.pose(s.kind || 'think', now + w.bornAt, eyes);
  }

  function render(now) {
    for (const w of st.workers.values()) {
      const s = w.session || {};
      const pose = poseFor(w, now);
      const { breath, ...px } = pose; // eslint-disable-line no-unused-vars
      const p = { ...px, skin: st.skin };
      const key = JSON.stringify(p);
      if (key !== w.poseKey) {
        w.poseKey = key;
        sprite.render(w.cv.getContext('2d'), sprite.GRID_W, sprite.GRID_H, sprite.pixels(p), { pad: w.pad * st.dpr });
      }
      // 跳 / 摔：用 CSS 动画
      w.body.classList.toggle('hop', now < w.hopUntil || s.state === 'done');
      w.body.classList.toggle('trip', now < w.tripUntil);
      // 道具
      const prop = s.state === 'working' && now >= w.tripUntil ? ccLook.prop(s.kind, now + w.bornAt) : null;
      const pk = prop ? `${prop.art}|${prop.frame}|${prop.bottom}` : '';
      if (pk !== w.propKey) {
        w.propKey = pk;
        w.pv.classList.toggle('show', !!prop);
        if (prop) {
          const art = sprite.propPixels(prop.art, prop.frame);
          const pw = art.cols * st.scale;
          const ph = art.rows * st.scale;
          w.pv.width = Math.round((pw + 2 * w.pad) * st.dpr);
          w.pv.height = Math.round((ph + 2 * w.pad) * st.dpr);
          w.pv.style.width = `${pw + 2 * w.pad}px`;
          w.pv.style.height = `${ph + 2 * w.pad}px`;
          w.pv.style.margin = `-${w.pad}px`;
          w.pv.style.bottom = `${prop.bottom * st.scale}px`;
          sprite.render(w.pv.getContext('2d'), art.cols, art.rows, art.list, { pad: w.pad * st.dpr });
        }
      }
      const chip = chipFor(w, now);
      const ck = `${chip.cls}|${chip.text}|${chip.title}`;
      if (ck !== w.chipKey) {
        w.chipKey = ck;
        w.chip.className = `w-chip ${chip.cls}`;
        w.chip.textContent = chip.text;
        w.chip.title = chip.title;
      }
    }
    if (st.overflow) {
      const last = Math.max(...st.slots.map((id, i) => (id ? i : -1)));
      overflowEl.style.left = `calc(50% + ${slotOffset(last + 2)}px - 14px)`;
    }
  }

  function setScale(petScale, dpr) {
    st.petScale = petScale;
    st.scale = workerScale(petScale);
    st.dpr = dpr || window.devicePixelRatio || 1;
    for (const w of st.workers.values()) layoutWorker(w);
  }

  // 鼠标在不在某只小 Clawd 身上（透明区域穿透用）
  function hit(x, y) {
    for (const w of st.workers.values()) {
      const r = w.body.getBoundingClientRect();
      const c = w.chip.getBoundingClientRect();
      if ((x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3)
        || (x >= c.left && x <= c.right && y >= c.top && y <= c.bottom)) return true;
    }
    return false;
  }

  C.crew = {
    assign,
    onEvent,
    render,
    setScale,
    hit,
    mainId: () => st.mainId,
    count: () => st.workers.size,
    setSkin: (skin) => {
      if (skin === st.skin) return;
      st.skin = skin;
      for (const w of st.workers.values()) w.poseKey = '';
    },
    onReport: (fn) => { st.report = fn; },
    workers: () => [...st.workers.values()].map((w) => ({ id: w.id, slot: w.slot, state: (w.session || {}).state, kind: (w.session || {}).kind, chip: w.chip.textContent })),
  };
})();
