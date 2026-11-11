// 控制面板：和 Clawd 聊天
(() => {
  'use strict';

  const { h, watch, toast, act, addTab, drawClawd } = window.ClawdPanel;
  const P = window.panel;

  function keyCard() {
    const box = h('div', { class: 'card' });
    const input = h('input', { type: 'password', class: 'key-input', placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false' });
    const save = h('button', { class: 'btn primary' }, '保存');
    save.addEventListener('click', async () => {
      const r = await act('chatSetKey', input.value);
      if (r && !r.error) { input.value = ''; toast('已加密保存在本机'); }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    const getKey = h('button', { class: 'btn' }, '去获取 API key');
    getKey.addEventListener('click', () => act('openKeyPage'));
    const remove = h('button', { class: 'btn danger' }, '删除');
    remove.addEventListener('click', async () => { await act('chatClearKey'); toast('已删除'); });

    const status = h('div', { class: 'label' });
    const ctrl = h('div', { class: 'ctrl' });
    const note = h('div', { class: 'note' });
    box.append(h('div', { class: 'row' }, status, ctrl), note);

    let last = '';
    watch((s) => {
      const src = (s.chat && s.chat.keySource) || 'none';
      if (src === last) return;
      last = src;
      status.textContent = '';
      ctrl.textContent = '';
      if (src === 'saved') {
        status.append(h('b', {}, 'API key 已保存'), h('small', {}, '用系统加密存在这台电脑上，只用来调 Claude API'));
        ctrl.append(remove);
      } else if (src === 'env') {
        status.append(h('b', {}, '正在用环境变量里的 API key'), h('small', {}, 'ANTHROPIC_API_KEY；也可以在这里另填一个'));
        ctrl.append(input, save);
      } else {
        status.append(h('b', {}, '填入你的 Anthropic API key'), h('small', {}, '聊天会调用 Claude API，按你的用量计费'));
        ctrl.append(input, save, getKey);
      }
      note.textContent = '聊天内容会发给 Anthropic 的 Claude API，同时附带今天喝水、待办等状态，方便 Clawd 回答你。'
        + '如果你用 ant auth login 登录过，不填 key 也能用。';
    });
    return box;
  }

  function modelRow() {
    const sel = h('select');
    let built = false;
    sel.addEventListener('change', async () => {
      const r = await act('chatSetModel', sel.value);
      if (r && !r.error) toast('已切换模型');
    });
    watch((s) => {
      const c = s.chat || {};
      if (!built && c.models) {
        built = true;
        c.models.forEach((m) => sel.append(h('option', { value: m.id }, m.id === 'claude-opus-5-5' ? `${m.name}（默认）` : m.name)));
      }
      if (document.activeElement !== sel) sel.value = c.model;
    });
    return h('div', { class: 'row' },
      h('div', { class: 'label' }, h('b', {}, '模型'), h('small', {}, 'Opus 最聪明；Sonnet、Haiku 更便宜更快')),
      h('div', { class: 'ctrl' }, sel));
  }

  function message(m) {
    if (m.role === 'note') return h('div', { class: 'chat-note' }, m.text);
    const mine = m.role === 'user';
    const textEl = h('div', { class: `chat-bubble${m.error ? ' error' : ''}` });
    if (m.pending && !m.text) textEl.append(h('span', { class: 'chat-thinking' }, '✻ Thinking…'));
    else textEl.textContent = m.text;
    if (mine) return h('div', { class: 'chat-row mine' }, textEl);
    const avatar = h('canvas', { class: 'chat-avatar', width: 32, height: 28 });
    drawClawd(avatar, {});
    return h('div', { class: 'chat-row' }, avatar, textEl);
  }

  addTab({
    id: 'chat',
    order: 35,
    title: '聊天',
    icon: 'chat',
    subtitle: '和 Clawd 说说话（用 Claude API）',
    render(el) {
      const list = h('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite' });
      const input = h('textarea', { class: 'chat-input', rows: 2, placeholder: '和 Clawd 说点什么…（回车发送，Shift+回车换行）', maxlength: 4000 });
      const send = h('button', { class: 'btn primary' }, '发送');
      const reset = h('button', { class: 'btn' }, '新对话');
      const doSend = async () => {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        await act('chatSend', text);
        input.focus();
      };
      send.addEventListener('click', doSend);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          doSend();
        }
      });
      reset.addEventListener('click', () => act('chatReset'));

      el.append(
        h('div', { class: 'section' }, h('h2', {}, '设置'), keyCard(), h('div', { class: 'card', style: 'margin-top:10px' }, modelRow())),
        h('div', { class: 'section' },
          h('h2', {}, '对话'),
          h('div', { class: 'card chat-card' },
            list,
            h('div', { class: 'chat-compose' }, input, h('div', { class: 'chat-actions' }, send, reset)))),
      );

      let lastSig = '';
      watch((s) => {
        const c = s.chat || {};
        send.disabled = !!c.busy;
        const sig = JSON.stringify((c.log || []).map((m) => [m.role, m.pending ? '' : m.text, m.error]));
        if (sig === lastSig) return;
        lastSig = sig;
        list.textContent = '';
        const log = c.log || [];
        if (!log.length) list.append(h('div', { class: 'chat-note' }, '还没聊过天。问问 Clawd 今天该做什么吧 ✻'));
        log.forEach((m) => list.append(message(m)));
        list.scrollTop = list.scrollHeight;
      });

      // 流式回复：只更新最后一个气泡
      if (P && P.onChatDelta && !window.__chatDeltaHooked) {
        window.__chatDeltaHooked = true;
        P.onChatDelta((d) => {
          const bubbles = document.querySelectorAll('.chat-row:not(.mine) .chat-bubble');
          const lastBubble = bubbles[bubbles.length - 1];
          if (!lastBubble) return;
          lastBubble.textContent = d.text;
          const box = document.querySelector('.chat-list');
          if (box) box.scrollTop = box.scrollHeight;
        });
      }
      setTimeout(() => input.focus(), 50);
    },
  });
})();
