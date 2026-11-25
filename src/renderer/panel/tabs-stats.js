// 控制面板：统计图表（放在「回顾」页里）：每个指标一张小柱状图 + 表格视图
(() => {
  'use strict';

  const { h, watch, parts } = window.ClawdPanel;
  const SVG = 'http://www.w3.org/2000/svg';

  // 前三个和今日三环一一对应（目标线就是环的目标）
  const care = (s) => (s.settings && s.settings.care) || {};
  const METRICS = [
    { key: 'water', title: '💧 喝水', unit: '杯', color: 'var(--ring-water)', goal: (s) => (s.settings && s.settings.waterGoal) || 8 },
    { key: 'move', title: '🚶 活动', unit: '次', color: 'var(--ring-move)', goal: (s) => care(s).moveGoal || 4 },
    { key: 'focus', title: '⏱ 专注', unit: '分钟', color: 'var(--ring-focus)', goal: (s) => care(s).focusGoal || 60 },
    { key: 'ccTasks', title: 'Claude Code 任务', unit: '个' },
    { key: 'todosDone', title: '完成待办', unit: '件' },
  ];
  // 活动 = 起来动 + 护眼；专注 = 专注计时 + Claude Code 干活时间（和三环的算法一样）
  const derive = (d = {}) => ({ ...d, move: (d.sitBreaks || 0) + (d.eyeBreaks || 0), focus: (d.focusMinutes || 0) + Math.round((d.ccSeconds || 0) / 60) });

  let range = 7;

  function svg(tag, attrs = {}) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // 刻度取整：最大值从下面挑，保证中间那条刻度也是整数（0 / 5 / 10、0 / 30 / 60 …）
  const NICE = [4, 6, 8, 10, 12, 16, 20, 30, 40, 50, 60, 80, 100, 120, 160, 200, 300, 400, 500, 600, 800, 1000];
  function niceMax(v) {
    for (const n of NICE) if (v <= n) return n;
    return Math.ceil(v / 1000) * 1000;
  }

  const fmtDate = (key) => {
    const [, m, d] = key.split('-').map(Number);
    return `${m}/${d}`;
  };
  const fmtDateLong = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(y, m - 1, d).getDay()];
    return `${m}月${d}日 ${wd}`;
  };

  // ---------- 悬停提示 ----------
  const tip = h('div', { class: 'viz-tip hidden', role: 'tooltip' });
  const tipValue = h('b');
  const tipLabel = h('span');
  tip.append(tipValue, tipLabel);
  function showTip(target, value, label) {
    tipValue.textContent = value;
    tipLabel.textContent = label;
    tip.classList.remove('hidden');
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - t.width - 8, left));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, r.top - t.height - 8)}px`;
  }
  function hideTip() {
    tip.classList.add('hidden');
  }

  // ---------- 一张柱状图 ----------
  function barChart(days, metric, goal) {
    const W = 320;
    const H = 132;
    const pad = { l: 28, r: 8, t: 14, b: 22 };
    const values = days.map((d) => d[metric.key] || 0);
    const max = niceMax(Math.max(goal || 0, ...values));
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const band = iw / days.length;
    const bw = Math.min(24, Math.max(3, band - 2)); // 柱子最粗 24，中间留 2px 空隙
    const y = (v) => pad.t + ih - (v / max) * ih;

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz', role: 'group', 'aria-label': `${metric.title}，最近 ${days.length} 天` });

    // 网格线 + 刻度（3 条）
    for (let i = 0; i <= 2; i++) {
      const v = (max / 2) * i;
      const yy = Math.round(y(v)) + 0.5;
      root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, class: i === 0 ? 'viz-axis' : 'viz-grid' }));
      const t = svg('text', { x: pad.l - 6, y: yy + 3.5, class: 'viz-tick', 'text-anchor': 'end' });
      t.textContent = String(Math.round(v));
      root.append(t);
    }

    // 目标线（喝水）
    if (goal) {
      const gy = Math.round(y(goal)) + 0.5;
      root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: gy, y2: gy, class: 'viz-goal' }));
      const gt = svg('text', { x: W - pad.r, y: gy - 4, class: 'viz-tick', 'text-anchor': 'end' });
      gt.textContent = `目标 ${goal}`;
      root.append(gt);
    }

    // 柱子：顶部 4px 圆角，底部方的
    const lastIdx = days.length - 1;
    days.forEach((d, i) => {
      const v = values[i];
      const cx = pad.l + band * i + band / 2;
      const x = cx - bw / 2;
      const top = y(v);
      const hgt = pad.t + ih - top;
      const g = svg('g', { class: 'viz-bar', tabindex: '0', role: 'img', 'aria-label': `${fmtDateLong(d.date)}：${v} ${metric.unit}` });
      // 比柱子大的透明感应区
      g.append(svg('rect', { x: pad.l + band * i, y: pad.t, width: band, height: ih, class: 'viz-hit' }));
      if (v > 0) {
        const r = Math.min(4, bw / 2, hgt);
        const path = `M${x},${pad.t + ih} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + bw - r},${top} Q${x + bw},${top} ${x + bw},${top + r} L${x + bw},${pad.t + ih} Z`;
        g.append(svg('path', { d: path, class: 'viz-fill' }));
      }
      const label = `${fmtDateLong(d.date)}${i === lastIdx ? '（今天）' : ''}`;
      const value = `${v} ${metric.unit}`;
      g.addEventListener('pointerenter', () => showTip(g, value, label));
      g.addEventListener('pointerleave', hideTip);
      g.addEventListener('focus', () => showTip(g, value, label));
      g.addEventListener('blur', hideTip);
      root.append(g);
    });

    // 只给今天的柱子标数字
    const tv = values[lastIdx];
    if (tv > 0) {
      const lt = svg('text', { x: pad.l + band * lastIdx + band / 2, y: y(tv) - 4, class: 'viz-label', 'text-anchor': 'middle' });
      lt.textContent = String(tv);
      root.append(lt);
    }

    // 日期：首、中、尾
    const marks = [...new Set([0, Math.floor(lastIdx / 2), lastIdx])];
    for (const i of marks) {
      const t = svg('text', { x: pad.l + band * i + band / 2, y: H - 6, class: 'viz-tick', 'text-anchor': 'middle' });
      t.textContent = i === lastIdx ? '今天' : fmtDate(days[i].date);
      root.append(t);
    }
    return root;
  }

  function avg(days, key) {
    const sum = days.reduce((a, d) => a + (d[key] || 0), 0);
    const v = sum / days.length;
    return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  }

  function table(days) {
    const rows = [...days].reverse();
    return h('div', { class: 'card viz-table-wrap' },
      h('table', { class: 'viz-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '日期'), ...METRICS.map((m) => h('th', {}, `${m.title}（${m.unit}）`)))),
        h('tbody', {}, rows.map((d) => h('tr', {},
          h('td', {}, fmtDateLong(d.date)),
          ...METRICS.map((m) => h('td', {}, String(d[m.key] || 0))))))));
  }

  parts.stats = {
    render(el) {
      let view = 'chart';
      const rangeBtns = [7, 30].map((n) => {
        const b = h('button', { class: 'seg-btn' }, `最近 ${n} 天`);
        b.addEventListener('click', () => { range = n; redraw(); });
        return [n, b];
      });
      const viewBtns = [['chart', '图表'], ['table', '表格']].map(([k, label]) => {
        const b = h('button', { class: 'seg-btn' }, label);
        b.addEventListener('click', () => { view = k; redraw(); });
        return [k, b];
      });
      const bar = h('div', { class: 'viz-filters' },
        h('div', { class: 'seg' }, rangeBtns.map(([, b]) => b)),
        h('div', { class: 'seg' }, viewBtns.map(([, b]) => b)));
      const body = h('div');
      el.append(bar, body, tip);

      let lastSig = '';
      let state = null;
      function redraw() {
        if (!state) return;
        rangeBtns.forEach(([n, b]) => b.classList.toggle('active', n === range));
        viewBtns.forEach(([k, b]) => b.classList.toggle('active', k === view));
        const days = (state.history || []).slice(-range).map(derive);
        body.textContent = '';
        hideTip();
        if (view === 'table') {
          body.append(h('div', { class: 'section' }, h('h2', {}, `最近 ${range} 天`), table(days)));
          return;
        }
        body.append(h('div', { class: 'viz-grid-wrap' }, METRICS.map((m) => {
          const goal = m.goal ? m.goal(state) : 0;
          return h('div', { class: 'card viz-card', style: m.color ? `--viz-bar:${m.color}` : null },
            h('div', { class: 'viz-head' },
              h('b', {}, `${m.title}（${m.unit}）`),
              h('span', { class: 'muted' }, `平均 ${avg(days, m.key)} ${m.unit}/天`)),
            barChart(days, m, goal));
        })));
      }
      watch((s) => {
        state = s;
        const sig = JSON.stringify([s.history, s.settings && s.settings.waterGoal]);
        if (sig === lastSig) return;
        lastSig = sig;
        redraw();
      });
    },
  };
})();
