// 像素造型：Clawd 本体和手里的道具
(() => {
  'use strict';

  const C = (window.Clawd = window.Clawd || {});

  // Clawd = 16 x 10 的像素网格：12x8 的身体、两只小手、四条腿、一对竖条眼睛
  const GRID_W = 16;
  const GRID_H = 10;
  const COLOR = { body: '#D97757', eye: '#141413', blush: '#F2A39B', sweat: '#8CCBF2' };

  // 皮肤：换身体颜色（深色皮肤眼睛变浅）；星空有星星点点，金色有高光
  const SKINS = {
    classic: { body: '#D97757' },
    mint: { body: '#5FB89A' },
    lavender: { body: '#9A88D8' },
    sakura: { body: '#EC9AB4', blush: '#E0607E' },
    ocean: { body: '#5E9ED6' },
    cocoa: { body: '#9C6B4E' },
    night: { body: '#3E3D58', eye: '#F4F1EA', blush: '#B5668A' },
    gold: { body: '#E3B341', shine: '#FFF1B8', blush: '#E98A5B' },
    galaxy: { body: '#2F3478', eye: '#F4F1EA', blush: '#9C6FD6', dots: [[3, 5, '#FFFFFF'], [6, 1, '#F2C14E'], [9, 6, '#FFFFFF'], [12, 5, '#8CCBF2'], [10, 1, '#FFFFFF'], [7, 4, '#9C6FD6']] },
  };
  const ARM_Y = { down: 4, mid: 3, up: 1 };
  const LEG_X = [3, 5, 10, 12];

  // pose: { eyes, look(-1/0/1), armL, armR, legs, squish(呼吸下压), blush, sweat, sit(坐下), mouth('o' | 'small'), acc(配饰 id 列表) }
  function pixels(pose) {
    const out = [];
    // 第 4 项是像素的类型（eye / mouth / blush / dot），精致渲染时用
    const put = (x, y, c, kind) => out.push(kind ? [x, y, c, kind] : [x, y, c]);
    const skin = SKINS[pose.skin] || SKINS.classic;
    const BODY = skin.body;
    const EYE = skin.eye || COLOR.eye;
    const oy = pose.sit ? 2 : 0; // 坐下：整个身体往下挪两格，腿收起来
    const top = oy + (pose.squish ? 1 : 0);

    // 身体
    for (let y = top; y < oy + 8; y++) for (let x = 2; x < 14; x++) put(x, y, BODY);
    if (skin.shine) { put(3, top, skin.shine); put(4, top, skin.shine); put(3, top + 1, skin.shine); }
    if (skin.dots) for (const [x, y, c] of skin.dots) if (top + y < oy + 8) put(x, top + y, c, 'dot');

    // 手
    const ly = ARM_Y[pose.armL || 'down'] + top;
    const ry = ARM_Y[pose.armR || 'down'] + top;
    for (const y of [ly, ly + 1]) { put(0, y, BODY); put(1, y, BODY); }
    for (const y of [ry, ry + 1]) { put(14, y, BODY); put(15, y, BODY); }

    // 腿（走路时交替抬起；坐下时看不见）
    if (!pose.sit) {
      const legs = pose.legs || 'stand';
      LEG_X.forEach((x, i) => {
        const lifted = (legs === 'walkA' && i % 2 === 1) || (legs === 'walkB' && i % 2 === 0);
        put(x, 8, BODY);
        if (!lifted) put(x, 9, BODY);
      });
    }

    // 眼睛
    const look = pose.look || 0;
    const ex = [4 + look, 11 + look];
    const ey = 2 + top;
    const eye = (x, y) => put(x, y, EYE, 'eye');
    const mouth = (x, y) => put(x, y, EYE, 'mouth');
    switch (pose.eyes || 'open') {
      case 'blink':
        ex.forEach((x) => eye(x, ey + 1));
        break;
      case 'closed': // 睡觉：一条线
        eye(ex[0], ey + 1); eye(ex[0] + 1, ey + 1);
        eye(ex[1] - 1, ey + 1); eye(ex[1], ey + 1);
        break;
      case 'happy': // ^ ^
        ex.forEach((x) => { eye(x - 1, ey + 1); eye(x, ey); eye(x + 1, ey + 1); });
        break;
      case 'wide': // 吃惊：眼睛变长
        ex.forEach((x) => { eye(x, ey - 1); eye(x, ey); eye(x, ey + 1); });
        break;
      case 'up': // 往上 / 往远处看
        ex.forEach((x) => { eye(x, ey - 1); eye(x, ey); });
        break;
      case 'sad': // 委屈： /  \
        eye(ex[0] + 1, ey); eye(ex[0], ey + 1);
        eye(ex[1] - 1, ey); eye(ex[1], ey + 1);
        break;
      default: // open
        ex.forEach((x) => { eye(x, ey); eye(x, ey + 1); });
    }
    // 嘴（平时没有嘴，打哈欠、吃惊时才张开）
    if (pose.mouth === 'o') {
      mouth(7, ey + 3); mouth(8, ey + 3); mouth(7, ey + 4); mouth(8, ey + 4);
    } else if (pose.mouth === 'small') {
      mouth(7, ey + 3); mouth(8, ey + 3);
    }
    if (pose.blush) {
      put(3, ey + 2, skin.blush || COLOR.blush, 'blush');
      put(12, ey + 2, skin.blush || COLOR.blush, 'blush');
    }
    // 脸上的配饰（墨镜、眼镜、耳机的耳罩…），定义在 outfits.js
    for (const id of pose.acc || []) {
      const item = C.outfits && C.outfits.ITEMS[id];
      if (item && item.face) item.face(put, top, ey);
    }
    // 流汗：右上角一滴汗
    if (pose.sweat) {
      put(14, top, COLOR.sweat);
      put(14, top + 1, COLOR.sweat);
      put(15, top + 1, COLOR.sweat);
    }
    return out;
  }

  // 水杯：4 x 5，level = 水位（0~3 格）
  const CUP_W = 4;
  const CUP_H = 5;
  const CUP_COLOR = { glass: '#D3E6F3', water: '#4C9BE0' };
  function cupPixels(level) {
    const out = [];
    for (let y = 0; y < 4; y++) out.push([0, y, CUP_COLOR.glass], [3, y, CUP_COLOR.glass]);
    out.push([1, 4, CUP_COLOR.glass], [2, 4, CUP_COLOR.glass]);
    for (let i = 0; i < level; i++) out.push([1, 3 - i, CUP_COLOR.water], [2, 3 - i, CUP_COLOR.water]);
    return out;
  }

  // 飘起来的小东西（爱心、星星、音符、Z…）也是像素画，跟 Clawd 一个画风
  const PARTICLES = {
    heart: { rows: ['.RR.RR.', 'RWRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'], pal: { R: '#EF5B6E', W: '#FFD3DA' } },
    spark: { rows: ['...Y...', '...Y...', '..YWY..', 'YYWWWYY', '..YWY..', '...Y...', '...Y...'], pal: { Y: '#F5C54A', W: '#FFF6CF' } },
    note: { rows: ['...OO.', '...O.O', '...O..', '.OOO..', 'OOOO..', '.OO...'], pal: { O: '#D97757' } },
    z: { rows: ['WWWWW', '...W.', '..W..', '.W...', 'WWWWW'], pal: { W: '#EEF2FF' } },
    drop: { rows: ['.B.', '.B.', 'BBB', 'BWB', '.B.'], pal: { B: '#4FA3E8', W: '#CFE8FF' } },
    bang: { rows: ['O', 'O', 'O', '.', 'O'], pal: { O: '#F5A524' } },
    check: { rows: ['....G', '...GG', 'G.GG.', 'GGG..', '.G...'], pal: { G: '#45B26B' } },
  };
  function particlePixels(name) {
    const d = PARTICLES[name];
    if (!d) return null;
    const list = [];
    d.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (d.pal[ch]) list.push([x, y, d.pal[ch]]); }));
    return { cols: d.rows[0].length, rows: d.rows.length, list };
  }

  // ================= 精致渲染 =================
  // 还是像素风，但每一格画得更细：外轮廓圆角、深色描边、顶部高光和底部阴影、眼睛高光、腮红变成小椭圆
  const hexRgb = (c) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbHex = (r) => `#${r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => { const B = hexRgb(b); return rgbHex(hexRgb(a).map((v, i) => v + (B[i] - v) * t)); };
  const lum = (c) => { const [r, g, b] = hexRgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

  function fillRound(ctx, x, y, w, h, radii) {
    ctx.beginPath();
    if (radii.some((r) => r > 0) && ctx.roundRect) ctx.roundRect(x, y, w, h, radii);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  // opts: { pad: 画布四周留给描边的像素, outline: 描边粗细（像素）, shade: 是否画高光阴影, round: 圆角占一格的比例 }
  function render(context, cols, rows, list, opts = {}) {
    const ctx = context;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const pad = opts.pad || 0;
    const cw = (W - 2 * pad) / cols;
    const ch = (H - 2 * pad) / rows;
    ctx.clearRect(0, 0, W, H);
    const X = (x) => Math.round(pad + x * cw);
    const Y = (y) => Math.round(pad + y * ch);
    const key = (x, y) => `${x},${y}`;
    const filled = new Set(list.map((p) => key(p[0], p[1])));
    const has = (x, y) => filled.has(key(x, y));
    const R = Math.min(cw, ch) * (opts.round == null ? 0.34 : opts.round);
    const ow = opts.outline == null ? Math.max(1, Math.round(Math.min(cw, ch) * 0.15)) : opts.outline;
    const convex = (x, y, same) => {
      const t = !same(x, y - 1); const b = !same(x, y + 1); const l = !same(x - 1, y); const r = !same(x + 1, y);
      return [t && l ? R : 0, t && r ? R : 0, b && r ? R : 0, b && l ? R : 0];
    };
    // 同一个位置先画的是底，后画的是叠在上面的五官 / 花纹
    const seen = new Set();
    const base = [];
    const feat = [];
    for (const p of list) {
      const k = key(p[0], p[1]);
      if (seen.has(k)) feat.push(p);
      else { seen.add(k); base.push(p); }
    }
    // 1) 描边：每格往外扩 ow，用自己颜色的深色版
    if (ow > 0) {
      for (const [x, y, c] of base) {
        ctx.fillStyle = opts.outlineColor || mix(c, '#2A160E', 0.62);
        fillRound(ctx, X(x) - ow, Y(y) - ow, X(x + 1) - X(x) + 2 * ow, Y(y + 1) - Y(y) + 2 * ow, convex(x, y, has).map((r) => (r ? r + ow * 0.6 : 0)));
      }
    }
    // 2) 底色 + 顶部高光 + 底部和右边的阴影
    for (const [x, y, c] of base) {
      const x0 = X(x); const y0 = Y(y); const w = X(x + 1) - x0; const h = Y(y + 1) - y0;
      const rad = convex(x, y, has);
      ctx.fillStyle = c;
      fillRound(ctx, x0, y0, w, h, rad);
      if (opts.shade === false) continue;
      ctx.save();
      ctx.beginPath();
      if (rad.some((r) => r > 0) && ctx.roundRect) ctx.roundRect(x0, y0, w, h, rad); else ctx.rect(x0, y0, w, h);
      ctx.clip();
      const band = (f, size) => Math.max(1, Math.round(size * f));
      if (!has(x, y - 1)) { ctx.fillStyle = mix(c, '#FFFFFF', 0.26); ctx.fillRect(x0, y0, w, band(0.2, h)); }
      if (!has(x, y + 1)) { ctx.fillStyle = mix(c, '#3A1A0C', 0.2); ctx.fillRect(x0, y0 + h - band(0.24, h), w, band(0.24, h)); }
      if (!has(x + 1, y)) { ctx.fillStyle = mix(c, '#3A1A0C', 0.1); ctx.fillRect(x0 + w - band(0.18, w), y0, band(0.18, w), h); }
      ctx.restore();
    }
    // 3) 五官：按同色的邻居做圆角；眼睛加高光
    const featAt = new Map(feat.map((p) => [key(p[0], p[1]), p[2]]));
    for (const [x, y, c, kind] of feat) {
      const x0 = X(x); const y0 = Y(y); const w = X(x + 1) - x0; const h = Y(y + 1) - y0;
      ctx.fillStyle = c;
      if (kind === 'blush') {
        ctx.globalAlpha = 0.85;
        fillRound(ctx, x0 + w * 0.08, y0 + h * 0.2, w * 0.84, h * 0.6, [h * 0.3, h * 0.3, h * 0.3, h * 0.3]);
        ctx.globalAlpha = 1;
        continue;
      }
      if (kind === 'dot') {
        const d = Math.max(1, Math.round(w * 0.42));
        ctx.fillRect(Math.round(x0 + (w - d) / 2), Math.round(y0 + (h - d) / 2), d, d);
        continue;
      }
      const same = (xx, yy) => featAt.get(key(xx, yy)) === c;
      const lone = !same(x - 1, y) && !same(x + 1, y) && !same(x, y - 1) && !same(x, y + 1);
      // 斜着连起来的像素（^ ^ 眼睛）不做圆角，不然会糊成一串圆点
      fillRound(ctx, x0, y0, w, h, lone ? [0, 0, 0, 0] : convex(x, y, same).map((r) => r * 1.15));
      if (kind === 'eye' && lum(c) < 0.35 && same(x, y + 1) && !same(x, y - 1)) {
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        const sz = Math.max(1, Math.round(w * 0.36));
        ctx.fillRect(Math.round(x0 + w * 0.14), Math.round(y0 + h * 0.16), sz, sz);
      }
    }
  }

  // 描边要用的留白（CSS 像素），按每格大小算
  function padFor(scale) {
    return Math.max(2, Math.round(scale * 0.3));
  }

  // 把像素列表画到画布上（四舍五入到整像素，缩放比例是小数时也不会有缝）
  function paint(context, cols, rows, list) {
    const sx = context.canvas.width / cols;
    const sy = context.canvas.height / rows;
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    for (const [x, y, c] of list) {
      const x0 = Math.round(x * sx);
      const y0 = Math.round(y * sy);
      context.fillStyle = c;
      context.fillRect(x0, y0, Math.round((x + 1) * sx) - x0, Math.round((y + 1) * sy) - y0);
    }
  }

  C.sprite = { GRID_W, GRID_H, COLOR, SKINS, CUP_W, CUP_H, PARTICLES, pixels, cupPixels, particlePixels, paint, render, padFor, mix };
})();
