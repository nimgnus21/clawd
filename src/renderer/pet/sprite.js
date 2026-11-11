// 像素造型：Clawd 本体和手里的道具
(() => {
  'use strict';

  const C = (window.Clawd = window.Clawd || {});

  // Clawd = 16 x 10 的像素网格：12x8 的身体、两只小手、四条腿、一对竖条眼睛
  const GRID_W = 16;
  const GRID_H = 10;
  const COLOR = { body: '#D97757', eye: '#141413', blush: '#F2A39B', sweat: '#8CCBF2' };
  const ARM_Y = { down: 4, mid: 3, up: 1 };
  const LEG_X = [3, 5, 10, 12];

  // pose: { eyes, look(-1/0/1), armL, armR, legs, squish(呼吸下压), blush, sweat, sit(坐下), mouth('o' | 'small'), acc(配饰 id 列表) }
  function pixels(pose) {
    const out = [];
    const put = (x, y, c) => out.push([x, y, c]);
    const oy = pose.sit ? 2 : 0; // 坐下：整个身体往下挪两格，腿收起来
    const top = oy + (pose.squish ? 1 : 0);

    // 身体
    for (let y = top; y < oy + 8; y++) for (let x = 2; x < 14; x++) put(x, y, COLOR.body);

    // 手
    const ly = ARM_Y[pose.armL || 'down'] + top;
    const ry = ARM_Y[pose.armR || 'down'] + top;
    for (const y of [ly, ly + 1]) { put(0, y, COLOR.body); put(1, y, COLOR.body); }
    for (const y of [ry, ry + 1]) { put(14, y, COLOR.body); put(15, y, COLOR.body); }

    // 腿（走路时交替抬起；坐下时看不见）
    if (!pose.sit) {
      const legs = pose.legs || 'stand';
      LEG_X.forEach((x, i) => {
        const lifted = (legs === 'walkA' && i % 2 === 1) || (legs === 'walkB' && i % 2 === 0);
        put(x, 8, COLOR.body);
        if (!lifted) put(x, 9, COLOR.body);
      });
    }

    // 眼睛
    const look = pose.look || 0;
    const ex = [4 + look, 11 + look];
    const ey = 2 + top;
    const eye = (x, y) => put(x, y, COLOR.eye);
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
      eye(7, ey + 3); eye(8, ey + 3); eye(7, ey + 4); eye(8, ey + 4);
    } else if (pose.mouth === 'small') {
      eye(7, ey + 3); eye(8, ey + 3);
    }
    if (pose.blush) {
      put(3, ey + 2, COLOR.blush);
      put(12, ey + 2, COLOR.blush);
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

  C.sprite = { GRID_W, GRID_H, COLOR, CUP_W, CUP_H, pixels, cupPixels, paint };
})();
