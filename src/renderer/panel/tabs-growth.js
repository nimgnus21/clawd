// 控制面板：成长（等级、心情、星星、每日任务、连续打卡）和衣柜
(() => {
  'use strict';

  const { h, watch, live, text, act, toast, toggle, row, addTab, drawClawd } = window.ClawdPanel;

  const LEVEL_HATS = ['bow', 'flower', 'headphones', 'chef', 'grad', 'crown'];
  const SHOP_HATS = ['sprout', 'starclip', 'catears', 'halo', 'horns'];
  const FESTIVAL_HATS = ['party', 'santa', 'witch', 'cny', 'bunny', 'heart'];
  const FACES = ['shades', 'glasses', 'scarf'];
  const GROUP_ICON = { health: '💪', work: '💼', fun: '🎈' };

  const G = (s) => s.growth || {};

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

  function staticBar(ratio, cls = '') {
    return h('div', { class: `bar ${cls}` }, h('div', { class: 'bar-fill', style: `width:${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` }));
  }

  // 穿着当前装扮和皮肤的大 Clawd
  function bigClawd() {
    const big = h('canvas', { class: 'growth-clawd', width: 128, height: 112 });
    watch((s) => {
      const o = (s.settings && s.settings.outfit) || {};
      const unlocked = (s.progress && s.progress.unlocked) || [];
      const ok = (id) => (id && id !== 'none' && unlocked.includes(id) ? id : '');
      const mood = (s.progress && s.progress.mood) || 70;
      drawClawd(big, {
        hat: ok(o.hat), face: ok(o.face), skin: G(s).skin,
        pose: mood >= 80 ? { eyes: 'happy', blush: true } : mood < 30 ? { eyes: 'sad' } : {},
      });
    });
    return big;
  }

  // ================= 成长 =================
  function questRow(q, reward) {
    const ratio = q.have / q.target;
    return h('div', { class: `quest${q.done ? ' done' : ''}` },
      h('div', { class: 'quest-icon' }, GROUP_ICON[q.group] || '✦'),
      h('div', { class: 'quest-main' },
        h('div', { class: 'quest-title' }, q.title),
        h('div', { class: 'quest-bar' }, staticBar(ratio), h('span', { class: 'mono muted' }, `${q.have}/${q.target}`))),
      h('div', { class: 'quest-reward' }, q.done ? '✓ 完成' : `+${reward.stars}✦`));
  }

  function calendarStrip(cal) {
    return h('div', { class: 'cal' }, cal.map((d) => {
      const day = Number(d.day.slice(8));
      const cls = ['cal-day', d.checkin ? 'on' : '', d.chest ? 'chest' : '', d.weekend ? 'weekend' : '', d.today ? 'today' : ''].filter(Boolean).join(' ');
      return h('div', { class: cls, title: `${d.day}${d.checkin ? ' 已打卡' : ''}${d.chest ? ' · 开了宝箱' : ''}` },
        h('span', {}, d.checkin ? (d.chest ? '🧰' : '🔥') : ''), h('small', {}, day));
    }));
  }

  addTab({
    id: 'growth',
    order: 40,
    title: '成长',
    icon: 'star',
    subtitle: '每天三个小任务，完成两个就算打卡。坚持下去，Clawd 会越来越厉害',
    badge: (s) => {
      const q = G(s).quests || [];
      const left = q.filter((x) => !x.done).length;
      return left && q.length ? String(left) : '';
    },
    render(el) {
      el.append(
        h('div', { class: 'section' },
          h('div', { class: 'card growth-hero' },
            bigClawd(),
            h('div', { class: 'growth-stats' },
              h('div', { class: 'growth-top' },
                h('div', { class: 'growth-level' }, text((s) => `Lv.${(s.progress && s.progress.level) || 1}`)),
                h('div', { class: 'pills' },
                  text((s) => `✦ ${G(s).stars || 0}`, { class: 'pill star', title: '星星：做任务、打卡、成就、礼物都会给，可以去小卖部花' }),
                  text((s) => `🔥 ${(G(s).streak || {}).count || 0} 天`, { class: 'pill fire', title: '连续打卡天数' }),
                  text((s) => `🎫 ×${(G(s).streak || {}).freezes || 0}`, { class: 'pill', title: '补签卡：哪天忘了打卡会自动用掉一张，保住连续天数。每连续 7 天送一张，最多存 2 张' }))),
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
          h('div', { class: 'section-head' },
            h('h2', {}, '今日任务'),
            text((s) => {
              const g = G(s);
              const done = (g.quests || []).filter((q) => q.done).length;
              if (g.chest) return '全部完成 🎉';
              if (g.streak && g.streak.checkedToday) return `已打卡 ✓ · ${done}/3`;
              return `完成 ${g.checkinNeed || 2} 个就算打卡 · ${done}/3`;
            }, { class: 'muted small-muted' })),
          live(h('div', { class: 'card quests' }), (s) => [G(s).quests, G(s).chest], (s) => {
            const g = G(s);
            const reward = g.questReward || { stars: 10 };
            return [
              ...(g.quests || []).map((q) => questRow(q, reward)),
              h('div', { class: `quest chest${g.chest ? ' done' : ''}` },
                h('div', { class: 'quest-icon' }, '🧰'),
                h('div', { class: 'quest-main' },
                  h('div', { class: 'quest-title' }, g.chest ? '今天的宝箱已经打开' : '三个都完成：打开宝箱'),
                  h('small', { class: 'muted' }, `+${(g.chestReward || {}).stars || 30}✦ 和一份随机零食`)),
                h('div', { class: 'quest-reward' }, g.chest ? '✓' : '')),
            ];
          }),
          h('p', { class: 'hint' }, '任务每天早上换一批。喝水、活动、专注、待办、Claude Code、摸摸它、喂零食……做着做着就完成了。')),

        h('div', { class: 'section' },
          h('div', { class: 'section-head' },
            h('h2', {}, '连续打卡'),
            text((s) => {
              const st = G(s).streak || {};
              return `最长 ${st.best || 0} 天`;
            }, { class: 'muted small-muted' })),
          h('div', { class: 'card streak-card' },
            live(h('div'), (s) => G(s).calendar, (s) => calendarStrip(G(s).calendar || [])),
            live(h('div', { class: 'milestones' }), (s) => [G(s).streak, G(s).milestones], (s) => {
              const g = G(s);
              const st = g.streak || {};
              return Object.entries(g.milestones || {}).map(([d, m]) => {
                const reached = (st.best || 0) >= Number(d);
                return h('div', { class: `milestone${reached ? ' on' : ''}${Number(d) === st.next ? ' next' : ''}`, title: `连续 ${d} 天：${m.stars}✦${m.skin ? ' + 金色皮肤' : ''}` },
                  h('b', {}, `${d}天`), h('small', {}, m.skin ? `${m.stars}✦+皮肤` : `${m.stars}✦`));
              });
            }),
            text((s) => {
              const st = G(s).streak || {};
              const today = st.checkedToday ? '今天已经打卡 ✓。' : '今天还没打卡，完成 2 个任务就行。';
              const next = st.next ? `再坚持 ${st.next - (st.count || 0)} 天到「连续 ${st.next} 天」，奖励 ${st.nextReward.stars}✦${st.nextReward.skin ? ' 和金色皮肤' : ''}。` : '';
              return today + next;
            }, { class: 'hint' }))),

        h('div', { class: 'section' },
          h('h2', {}, '设置'),
          h('div', { class: 'card' },
            row('周末休息不断签', '周六、周日没打卡不算断', toggle((s) => (G(s).config || {}).weekendRest, (v) => act('growthSet', { weekendRest: v }))),
            row('早安播报', '每天第一次见面时说一下今天的任务', toggle((s) => (G(s).config || {}).morning, (v) => act('growthSet', { morning: v }))),
            row('每日惊喜礼物', '每天某个时候地上会出现一个礼物盒，点开有星星、零食，偶尔有稀有配饰', toggle((s) => (G(s).config || {}).gift, (v) => act('growthSet', { gift: v }))))),

        h('div', { class: 'section' },
          h('h2', {}, '怎么变强'),
          h('div', { class: 'card' },
            h('div', { class: 'note' },
              '经验：喝水 +10 · 起来活动 +8 · 护眼 +5 · 完成待办 +6 · 专注每分钟 +2 · Claude Code 完成任务 +5 · 每日任务 +15 · 摸头和跳舞每天最多 +20。',
              h('br'),
              '星星 ✦：每日任务 +10 · 宝箱 +30 · 连续打卡里程碑 · 成就 · 每日礼物。在「小卖部」买零食、皮肤和配饰。',
              h('br'),
              '心情会随时间慢慢下降；喝水、活动、摸摸它、喂它零食都会让它开心。')),
        ),
      );
    },
  });

  // ================= 衣柜 =================
  function lockText(s, slot, id) {
    const lv = Object.entries(s.unlocks || {}).find(([, ids]) => ids.includes(id));
    if (lv) return `Lv.${lv[0]} 解锁`;
    const shop = (G(s).shopItems || []).find((x) => x.id === id);
    if (shop) return `小卖部 ${shop.price}✦`;
    if (FESTIVAL_HATS.includes(id)) return '节日当天收集';
    return '还没解锁';
  }

  function outfitTile(slot, id) {
    const { outfits } = window.Clawd;
    const canvas = h('canvas', { width: 64, height: 56 });
    const name = id === 'none' ? (slot === 'hat' ? '不戴帽子' : '不戴') : outfits.ITEMS[id].name;
    const lock = h('div', { class: 'tile-lock' });
    const el = h('button', { class: 'tile' }, canvas, h('div', { class: 'tile-name' }, name), lock);
    el.addEventListener('click', async () => {
      if (el.classList.contains('locked')) {
        toast(lock.textContent || '还没解锁');
        return;
      }
      const r = await act('setOutfit', { [slot]: id });
      if (r && !r.error) toast(id === 'none' ? '已摘下' : `换上了${name}`);
    });
    watch((s) => {
      const skin = G(s).skin;
      if (slot === 'hat') drawClawd(canvas, { hat: id === 'none' ? '' : id, skin });
      else drawClawd(canvas, { face: id === 'none' ? '' : id, skin });
      const unlocked = (s.progress && s.progress.unlocked) || [];
      const isLocked = id !== 'none' && !unlocked.includes(id);
      const cur = ((s.settings && s.settings.outfit) || {})[slot] || 'none';
      el.classList.toggle('locked', isLocked);
      el.classList.toggle('active', !isLocked && cur === id);
      lock.textContent = isLocked ? lockText(s, slot, id) : '';
    });
    return el;
  }

  function skinTile(id) {
    const canvas = h('canvas', { width: 64, height: 56 });
    const nameEl = h('div', { class: 'tile-name' });
    const lock = h('div', { class: 'tile-lock' });
    const el = h('button', { class: 'tile' }, canvas, nameEl, lock);
    drawClawd(canvas, { skin: id });
    el.addEventListener('click', async () => {
      if (el.classList.contains('locked')) {
        toast(lock.textContent || '还没有');
        return;
      }
      const r = await act('growthSkin', id);
      if (r && !r.error) toast(`换成${nameEl.textContent}皮肤`);
    });
    watch((s) => {
      const sk = (G(s).skins || []).find((x) => x.id === id) || {};
      nameEl.textContent = sk.name || id;
      el.classList.toggle('locked', !sk.owned);
      el.classList.toggle('active', !!sk.owned && G(s).skin === id);
      lock.textContent = sk.owned ? '' : sk.unlock || `小卖部 ${sk.price}✦`;
    });
    return el;
  }

  const SKIN_IDS = ['classic', 'mint', 'lavender', 'sakura', 'ocean', 'cocoa', 'night', 'gold', 'galaxy'];

  addTab({
    id: 'wardrobe',
    order: 41,
    title: '衣柜',
    icon: 'shirt',
    subtitle: '皮肤、帽子和脸上的小东西。灰色的还没拿到，点一下看看怎么获得',
    render(el) {
      el.append(
        h('div', { class: 'section' }, h('h2', {}, '皮肤'), h('div', { class: 'tiles' }, ...SKIN_IDS.map(skinTile))),
        h('div', { class: 'section' }, h('h2', {}, '帽子（升级解锁）'), h('div', { class: 'tiles' }, outfitTile('hat', 'none'), ...LEVEL_HATS.map((id) => outfitTile('hat', id)))),
        h('div', { class: 'section' }, h('h2', {}, '帽子（小卖部）'), h('div', { class: 'tiles' }, ...SHOP_HATS.map((id) => outfitTile('hat', id)))),
        h('div', { class: 'section' }, h('h2', {}, '节日收藏（节日当天遇到就永久收下）'), h('div', { class: 'tiles' }, ...FESTIVAL_HATS.map((id) => outfitTile('hat', id)))),
        h('div', { class: 'section' }, h('h2', {}, '脸上和身上'), h('div', { class: 'tiles' }, outfitTile('face', 'none'), ...FACES.map((id) => outfitTile('face', id)))),
      );
    },
  });
})();
