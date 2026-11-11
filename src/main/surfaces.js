// 爬窗口用的“地面”计算：任务栏上沿 + 其他窗口的顶边
// windows: [{ hwnd, rect: { left, top, right, bottom } }]，按 Z 顺序从上到下，坐标是 DIP（和 Electron 窗口一样）

const TOL = 6; // 脚底和窗口顶边差几个像素以内算“站在上面”
const EDGE = 6; // 离窗口左右边缘多近就算掉下去
const HEADROOM = 40; // 窗口顶边离屏幕顶太近（比如最大化窗口）就站不上去

// 点 (x, y) 是不是被排在 index 前面（更靠上）的窗口挡住
function covered(windows, index, x, y) {
  for (let j = 0; j < index; j++) {
    const o = windows[j].rect;
    if (x >= o.left && x <= o.right && y >= o.top && y <= o.bottom) return true;
  }
  return false;
}

// 能站在这个窗口顶边的 x 位置吗
function standable(windows, i, x, workArea) {
  const r = windows[i].rect;
  if (x < r.left + EDGE || x > r.right - EDGE) return false;
  if (r.top < workArea.y + HEADROOM || r.top > workArea.y + workArea.height) return false;
  return !covered(windows, i, x, r.top - 1);
}

// 脚底 feetY 往下最近的地面：{ y, hwnd, rect }，没有窗口就是任务栏（hwnd = 0）
function groundBelow(windows, x, feetY, workArea) {
  let best = { y: workArea.y + workArea.height, hwnd: 0, rect: null };
  windows.forEach((w, i) => {
    const top = w.rect.top;
    if (top < feetY - TOL || top >= best.y) return;
    if (!standable(windows, i, x, workArea)) return;
    best = { y: top, hwnd: w.hwnd, rect: w.rect };
  });
  return best;
}

// 现在脚下踩着的（脚底和顶边差 TOL 以内），没有就 null
function standingOn(windows, x, feetY, workArea) {
  const g = groundBelow(windows, x, feetY, workArea);
  return Math.abs(g.y - feetY) <= TOL ? g : null;
}

// 可以跳上去的窗口：在头顶上方 minUp~maxUp 之间、水平离得不远、顶边没被挡住
function climbTargets(windows, x, feetY, workArea, { minUp = 60, maxUp = 450, maxDx = 380 } = {}) {
  const out = [];
  windows.forEach((w, i) => {
    const r = w.rect;
    const up = feetY - r.top;
    if (up < minUp || up > maxUp) return;
    // 落点：尽量在当前 x，超出窗口就落在离得最近的那一侧
    const tx = Math.min(Math.max(x, r.left + 40), r.right - 40);
    if (Math.abs(tx - x) > maxDx || r.right - r.left < 100) return;
    if (!standable(windows, i, tx, workArea)) return;
    out.push({ hwnd: w.hwnd, x: tx, y: r.top, rect: r });
  });
  return out;
}

module.exports = { groundBelow, standingOn, climbTargets, covered, TOL };
