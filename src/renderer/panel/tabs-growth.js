// 控制面板：成长（等级、心情、衣柜）
(() => {
  'use strict';

  const { h, watch, text, act, toast, addTab, drawClawd } = window.ClawdPanel;

  const FESTIVAL_HATS = ['party', 'santa', 'witch', 'cny', 'bunny', 'heart'];
  const LEVEL_HATS = ['bow', 'flower', 'headphones', 'chef', 'grad', 'crown'];
  const FACES = ['shades', 'glasses'];

  function moodLabel(m) {
    if (m >= 80) return '超开心';
    if (m >= 55) return '开心';
    if (m >= 30) return '有点闷';
    return '很失落，陪陪它吧';
  }

  function bar(getRatio, cls = '') {
    const fill = h('div', { class: 'bar-fill' });
    watch((s) => { fill.style.width = `${Math.round(Math.max(0, Math.min(1, getRatio(s))) * 100)}%`; });
    return h('div', { class: `bar ${cls}` }, fill);
  }

  function unlockLevel(s, id) {
    const unlocks = s.unlocks || {};
    const found = Object.entries(unlocks).find(([, ids]) => ids.includes(id));
    return found ? Number(found[0]) : null;
  }

  // 衣柜里的一个格子
  function tile(slot, id) {
    const { outfits } = window.Clawd;
    const canvas = h('canvas', { width: 64, height: 56 });
    const name = id === 'none' ? (slot === 'hat' ? '不戴帽子' : '不戴') : outfits.ITEMS[id].name;
    const label = h('div', { class: 'tile-name' }, name);
    const lock = h('div', { class: 'tile-lock' });
    const el = h('button', { class: 'tile' }, canvas, label, lock);
    if (slot === 'hat') drawClawd(canvas, { hat: id === 'none' ? '' : id });
    else drawClawd(canvas, { face: id === 'none' ? '' : id });
    el.addEventListener('click', async () => {
      if (el.classList.contains('locked')) {
        toast(lock.textContent ? `${lock.textContent}` : '还没解锁');
        return;
      }
      const r = await act('setOutfit', { [slot]: id });
      if (r && !r.error) toast(id === 'none' ? '已摘下' : `换上了${name}`);
    });
    watch((s) => {
      const unlocked = (s.progress && s.progress.unlocked) || [];
      const isLocked = id !== 'none' && !unlocked.includes(id);
      const cur = ((s.settings && s.settings.outfit) || {})[slot] || 'none';
      el.classList.toggle('locked', isLocked);
      el.classList.toggle('active', !isLocked && cur === id);
      if (isLocked) {
        const lv = unlockLevel(s, id);
        lock.textContent = lv ? `Lv.${lv} 解锁` : '节日当天收集';
      } else {
        lock.textContent = '';
      }
    });
    return el;
  }

  addTab({
    id: 'growth',
    order: 40,
    title: '成长',
    icon: 'star',
    subtitle: '陪 Clawd 一起喝水、活动、做事，它会升级、解锁新装扮',
    render(el) {
      const big = h('canvas', { class: 'growth-clawd', width: 128, height: 112 });
      watch((s) => {
        const o = (s.settings && s.settings.outfit) || {};
        const unlocked = (s.progress && s.progress.unlocked) || [];
        const ok = (id) => (id && id !== 'none' && unlocked.includes(id) ? id : '');
        const mood = (s.progress && s.progress.mood) || 70;
        drawClawd(big, { hat: ok(o.hat), face: ok(o.face), pose: mood >= 80 ? { eyes: 'happy', blush: true } : mood < 30 ? { eyes: 'sad' } : {} });
      });

      el.append(
        h('div', { class: 'section' },
          h('div', { class: 'card growth-hero' },
            big,
            h('div', { class: 'growth-stats' },
              h('div', { class: 'growth-level' }, text((s) => `Lv.${(s.progress && s.progress.level) || 1}`)),
              h('div', { class: 'growth-row' },
                h('span', { class: 'muted' }, '经验'),
                bar((s) => (s.progress ? s.progress.levelXp / s.progress.levelNeed : 0)),
                text((s) => (s.progress ? `${s.progress.levelXp} / ${s.progress.levelNeed}` : ''), { class: 'mono muted' })),
              h('div', { class: 'growth-row' },
                h('span', { class: 'muted' }, '心情'),
                bar((s) => ((s.progress && s.progress.mood) || 0) / 100, 'mood'),
                text((s) => moodLabel((s.progress && s.progress.mood) || 0), { class: 'muted' })),
              text((s) => {
                const p = s.progress || {};
                if (!p.nextUnlock) return '所有等级奖励都拿到啦！';
                const ids = (s.unlocks || {})[p.nextUnlock] || [];
                const names = ids.map((id) => window.Clawd.outfits.ITEMS[id].name).join('、');
                return `Lv.${p.nextUnlock} 解锁：${names}`;
              }, { class: 'growth-next' })))),
        h('div', { class: 'section' },
          h('h2', {}, '帽子'),
          h('div', { class: 'tiles' }, tile('hat', 'none'), ...LEVEL_HATS.map((id) => tile('hat', id)))),
        h('div', { class: 'section' },
          h('h2', {}, '节日收藏（节日当天遇到就永久收下）'),
          h('div', { class: 'tiles' }, ...FESTIVAL_HATS.map((id) => tile('hat', id)))),
        h('div', { class: 'section' },
          h('h2', {}, '脸上'),
          h('div', { class: 'tiles' }, tile('face', 'none'), ...FACES.map((id) => tile('face', id)))),
        h('div', { class: 'section' },
          h('h2', {}, '怎么获得经验'),
          h('div', { class: 'card' },
            h('div', { class: 'note' },
              '喝水 +10 · 起来活动 +8 · 护眼 +5 · 完成待办 +6 · 专注每分钟 +2 · Claude Code 完成任务 +5 · 摸头和互动 +1（每天最多 20）· 节日 +20。',
              h('br'),
              '心情会随时间慢慢下降，喝水、活动、摸摸它都会让它开心。')),
        ),
      );
    },
  });
})();
