// 控制面板：今天 —— 打开面板第一眼看到的页面
//   Clawd 和它的心情 → 今日三环（顺手记一笔）→ 连续打卡 → 陪你干活（Claude Code、专注、勿扰）→ 待办
(() => {
  'use strict';

  const { h, watch, live, text, act, toast, status, hhmm, addTab, parts, drawClawd, show } = window.ClawdPanel;
  const SVG = 'http://www.w3.org/2000/svg';
  const G = (s) => s.growth || {};

  function svg(tag, attrs = {}) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function greeting() {
    const hr = new Date().getHours();
    if (hr < 5) return '夜深了';
    if (hr < 11) return '早上好';
    if (hr < 13) return '中午好';
    if (hr < 18) return '下午好';
    return '晚上好';
  }

  // Clawd 想说的一句话：跟着三环走
  function moodLine(g) {
    const closed = (g.rings || []).filter((r) => r.closed).length;
    if (closed >= 3) return '三环全满，今天照顾得太好了 ✻';
    if (closed >= (g.checkinRings || 2)) return '今天已经打卡啦，Clawd 很开心';
    if ((g.mood || 65) < 30) return '今天还没怎么动呢，起来走走、喝口水吧';
    const left = (g.checkinRings || 2) - closed;
    return `再合上 ${left} 个环就算今天打卡`;
  }

  // 一个环：圆形进度 + 数字 + 顺手记一笔的按钮
  const RING_COLOR = { water: 'var(--ring-water)', move: 'var(--ring-move)', focus: 'var(--ring-focus)' };
  const QUICK = {
    water: ['喝了一杯', () => act('petCommand', 'drink').then(() => toast('记下了，咕嘟咕嘟 💧'))],
    move: ['动了一下', () => act('logBreak').then(() => toast('活动 +1 ✓'))],
    focus: ['专注 25 分钟', () => act('petCommand', 'focus-25').then(() => toast('开始专注 25 分钟，Clawd 陪你敲键盘'))],
  };

  function ringCard(id) {
    const R = 32;
    const C = 2 * Math.PI * R;
    const track = svg('circle', { cx: 40, cy: 40, r: R, class: 'ring-track' });
    const bar = svg('circle', { cx: 40, cy: 40, r: R, class: 'ring-bar', 'stroke-dasharray': `0 ${C}` });
    bar.style.stroke = RING_COLOR[id];
    const g = svg('svg', { viewBox: '0 0 80 80', class: 'ring-svg' });
    g.append(track, bar);
    const icon = h('div', { class: 'ring-icon' });
    const value = h('div', { class: 'ring-value' });
    const name = h('div', { class: 'ring-name' });
    const how = h('div', { class: 'ring-how' });
    const [label, fn] = QUICK[id];
    const btn = h('button', { class: 'btn small' }, label);
    btn.addEventListener('click', fn);
    const card = h('div', { class: 'ring-card' }, h('div', { class: 'ring-dial' }, g, icon), value, name, how, btn);
    watch((s) => {
      const r = (G(s).rings || []).find((x) => x.id === id);
      if (!r) return;
      const p = Math.min(1, r.value / r.goal);
      bar.setAttribute('stroke-dasharray', `${(C * p).toFixed(1)} ${C.toFixed(1)}`);
      icon.textContent = r.closed ? '✓' : r.icon;
      icon.classList.toggle('done', r.closed);
      value.textContent = '';
      value.append(h('b', {}, String(r.value)), ` / ${r.goal} ${r.unit}`);
      name.textContent = r.closed ? `${r.name}环 已合上` : r.name;
      how.textContent = r.how;
      card.classList.toggle('closed', r.closed);
    });
    return card;
  }

  function calendar(cal) {
    return h('div', { class: 'cal' }, cal.map((d) => {
      const cls = ['cal-day', d.checkin ? 'on' : '', d.all ? 'all' : '', d.weekend ? 'weekend' : '', d.today ? 'today' : ''].filter(Boolean).join(' ');
      const tip = `${d.day}${d.checkin ? ` 打卡 · 合了 ${d.rings} 环` : ''}`;
      return h('div', { class: cls, title: tip }, h('i'), h('small', {}, Number(d.day.slice(8))));
    }));
  }

  function ccLine(s) {
    const c = s.cc || {};
    if (!c.enabled) return ['', 'Claude Code 联动已关闭'];
    if (!c.installed) return ['warn', '还没接入 Claude Code'];
    if (!c.listening) return ['err', 'Clawd 的本机服务没有启动'];
    if (c.active) return ['ok', `Claude Code 正在干活（${c.active} 个任务）`];
    return ['ok', 'Claude Code 已接入，干活时 Clawd 会陪着'];
  }

  function dndLine(s) {
    const d = s.dnd || {};
    if (!d.active) return ['', '没有勿扰'];
    if (d.reason === 'manual') return ['warn', `勿扰到 ${hhmm(d.manualUntil)}`];
    return ['warn', '全屏中，自动勿扰'];
  }

  addTab({
    id: 'today',
    order: 10,
    title: '今天',
    icon: 'sun',
    subtitle: '照顾好自己，Clawd 就开心',
    badge: (s) => {
      const open = (s.todos || []).filter((t) => !t.done).length;
      return open ? String(open) : '';
    },
    render(el) {
      // ---- Clawd 和心情 ----
      const pic = h('canvas', { class: 'today-clawd', width: 120, height: 105 });
      watch((s) => {
        const o = (s.settings && s.settings.outfit) || {};
        const owned = (G(s).wardrobe || []).filter((x) => x.owned).map((x) => x.id);
        const ok = (id) => (id && id !== 'none' && owned.includes(id) ? id : '');
        const mood = G(s).mood || 65;
        drawClawd(pic, {
          hat: ok(o.hat), face: ok(o.face), skin: ok(o.skin) || 'classic',
          pose: mood >= 80 ? { eyes: 'happy', blush: true, armL: 'up', armR: 'up' } : mood < 30 ? { eyes: 'sad' } : {},
        });
      });
      el.append(h('div', { class: 'section' },
        h('div', { class: 'card today-hero' },
          pic,
          h('div', { class: 'today-hello' },
            h('div', { class: 'today-title' }, text(() => greeting())),
            text((s) => moodLine(G(s)), { class: 'today-mood' }),
            h('div', { class: 'pills' },
              text((s) => `Lv.${G(s).level || 1}`, { class: 'pill' }),
              text((s) => `✦ ${G(s).stars || 0}`, { class: 'pill star', title: '合环、连续打卡得到的 ✦，在衣柜里用' }),
              text((s) => `🔥 ${(G(s).streak || {}).count || 0} 天`, { class: 'pill fire', title: '连续打卡天数' }))))));

      // ---- 今日三环 ----
      el.append(h('div', { class: 'section' },
        h('div', { class: 'section-head' },
          h('h2', {}, '今日三环'),
          text((s) => {
            const g = G(s);
            if (g.closed >= 3) return '三环全满 🎉';
            if ((g.streak || {}).checkedToday) return `已打卡 ✓ · 合了 ${g.closed}/3`;
            return `合上 ${g.checkinRings || 2} 个就算打卡 · ${g.closed || 0}/3`;
          }, { class: 'small-muted' })),
        h('div', { class: 'rings' }, ringCard('water'), ringCard('move'), ringCard('focus')),
        text((s) => `每合上一个环 +${G(s).ringStars || 10}✦，三环全满再 +${G(s).allBonus || 10}✦。目标可以在「设置 → 照顾自己」里改。`, { class: 'hint' })));

      // ---- 连续打卡 ----
      el.append(h('div', { class: 'section' },
        h('div', { class: 'section-head' },
          h('h2', {}, '连续打卡'),
          text((s) => {
            const st = G(s).streak || {};
            return `最长 ${st.best || 0} 天 · 补签卡 ${st.freezes || 0}/${st.maxFreezes || 2}`;
          }, { class: 'small-muted' })),
        h('div', { class: 'card streak-card' },
          h('div', { class: 'streak-big' },
            text((s) => `🔥 ${(G(s).streak || {}).count || 0}`, { class: 'streak-num' }),
            text((s) => {
              const st = G(s).streak || {};
              const today = st.checkedToday ? '今天已打卡。' : '今天还没打卡。';
              const next = st.next ? `再坚持 ${st.next - (st.count || 0)} 天到 ${st.next} 天，奖励 ${st.nextStars}✦。` : '';
              return `${today}${next}每连续 7 天送一张补签卡，哪天忘了会自动用掉；周末默认休息不算断。`;
            }, { class: 'streak-text' })),
          live(h('div'), (s) => G(s).calendar, (s) => calendar(G(s).calendar || [])))));

      // ---- 陪你干活 ----
      el.append(h('div', { class: 'section' },
        h('h2', {}, '陪你干活'),
        h('div', { class: 'card' },
          h('div', { class: 'row' }, h('div', { class: 'label' }, status(ccLine)),
            h('div', { class: 'ctrl' }, h('button', { class: 'btn small', onclick: () => show('settings:claude') }, '设置'))),
          h('div', { class: 'row' }, h('div', { class: 'label' }, h('b', {}, '专注计时'), h('small', {}, '专注时 Clawd 在旁边敲键盘，时间算进专注环')),
            h('div', { class: 'ctrl' },
              h('button', { class: 'btn small', onclick: () => act('petCommand', 'focus-25').then(() => toast('开始专注 25 分钟')) }, '25 分钟'),
              h('button', { class: 'btn small', onclick: () => act('petCommand', 'focus-45').then(() => toast('开始专注 45 分钟')) }, '45 分钟'))),
          h('div', { class: 'row' }, h('div', { class: 'label' }, status(dndLine)),
            h('div', { class: 'ctrl' },
              h('button', { class: 'btn small', onclick: () => act('dndManual', 60).then(() => toast('勿扰 1 小时')) }, '勿扰 1 小时'),
              h('button', { class: 'btn small', onclick: () => act('dndManual', 0) }, '结束'))))));

      // ---- 待办 ----
      const todo = h('div', { 'data-anchor': 'todo' });
      parts.todo.render(todo);
      el.append(todo);
    },
  });
})();
