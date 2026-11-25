// 控制面板框架：侧边栏导航、表单控件、和主进程通信。各页面在 tabs-*.js 里注册。
(() => {
  'use strict';

  const P = window.panel || createMock();
  const tabs = [];
  let state = null;
  let current = null;
  let updaters = [];

  // ---------- 小工具 ----------
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v; // 走 CSSOM，不违反 CSP
      else if (k === 'html') el.innerHTML = v; // 只用于本文件里写死的图标
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === undefined || c === null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICONS = {
    general: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    shirt: '<path d="M8 3 3.5 6l2 4.2L8 9v12h8V9l2.5 1.2 2-4.2L16 3a4 4 0 0 1-8 0Z"/>',
    bag: '<path d="M5 8h14l-1.2 12H6.2L5 8Z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9.5 17h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6"/>',
  };

  function icon(name) {
    return h('span', {
      html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.info}</svg>`,
      style: 'display:inline-flex',
    });
  }

  // 一行设置：左边标题+说明，右边控件
  function row(label, desc, ...controls) {
    return h('div', { class: 'row' },
      h('div', { class: 'label' }, h('b', {}, label), desc ? h('small', {}, desc) : null),
      h('div', { class: 'ctrl' }, ...controls));
  }

  function section(title, ...children) {
    return h('div', { class: 'section' }, title ? h('h2', {}, title) : null, h('div', { class: 'card' }, ...children));
  }

  // 每个控件注册一个“刷新函数”，数据变了就调用
  function watch(fn) {
    updaters.push(fn);
    if (state) fn(state);
  }

  function toggle(get, onChange, { disabled } = {}) {
    const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch' });
    input.addEventListener('change', () => onChange(input.checked));
    watch((s) => {
      input.checked = !!get(s);
      input.disabled = typeof disabled === 'function' ? !!disabled(s) : !!disabled;
    });
    return input;
  }

  function select(options, get, onChange) {
    const el = h('select', {}, options.map(([v, label]) => h('option', { value: String(v) }, label)));
    el.addEventListener('change', () => {
      const opt = options.find(([v]) => String(v) === el.value);
      onChange(opt ? opt[0] : el.value);
    });
    watch((s) => {
      const v = String(get(s));
      // 当前值不在选项里（比如手动改过设置文件），临时加一个
      if (![...el.options].some((o) => o.value === v)) el.append(h('option', { value: v }, v));
      if (document.activeElement !== el) el.value = v;
    });
    return el;
  }

  function number(get, onChange, { min = 0, max = 9999, step = 1, suffix = '' } = {}) {
    const el = h('input', { type: 'number', min, max, step });
    el.addEventListener('change', () => {
      const v = Math.min(max, Math.max(min, Number(el.value) || 0));
      el.value = v;
      onChange(v);
    });
    watch((s) => { if (document.activeElement !== el) el.value = get(s); });
    return suffix ? h('span', { class: 'ctrl' }, el, h('span', { class: 'muted' }, suffix)) : el;
  }

  function button(label, onClick, { primary, danger, disabled } = {}) {
    const el = h('button', { class: `btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}` }, label);
    el.addEventListener('click', async () => {
      el.disabled = true;
      try { await onClick(); } finally { el.disabled = false; if (disabled) el.disabled = !!disabled(state); }
    });
    if (typeof label === 'function') watch((s) => { el.textContent = label(s); });
    if (disabled) watch((s) => { el.disabled = !!disabled(s); });
    return el;
  }

  // 跟着数据变的一组元素：sig(s) 变了才重画（列表、卡片）
  function live(el, sig, render) {
    let last = null;
    watch((s) => {
      const k = JSON.stringify(sig(s));
      if (k === last) return;
      last = k;
      el.textContent = '';
      el.append(...[].concat(render(s)).filter(Boolean));
    });
    return el;
  }

  // 跟着数据变的文字
  function text(get, attrs = {}) {
    const el = h('span', attrs);
    watch((s) => { el.textContent = get(s); });
    return el;
  }

  // 状态点 + 文字：get(s) 返回 [tone, text]，tone = ok | warn | err | ''
  function status(get) {
    const dot = h('span', { class: 'dot' });
    const label = h('span');
    watch((s) => {
      const [tone, t] = get(s);
      dot.className = `dot ${tone || ''}`;
      label.textContent = t;
    });
    return h('span', { class: 'status' }, dot, label);
  }

  let toastTimer = null;
  function toast(msg, tone = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = tone;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  async function act(name, ...args) {
    const r = await P.action(name, ...args);
    if (r && r.error) toast(r.error, 'err');
    return r;
  }

  function ago(ts) {
    if (!ts) return '从来没有';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    return `${Math.floor(s / 86400)} 天前`;
  }

  function hhmm(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ---------- 导航 ----------
  function addTab(tab) {
    tabs.push(tab);
    tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function renderNav() {
    const nav = document.getElementById('nav');
    nav.textContent = '';
    for (const tab of tabs) {
      if (tab.visible && state && !tab.visible(state)) continue;
      const badge = h('span', { class: 'badge hidden' });
      const btn = h('button', { 'data-tab': tab.id, class: tab.id === current ? 'active' : '', onclick: () => show(tab.id) },
        icon(tab.icon), h('span', {}, tab.title), badge);
      if (tab.badge) watch((s) => {
        const b = tab.badge(s);
        badge.textContent = b || '';
        badge.classList.toggle('hidden', !b);
      });
      nav.append(btn);
    }
  }

  // id 可以是 "页面" 或 "页面:小节"（比如 settings:claude 打开设置并滚到 Claude Code 那一节）
  function show(target) {
    const [id, anchor] = String(target || '').split(':');
    const tab = tabs.find((t) => t.id === id) || tabs[0];
    if (tab.id !== current || !anchor) {
      current = tab.id;
      updaters = [];
      renderNav();
      document.getElementById('title').textContent = tab.title;
      document.getElementById('subtitle').textContent = tab.subtitle || '';
      const content = document.getElementById('content');
      content.textContent = '';
      tab.render(content);
      if (state) update(state);
      document.getElementById('main').scrollTop = 0;
    }
    if (anchor) {
      const el = document.querySelector(`[data-anchor="${anchor}"]`);
      if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30);
    }
  }

  function update(next) {
    state = next;
    for (const fn of updaters) {
      try { fn(state); } catch (err) { console.error(err); }
    }
  }

  function drawLogo() {
    const c = document.getElementById('logo');
    const sprite = window.Clawd && window.Clawd.sprite;
    if (!c || !sprite) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = 34 * dpr;
    c.height = 22 * dpr;
    sprite.render(c.getContext('2d'), sprite.GRID_W, sprite.GRID_H, sprite.pixels({}), { pad: 1 * dpr });
  }

  async function init() {
    drawLogo();
    state = await P.getState();
    document.getElementById('version').textContent = state && state.version ? ` v${state.version}` : '';
    const params = new URLSearchParams(location.search);
    show(params.get('tab') || tabs[0].id);
    update(state);
    P.onState(update);
    P.onNav((id) => show(id));
    // 时间类文字（“3 分钟前”）每 20 秒刷新一次
    setInterval(() => update(state), 20000);
  }

  document.addEventListener('DOMContentLoaded', init);

  // 浏览器里直接打开时的假数据（预览用）
  function createMock() {
    const s = {
      version: 'dev',
      platform: 'browser',
      isPackaged: false,
      settings: { size: 'medium', walk: false, onTop: true, clock: true, chime: true, reminders: { water: 45 }, waterGoal: 8, claudeCode: { enabled: true, port: 47823, tools: true, notify: true, notifyMinSec: 30 } },
      today: { water: 3 },
      reminders: { water: { due: Date.now() + 600000, pending: false, interval: 45 } },
      cc: { enabled: true, port: 47823, listening: true, installed: false, settingsFile: '~/.claude/settings.json', lastEventAt: 0, active: 0 },
      petVisible: true,
      dataDir: '~/.config/Clawd',
    };
    return {
      platform: 'browser',
      getState: async () => s,
      action: async (name, ...args) => { console.log('[action]', name, args); return { ok: true }; },
      onState() {},
      onNav() {},
    };
  }

  // 画一个穿着配饰的 Clawd（帽子 5 行 + 身体 10 行），按屏幕像素画，高清
  // canvas 的 width/height 属性当作 CSS 尺寸，第一次画时换成 ×devicePixelRatio
  function drawClawd(canvas, { hat = '', face = '', pose = {}, skin = '' } = {}) {
    const { sprite, outfits } = window.Clawd || {};
    if (!sprite || !outfits) return;
    const dpr = window.devicePixelRatio || 1;
    if (!canvas.dataset.w) {
      canvas.dataset.w = canvas.width;
      canvas.dataset.h = canvas.height;
    }
    const w = Number(canvas.dataset.w);
    const hgt = Number(canvas.dataset.h);
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${hgt}px`;
    }
    const ctx = canvas.getContext('2d');
    const off = outfits.HAT_H - outfits.HAT_OVERLAP;
    const rows = off + sprite.GRID_H;
    const acc = [face, hat].filter((id) => id && outfits.ITEMS[id] && outfits.ITEMS[id].face);
    // 先画身体，再画帽子（帽子最下面一行压在脑袋上）
    const list = [
      ...sprite.pixels({ ...pose, acc, skin }).map((p) => [p[0], p[1] + off, p[2], p[3]]),
      ...outfits.hatPixels(hat),
    ];
    sprite.render(ctx, sprite.GRID_W, rows, list, { pad: Math.round(2 * dpr) });
  }

  // 各页面共用的大块内容（待办、统计图表…），由 tabs-*.js 放进来
  const parts = {};

  window.ClawdPanel = {
    drawClawd,
    h, icon, row, section, watch, live, toggle, select, number, button, text, status, toast, act, ago, hhmm, addTab, parts,
    get state() { return state; },
    show,
  };
})();
