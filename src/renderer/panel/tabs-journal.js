// 控制面板：成就徽章、Clawd 日记和本周回顾
(() => {
  'use strict';

  const { h, live, text, addTab } = window.ClawdPanel;
  const G = (s) => s.growth || {};

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  function badge(a) {
    const got = !!a.at;
    const ratio = a.progress ? a.progress[0] / a.progress[1] : 0;
    return h('div', { class: `badge-card${got ? ' got' : ''}${a.hidden && !got ? ' secret' : ''}` },
      h('div', { class: 'badge-icon' }, a.icon),
      h('div', { class: 'badge-body' },
        h('b', {}, a.name),
        h('small', {}, a.desc),
        got
          ? h('small', { class: 'badge-meta' }, `${fmtDate(a.at)} 解锁 · +${a.stars}✦`)
          : a.progress
            ? h('div', { class: 'badge-progress' },
              h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${Math.round(ratio * 100)}%` })),
              h('span', { class: 'mono muted' }, `${a.progress[0]}/${a.progress[1]}`))
            : h('small', { class: 'badge-meta' }, `奖励 ${a.stars}✦`)));
  }

  addTab({
    id: 'achievements',
    order: 43,
    title: '成就',
    icon: 'trophy',
    subtitle: '长期坚持的小纪念。还有几个隐藏成就，碰巧做到才会解锁',
    render(el) {
      el.append(
        h('div', { class: 'section' },
          h('div', { class: 'card hero' },
            h('div', { class: 'shop-stars' }, text((s) => `${G(s).achievementCount || 0}`)),
            h('div', {},
              h('div', { class: 'big' }, text((s) => `已解锁 ${G(s).achievementCount || 0} / ${(G(s).achievements || []).length} 个成就`)),
              text((s) => {
                const n = G(s).achievementCount || 0;
                const need = G(s).galaxyNeed || 10;
                return n >= need ? '星空皮肤已经是你的了 ✨' : `再解锁 ${need - n} 个，送星空皮肤 ✨`;
              }, { class: 'small-muted' })))),
        live(h('div', { class: 'badges' }), (s) => G(s).achievements, (s) => {
          const list = [...(G(s).achievements || [])];
          // 已解锁的在前（新的在前），然后是快完成的
          list.sort((a, b) => (b.at - a.at) || ((b.progress ? b.progress[0] / b.progress[1] : -1) - (a.progress ? a.progress[0] / a.progress[1] : -1)));
          return list.map(badge);
        }),
      );
    },
  });

  // ================= 日记 =================
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
    id: 'diary',
    order: 44,
    title: '日记',
    icon: 'book',
    subtitle: 'Clawd 每天帮你记一笔：喝了多少水、专注了多久、一起做了什么',
    render(el) {
      el.append(
        h('div', { class: 'section' }, h('h2', {}, '本周回顾（最近 7 天 vs 再之前 7 天）'), live(h('div'), (s) => s.week, (s) => recap(s.week))),
        h('div', { class: 'section' }, h('h2', {}, '最近的日记'), live(h('div', { class: 'diaries' }), (s) => s.diary, (s) => (s.diary || []).map(entry))),
      );
    },
  });
})();
