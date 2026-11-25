// 控制面板：回顾 —— 这周和上周比、每天的图表、Clawd 的日记
(() => {
  'use strict';

  const { h, live, addTab, parts } = window.ClawdPanel;

  const MOOD_ICON = { great: '☀️', good: '⛅', quiet: '🌙' };

  function recap(week) {
    if (!week) return null;
    return h('div', { class: 'card recap' },
      h('div', { class: 'recap-head' }, week.headline),
      h('div', { class: 'recap-grid' }, week.items.map((x) => {
        const diff = x.now - x.before;
        const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
        return h('div', { class: 'recap-item' },
          h('small', { class: 'muted' }, x.label),
          h('b', {}, `${x.now}`, h('span', { class: 'muted unit' }, ` ${x.unit}`)),
          h('small', { class: `delta ${cls}` }, diff === 0 ? '和上周一样' : `${diff > 0 ? '↑' : '↓'} ${Math.abs(diff)}（上周 ${x.before}）`));
      })));
  }

  function entry(e) {
    return h('div', { class: 'card diary' },
      h('div', { class: 'diary-head' }, h('span', { class: 'diary-mood' }, MOOD_ICON[e.mood] || ''), h('b', {}, e.title)),
      h('p', {}, e.opener),
      e.lines.length ? h('ul', {}, e.lines.map((l) => h('li', {}, l))) : null,
      h('p', { class: 'diary-close' }, e.closer, h('span', { class: 'muted' }, '　—— Clawd')));
  }

  addTab({
    id: 'review',
    order: 30,
    title: '回顾',
    icon: 'chart',
    subtitle: '这周过得怎么样：和上周比、每天的变化、Clawd 写的日记',
    render(el) {
      const charts = h('div', { class: 'section' }, h('h2', {}, '每天'));
      parts.stats.render(charts);
      el.append(
        h('div', { class: 'section' }, h('h2', {}, '本周回顾（最近 7 天 vs 再之前 7 天）'), live(h('div'), (s) => s.week, (s) => recap(s.week))),
        charts,
        h('div', { class: 'section', 'data-anchor': 'diary' }, h('h2', {}, 'Clawd 的日记'), live(h('div', { class: 'diaries' }), (s) => s.diary, (s) => (s.diary || []).map(entry))),
      );
    },
  });
})();
