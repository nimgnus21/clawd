// 控制面板：衣柜 —— 买和穿在同一个地方
// 每件东西只有一种来路：用 ✦ 买 / 里程碑解锁 / 节日当天收下
(() => {
  'use strict';

  const { h, watch, text, act, toast, addTab, drawClawd } = window.ClawdPanel;
  const G = (s) => s.growth || {};
  const outfit = (s) => (s.settings && s.settings.outfit) || {};
  const NONE = { skin: 'classic', hat: 'none', face: 'none' };

  // 当前穿着（只算衣柜里有的）
  function wearing(s) {
    const o = outfit(s);
    const owned = (G(s).wardrobe || []).filter((x) => x.owned).map((x) => x.id);
    const ok = (id, slot) => (id && id !== NONE[slot] && owned.includes(id) ? id : NONE[slot]);
    return { skin: ok(o.skin, 'skin'), hat: ok(o.hat, 'hat'), face: ok(o.face, 'face') };
  }

  // 一个格子：预览 + 名字 + 状态（穿着 / 点击穿上 / ✦ 价格 / 里程碑进度 / 节日收下）
  function tile(item) {
    const { id, slot } = item;
    const canvas = h('canvas', { width: 64, height: 56 });
    const name = h('div', { class: 'tile-name' }, item.name);
    const meta = h('div', { class: 'tile-meta' });
    const prog = h('div', { class: 'tile-prog' }, h('i'));
    const el = h('button', { class: 'tile' }, canvas, name, meta, prog);
    let cur = item;
    let stars = 0;
    let armed = 0;

    const metaText = () => {
      if (cur.owned) return el.classList.contains('active') ? '穿着' : '点击穿上';
      if (cur.price) return `✦ ${cur.price}`;
      if (cur.progress) return `${cur.how} · ${cur.progress[0]}/${cur.progress[1]}`;
      return cur.how || '';
    };

    el.addEventListener('click', async () => {
      if (cur.owned) {
        // 再点一下正在戴的帽子 / 脸上的东西 = 摘下
        const off = el.classList.contains('active') && slot !== 'skin';
        const r = await act('setOutfit', { [slot]: off ? NONE[slot] : id });
        if (r && !r.error) toast(off ? `摘下了${cur.name}` : `换上了${cur.name}`);
        return;
      }
      if (!cur.price) {
        toast(cur.how ? `${cur.how}就能拿到` : '还拿不到');
        return;
      }
      if (stars < cur.price) {
        toast(`✦ 还差 ${cur.price - stars}，合环就能攒`, 'err');
        return;
      }
      // 买东西点两下：第一下确认，3 秒内再点才买
      if (!armed || Date.now() - armed > 3000) {
        armed = Date.now();
        el.classList.add('armed');
        meta.textContent = `再点一次，花 ${cur.price}✦`;
        setTimeout(() => {
          if (armed && Date.now() - armed >= 2900) {
            armed = 0;
            el.classList.remove('armed');
            meta.textContent = metaText();
          }
        }, 3000);
        return;
      }
      armed = 0;
      el.classList.remove('armed');
      const r = await act('wardrobeBuy', id);
      if (r && r.ok) toast(`买下了${cur.name}，已经穿上 ✻`);
    });

    watch((s) => {
      cur = (G(s).wardrobe || []).find((x) => x.id === id) || item;
      stars = G(s).stars || 0;
      const w = wearing(s);
      const on = w[slot] === id;
      // 预览：皮肤看本体；帽子和脸上的东西穿在当前皮肤上
      if (slot === 'skin') drawClawd(canvas, { skin: id, pose: { eyes: on ? 'happy' : 'open' } });
      else drawClawd(canvas, { skin: w.skin, [slot]: id });
      el.classList.toggle('active', !!cur.owned && on);
      el.classList.toggle('locked', !cur.owned);
      el.classList.toggle('buyable', !cur.owned && !!cur.price && stars >= cur.price);
      el.classList.toggle('milestone', !cur.owned && !!cur.progress);
      prog.classList.toggle('hidden', !(!cur.owned && cur.progress));
      if (cur.progress) prog.firstChild.style.width = `${Math.round((cur.progress[0] / cur.progress[1]) * 100)}%`;
      if (!el.classList.contains('armed')) meta.textContent = metaText();
    });
    return el;
  }

  function group(title, items) {
    return h('div', { class: 'section' }, h('h2', {}, title), h('div', { class: 'tiles' }, items.map(tile)));
  }

  addTab({
    id: 'wardrobe',
    order: 20,
    title: '衣柜',
    icon: 'shirt',
    subtitle: '用 ✦ 买，或者靠坚持解锁。点一下穿上，再点一下摘下',
    render(el) {
      const st = window.ClawdPanel.state || {};
      const list = G(st).wardrobe || [];
      const big = h('canvas', { class: 'today-clawd', width: 120, height: 105 });
      const lvFill = h('div', { class: 'bar-fill' });
      watch((s) => {
        const w = wearing(s);
        drawClawd(big, { skin: w.skin, hat: w.hat === 'none' ? '' : w.hat, face: w.face === 'none' ? '' : w.face, pose: { eyes: 'happy', blush: true } });
        const g = G(s);
        const span = Math.max(1, (g.levelTo || 30) - (g.levelFrom || 0));
        lvFill.style.width = `${Math.round(Math.min(1, ((g.earned || 0) - (g.levelFrom || 0)) / span) * 100)}%`;
      });
      el.append(
        h('div', { class: 'section' },
          h('div', { class: 'card today-hero' },
            big,
            h('div', { class: 'today-hello' },
              h('div', { class: 'wallet' }, text((s) => `✦ ${G(s).stars || 0}`)),
              h('div', { class: 'level-row' },
                text((s) => `Lv.${G(s).level || 1}`, { class: 'level-tag' }),
                h('div', { class: 'bar' }, lvFill),
                text((s) => `${(G(s).earned || 0) - (G(s).levelFrom || 0)} / ${(G(s).levelTo || 30) - (G(s).levelFrom || 0)}`, { class: 'mono small-muted' })),
              h('div', { class: 'small-muted' }, '合上一个环 +10✦，三环全满再 +10✦，连续打卡 3 / 7 / 14 / 30 … 天有奖励。累计得到的 ✦ 决定等级。')))),
        group('皮肤', list.filter((x) => x.slot === 'skin')),
        group('帽子', list.filter((x) => x.slot === 'hat' && !x.festival)),
        group('脸上和身上', list.filter((x) => x.slot === 'face')),
        group('节日收藏（节日当天自动戴上，戴过就收下）', list.filter((x) => x.festival)),
      );
    },
  });
})();
