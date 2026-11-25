// 画面上的小部件：对话气泡、头顶时钟、飘起来的小符号
(() => {
  'use strict';

  const C = (window.Clawd = window.Clawd || {});
  const { pick, rand, VERBS, SPINNER, WEEK, pad2 } = C.lines;

  const $ = (id) => document.getElementById(id);
  const petEl = $('pet');
  const fxEl = $('fx');

  // ================= 对话气泡 =================
  // 临时说的话优先；没话说时显示“常驻内容”（提醒、专注倒计时等，由 pet.js 提供）
  const bubbleEl = $('bubble');
  const glyphEl = $('bubble-glyph');
  const textEl = $('bubble-text');
  const dimEl = $('bubble-dim');

  const B = { text: '', until: 0, thinkUntil: 0, verb: '', after: null, sig: '', visible: false, tone: '' };
  let persistent = () => null; // () => { glyph, text, dim } | null
  let onBubbleClick = () => {};

  // opts.tone：'celebrate'（庆祝，金边）
  function say(text, ms, opts = {}) {
    B.thinkUntil = 0;
    B.after = null;
    B.text = text;
    B.tone = opts.tone || '';
    B.until = performance.now() + (ms || Math.min(6500, 2000 + text.length * 130));
  }

  // 先显示 “✻ Pondering…” 再说话，像 Claude Code 一样
  function think(then) {
    const now = performance.now();
    B.verb = pick(VERBS);
    B.thinkUntil = now + rand(1000, 1700);
    B.until = B.thinkUntil;
    B.after = then;
  }

  function hush() {
    B.until = 0;
    B.thinkUntil = 0;
    B.after = null;
  }

  function spinnerGlyph(now) {
    return SPINNER[Math.floor(now / 110) % SPINNER.length];
  }

  // 说话时一个字一个字冒出来（textContent 还是整句话）
  function setText(text, animate) {
    if (!animate || text.length > 140) {
      textEl.textContent = text;
      return;
    }
    textEl.textContent = '';
    const chars = [...text];
    const step = Math.min(26, 700 / chars.length);
    chars.forEach((ch, i) => {
      if (ch === '\n') { textEl.append('\n'); return; }
      const span = document.createElement('span');
      span.className = 'ch';
      span.textContent = ch;
      span.style.animationDelay = `${Math.round(i * step)}ms`;
      textEl.append(span);
    });
  }

  function renderBubble(now) {
    let glyph = '';
    let text = '';
    let dim = '';
    let kind = 'say'; // say | think | status
    if (B.thinkUntil && now < B.thinkUntil) {
      glyph = spinnerGlyph(now);
      text = `${B.verb}…`;
      kind = 'think';
    } else if (B.after) {
      say(B.after);
      text = B.text;
    } else if (now < B.until) {
      text = B.text;
    } else {
      const p = persistent(now);
      if (p) ({ glyph = '', text = '', dim = '' } = p);
      kind = 'status';
    }

    const tone = kind === 'say' ? B.tone : '';
    const sig = `${glyph}|${text}|${dim}|${kind}|${tone}`;
    if (sig === B.sig) return;
    const sameText = B.lastText === text && B.lastKind === kind;
    B.sig = sig;
    B.visible = !!text;
    bubbleEl.classList.toggle('hidden', !B.visible);
    if (B.visible) {
      bubbleEl.classList.toggle('celebrate', tone === 'celebrate');
      bubbleEl.classList.toggle('status', kind !== 'say');
      glyphEl.textContent = glyph;
      // 常驻状态每秒都在变（倒计时），不做逐字动画；同一句话不重放
      if (!sameText) setText(text, kind === 'say');
      dimEl.textContent = dim;
    }
    B.lastText = B.visible ? text : '';
    B.lastKind = kind;
  }

  bubbleEl.addEventListener('click', () => {
    hush();
    onBubbleClick();
  });

  // ================= 时钟 =================
  const clockEl = $('clock');
  const clockWeek = $('clock-week');
  const clockH = $('clock-h');
  const clockColon = $('clock-colon');
  const clockM = $('clock-m');
  const clockStreak = $('clock-streak');
  const clockRings = $('clock-rings');
  let clockSig = '';
  let streakNow = 0;
  let ringsNow = null;

  // streak：连续打卡天数（🔥N）；rings：今日三环 [{ id, icon, name, value, goal, closed }]，显示成三个小点
  function renderClock(enabled, streak = 0, rings = null) {
    const d = new Date();
    const show = enabled && !B.visible;
    streakNow = streak;
    ringsNow = rings;
    const r = rings ? rings.map((x) => (x.closed ? 1 : 0)).join('') : '';
    const sig = `${show}|${d.getDay()}|${d.getHours()}|${d.getMinutes()}|${d.getSeconds() % 2}|${streak}|${r}`;
    if (sig === clockSig) return;
    clockSig = sig;
    clockEl.classList.toggle('hidden', !show);
    clockWeek.textContent = WEEK[d.getDay()];
    clockH.textContent = pad2(d.getHours());
    clockM.textContent = pad2(d.getMinutes());
    clockColon.classList.toggle('off', d.getSeconds() % 2 === 1);
    clockStreak.textContent = streak > 0 ? `🔥${streak}` : '';
    if (clockRings.dataset.r !== r) {
      clockRings.dataset.r = r;
      clockRings.textContent = '';
      for (const x of rings || []) {
        const dot = document.createElement('i');
        dot.className = `ring-${x.id}${x.closed ? ' on' : ''}`;
        clockRings.append(dot);
      }
    }
  }

  // 点时钟：完整日期 + 今天三环的进度
  clockEl.addEventListener('click', () => {
    const d = new Date();
    const lines = [`${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}${streakNow > 0 ? `　🔥${streakNow}` : ''}`];
    if (ringsNow) lines.push(ringsNow.map((x) => `${x.icon}${x.closed ? '✓' : ` ${x.value}/${x.goal}`}`).join('　'));
    say(lines.join('\n'), 4200);
  });

  // ================= 飘起来的小东西 =================
  // 爱心、星星、音符、Z… 都画成像素画（和 Clawd 同一个画风）；没有对应图案的字符照旧用文字
  const PARTICLE_OF = { '♥': 'heart', '✦': 'spark', '♪': 'note', '♫': 'note', z: 'z', Z: 'z', '💧': 'drop', '💦': 'drop', '!': 'bang', '✓': 'check' };
  const particleCache = new Map();

  function cellSize() {
    return Math.max(4, (petEl.offsetWidth || 112) / 16);
  }

  // 返回 { src, w, h }（CSS 像素）
  function particleImage(name, big) {
    const { sprite } = C;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(2, Math.round(cellSize() * (big ? 0.5 : 0.42)));
    const cacheKey = `${name}|${px}|${dpr}`;
    if (particleCache.has(cacheKey)) return particleCache.get(cacheKey);
    const art = sprite && sprite.particlePixels(name);
    if (!art) return null;
    const pad = 2;
    const w = art.cols * px + pad * 2;
    const h = art.rows * px + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    sprite.render(cv.getContext('2d'), art.cols, art.rows, art.list, { pad: pad * dpr, outline: Math.max(1, Math.round(dpr * 1.2)), shade: false, round: 0.22 });
    const img = { src: cv.toDataURL(), w, h };
    particleCache.set(cacheKey, img);
    return img;
  }

  function particle(ch, cls, xFrac = 0.5) {
    const r = petEl.getBoundingClientRect();
    const name = PARTICLE_OF[ch];
    const img = name && particleImage(name, ch === 'Z');
    let el;
    if (img) {
      el = document.createElement('img');
      el.src = img.src;
      el.width = img.w;
      el.height = img.h;
      el.alt = ch;
      el.className = `particle ${cls}`;
      el.style.left = `${r.left + r.width * xFrac - img.w / 2}px`;
      el.style.top = `${r.top - img.h / 2}px`;
    } else {
      el = document.createElement('span');
      el.className = `particle text ${cls}`;
      el.textContent = ch;
      el.style.left = `${r.left + r.width * xFrac - 8}px`;
      el.style.top = `${r.top - 8}px`;
    }
    el.style.setProperty('--drift', `${Math.round(rand(-14, 18))}px`);
    fxEl.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  // 庆祝：从头顶撒一把彩纸
  const CONFETTI = ['#D97757', '#F5C54A', '#EF5B6E', '#4FA3E8', '#45B26B', '#9A88D8'];
  function confetti(n = 18) {
    const r = petEl.getBoundingClientRect();
    const s = cellSize();
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      el.className = 'confetti';
      el.style.background = CONFETTI[i % CONFETTI.length];
      el.style.left = `${r.left + r.width * rand(0.3, 0.7)}px`;
      el.style.top = `${r.top + s}px`;
      el.style.setProperty('--cs', `${Math.round(s * rand(0.6, 0.9))}px`);
      el.style.setProperty('--dx', `${Math.round(rand(-1, 1) * r.width * 0.9)}px`);
      el.style.setProperty('--dy', `${Math.round(-rand(0.5, 1.1) * r.height)}px`);
      el.style.setProperty('--rot', `${Math.round(rand(-540, 540))}deg`);
      el.style.setProperty('--cd', `${rand(1.2, 1.7).toFixed(2)}s`);
      el.style.animationDelay = `${Math.round(rand(0, 120))}ms`;
      fxEl.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  }

  C.ui = {
    bubble: {
      say,
      think,
      hush,
      render: renderBubble,
      spinnerGlyph,
      get visible() { return B.visible; },
      // 正在说一句临时的话（不算常驻的提醒内容）
      busy() { const now = performance.now(); return now < B.until || (B.thinkUntil && now < B.thinkUntil) || !!B.after; },
      get text() { return B.text; },
      setPersistent(fn) { persistent = fn; },
      onClick(fn) { onBubbleClick = fn; },
      el: bubbleEl,
    },
    clock: { render: renderClock, el: clockEl },
    particle,
    confetti,
  };
})();
