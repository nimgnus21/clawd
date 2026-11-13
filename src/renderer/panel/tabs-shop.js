// 控制面板：小卖部（零食、皮肤、配饰），用星星 ✦ 买
(() => {
  'use strict';

  const { h, watch, live, text, act, toast, addTab, drawClawd } = window.ClawdPanel;
  const G = (s) => s.growth || {};

  // 买东西要点两下：第一下变成“再点一次确认”，3 秒内再点才买，防手滑
  function confirmClick(el, labelEl, getConfirmText, onConfirm) {
    let armed = 0;
    let saved = '';
    el.addEventListener('click', async () => {
      if (armed && Date.now() - armed < 3000) {
        armed = 0;
        labelEl.textContent = saved;
        el.classList.remove('armed');
        await onConfirm();
        return;
      }
      const t = getConfirmText();
      if (!t) return;
      armed = Date.now();
      saved = labelEl.textContent;
      labelEl.textContent = t;
      el.classList.add('armed');
      setTimeout(() => {
        if (armed && Date.now() - armed >= 2900) {
          armed = 0;
          labelEl.textContent = saved;
          el.classList.remove('armed');
        }
      }, 3000);
    });
  }

  function snackRow(id) {
    const emoji = h('div', { class: 'snack-emoji' });
    const name = h('b');
    const info = h('small', { class: 'muted' });
    const have = h('span', { class: 'chip' });
    const buyLabel = h('span');
    const buy = h('button', { class: 'btn small' }, buyLabel);
    const feed = h('button', { class: 'btn small primary' }, '喂它');
    let snack = {};
    let stars = 0;
    confirmClick(buy, buyLabel, () => {
      if (stars < snack.price) {
        toast(`星星不够（还差 ${snack.price - stars}✦）`, 'err');
        return '';
      }
      return `确认 -${snack.price}✦`;
    }, async () => {
      const r = await act('growthBuy', 'snack', id);
      if (r && r.ok) toast(`买了一个${snack.name}，现在有 ${r.have} 个`);
    });
    feed.addEventListener('click', async () => {
      const r = await act('growthFeed', id);
      if (r && r.ok) toast(r.favorite ? `${snack.name}是它今天的最爱，心情加倍！` : `Clawd 吃了${snack.name}`);
    });
    watch((s) => {
      const g = G(s);
      snack = (g.snacks || []).find((x) => x.id === id) || {};
      stars = g.stars || 0;
      const fav = g.favorite === id;
      emoji.textContent = snack.emoji || '';
      name.textContent = snack.name || id;
      info.textContent = `心情 +${snack.mood}${fav ? '（今天最爱，翻倍！）' : ''}`;
      have.textContent = `有 ${snack.have || 0} 个`;
      have.classList.toggle('warn', fav);
      buyLabel.textContent = buy.classList.contains('armed') ? buyLabel.textContent : `买 ${snack.price}✦`;
      feed.disabled = !(snack.have > 0);
    });
    return h('div', { class: 'row snack' }, emoji, h('div', { class: 'label' }, name, info), h('div', { class: 'ctrl' }, have, buy, feed));
  }

  // 皮肤 / 配饰格子：没有就买，有了就穿上
  function shopTile(kind, id) {
    const canvas = h('canvas', { width: 64, height: 56 });
    const nameEl = h('div', { class: 'tile-name' });
    const price = h('div', { class: 'tile-lock' });
    const el = h('button', { class: 'tile shop-tile' }, canvas, nameEl, price);
    let item = {};
    let stars = 0;
    confirmClick(el, price, () => {
      if (item.owned) {
        // 已经有了：直接穿上
        if (kind === 'skin') act('growthSkin', id).then((r) => r && r.ok && toast(`换成${item.name}皮肤`));
        else act('setOutfit', { [id === 'scarf' ? 'face' : 'hat']: id }).then((r) => r && r.ok && toast(`换上了${item.name}`));
        return '';
      }
      if (!item.price) {
        toast(item.unlock ? `${item.unlock}解锁` : '买不了');
        return '';
      }
      if (stars < item.price) {
        toast(`星星不够（还差 ${item.price - stars}✦）`, 'err');
        return '';
      }
      return `再点一次 -${item.price}✦`;
    }, async () => {
      const r = await act('growthBuy', kind, id);
      if (r && r.ok) {
        toast(`买下了${item.name}！${kind === 'skin' ? '已经换上' : '去衣柜就能穿'}`);
        if (kind === 'item') act('setOutfit', { [id === 'scarf' ? 'face' : 'hat']: id });
      }
    });
    watch((s) => {
      const g = G(s);
      const list = kind === 'skin' ? g.skins : g.shopItems;
      item = (list || []).find((x) => x.id === id) || {};
      stars = g.stars || 0;
      nameEl.textContent = item.name || id;
      if (kind === 'skin') drawClawd(canvas, { skin: id, pose: { eyes: 'happy' } });
      else if (id === 'scarf') drawClawd(canvas, { face: id, skin: g.skin });
      else drawClawd(canvas, { hat: id, skin: g.skin });
      el.classList.toggle('owned', !!item.owned);
      el.classList.toggle('poor', !item.owned && !!item.price && stars < item.price);
      if (!el.classList.contains('armed')) price.textContent = item.owned ? '已拥有 · 点击穿上' : item.price ? `${item.price}✦` : item.unlock || '';
    });
    return el;
  }

  addTab({
    id: 'shop',
    order: 42,
    title: '小卖部',
    icon: 'bag',
    subtitle: '用星星 ✦ 给 Clawd 买零食和新衣服。星星靠每日任务、打卡、成就和礼物攒',
    render(el) {
      const g = G(window.ClawdPanel.state || {});
      el.append(
        h('div', { class: 'section' },
          h('div', { class: 'card hero shop-hero' },
            h('div', { class: 'shop-stars' }, text((s) => `✦ ${G(s).stars || 0}`)),
            h('div', {},
              h('div', { class: 'big' }, '我的星星'),
              text((s) => {
                const fav = (G(s).snacks || []).find((x) => x.id === G(s).favorite);
                return fav ? `今天 Clawd 最想吃：${fav.emoji}${fav.name}（喂它心情加倍）` : '';
              }, { class: 'small-muted' })))),
        h('div', { class: 'section' },
          h('h2', {}, '零食（喂它会开心，喂零食也是一种每日任务）'),
          h('div', { class: 'card' }, ...(g.snacks || [{ id: 'cookie' }, { id: 'fish' }, { id: 'pudding' }, { id: 'cake' }]).map((x) => snackRow(x.id)))),
        h('div', { class: 'section' },
          h('h2', {}, '皮肤'),
          h('div', { class: 'tiles' }, ...['mint', 'lavender', 'sakura', 'ocean', 'cocoa', 'night', 'gold', 'galaxy'].map((id) => shopTile('skin', id)))),
        h('div', { class: 'section' },
          h('h2', {}, '配饰'),
          live(h('div', { class: 'tiles' }), (s) => (G(s).shopItems || []).map((x) => x.id), (s) => (G(s).shopItems || []).map((x) => shopTile('item', x.id)))),
        h('p', { class: 'hint' }, '买东西要点两下确认。金色皮肤：连续打卡 30 天送；星空皮肤：解锁 10 个成就送。'),
      );
    },
  });
})();
