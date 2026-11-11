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

  const B = { text: '', until: 0, thinkUntil: 0, verb: '', after: null, sig: '', visible: false };
  let persistent = () => null; // () => { glyph, text, dim } | null
  let onBubbleClick = () => {};

  function say(text, ms) {
    B.thinkUntil = 0;
    B.after = null;
    B.text = text;
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

  function renderBubble(now) {
    let glyph = '';
    let text = '';
    let dim = '';
    if (B.thinkUntil && now < B.thinkUntil) {
      glyph = spinnerGlyph(now);
      text = `${B.verb}…`;
    } else if (B.after) {
      say(B.after);
      text = B.text;
    } else if (now < B.until) {
      text = B.text;
    } else {
      const p = persistent(now);
      if (p) ({ glyph = '', text = '', dim = '' } = p);
    }

    const sig = `${glyph}|${text}|${dim}`;
    if (sig === B.sig) return;
    B.sig = sig;
    B.visible = !!text;
    bubbleEl.classList.toggle('hidden', !B.visible);
    if (B.visible) {
      glyphEl.textContent = glyph;
      textEl.textContent = text;
      dimEl.textContent = dim;
    }
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
  let clockSig = '';

  function renderClock(enabled) {
    const d = new Date();
    const show = enabled && !B.visible;
    const sig = `${show}|${d.getDay()}|${d.getHours()}|${d.getMinutes()}|${d.getSeconds() % 2}`;
    if (sig === clockSig) return;
    clockSig = sig;
    clockEl.classList.toggle('hidden', !show);
    clockWeek.textContent = WEEK[d.getDay()];
    clockH.textContent = pad2(d.getHours());
    clockM.textContent = pad2(d.getMinutes());
    clockColon.classList.toggle('off', d.getSeconds() % 2 === 1);
  }

  clockEl.addEventListener('click', () => {
    const d = new Date();
    say(`${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`, 3500);
  });

  // ================= 飘字 =================
  function particle(ch, cls, xFrac = 0.5) {
    const el = document.createElement('span');
    el.className = `particle ${cls}`;
    el.textContent = ch;
    const r = petEl.getBoundingClientRect();
    el.style.left = `${r.left + r.width * xFrac - 6}px`;
    el.style.top = `${r.top - 4}px`;
    el.style.setProperty('--drift', `${Math.round(rand(-14, 18))}px`);
    fxEl.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
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
  };
})();
