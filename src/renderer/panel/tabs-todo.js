// 控制面板：待办（放在「今天」页里）
(() => {
  'use strict';

  const { h, watch, toast, act, parts } = window.ClawdPanel;
  const pad2 = (n) => String(n).padStart(2, '0');

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  // “今天 14:30” / “明天 09:00” / “11月20日 18:00”
  function fmtWhen(ts) {
    const d = new Date(ts);
    const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const diff = Math.round((startOfDay(d) - startOfDay(Date.now())) / 86400000);
    if (diff === 0) return `今天 ${t}`;
    if (diff === 1) return `明天 ${t}`;
    if (diff === -1) return `昨天 ${t}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${t}`;
  }

  // 提醒时间的快捷选项
  function presetTime(key) {
    const now = new Date();
    const at = (days, hh, mm = 0) => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      d.setHours(hh, mm, 0, 0);
      return d.getTime();
    };
    switch (key) {
      case '30m': return Date.now() + 30 * 60000;
      case '1h': return Date.now() + 60 * 60000;
      case '2h': return Date.now() + 120 * 60000;
      case 'evening': return now.getHours() < 18 ? at(0, 18) : at(1, 18);
      case 'tomorrow': return at(1, 9);
      default: return 0;
    }
  }

  function toLocalInput(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function todoRow(t) {
    const overdue = !t.done && t.remindAt && t.remindAt <= Date.now();
    const check = h('input', { type: 'checkbox', class: 'todo-check', title: t.done ? '标记为未完成' : '完成' });
    check.checked = !!t.done;
    check.addEventListener('change', () => act('todoDone', t.id, check.checked));

    const label = h('span', { class: `todo-text${t.done ? ' done' : ''}`, title: '双击修改' }, t.text);
    label.addEventListener('dblclick', () => {
      if (t.done) return;
      const input = h('input', { type: 'text', class: 'todo-edit', value: t.text, maxlength: 200 });
      let finished = false; // 回车保存后还会触发一次 blur，只处理一次
      const finish = (keep) => {
        if (finished) return;
        finished = true;
        const v = input.value.trim();
        if (keep && v && v !== t.text) act('todoEdit', t.id, { text: v });
        else label.textContent = t.text;
        if (input.isConnected) input.replaceWith(label);
      };
      const save = () => finish(true);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', save);
      label.replaceWith(input);
      input.focus();
      input.select();
    });

    const when = t.remindAt && !t.done
      ? h('span', { class: `chip${overdue ? ' warn' : ''}` }, `⏰ ${fmtWhen(t.remindAt)}`)
      : null;
    const done = t.done && t.doneAt ? h('span', { class: 'chip' }, `完成于 ${fmtWhen(t.doneAt)}`) : null;
    const del = h('button', { class: 'icon-btn', title: '删除', 'aria-label': '删除' }, '×');
    del.addEventListener('click', () => act('todoRemove', t.id));

    return h('div', { class: 'row todo' }, check, h('div', { class: 'label' }, label), when, done, del);
  }

  parts.todo = {
    render(el) {
      // ---- 新增 ----
      const input = h('input', { type: 'text', class: 'todo-input', placeholder: '要做什么？按回车添加', maxlength: 200 });
      const when = h('select', {},
        h('option', { value: '' }, '不提醒'),
        h('option', { value: '30m' }, '30 分钟后'),
        h('option', { value: '1h' }, '1 小时后'),
        h('option', { value: '2h' }, '2 小时后'),
        h('option', { value: 'evening' }, '傍晚 18:00'),
        h('option', { value: 'tomorrow' }, '明天 9:00'),
        h('option', { value: 'custom' }, '自定义时间…'));
      const custom = h('input', { type: 'datetime-local', class: 'hidden' });
      when.addEventListener('change', () => {
        custom.classList.toggle('hidden', when.value !== 'custom');
        if (when.value === 'custom' && !custom.value) custom.value = toLocalInput(Date.now() + 3600000);
      });
      const add = async () => {
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        let at = 0;
        if (when.value === 'custom') at = custom.value ? new Date(custom.value).getTime() : 0;
        else at = presetTime(when.value);
        const r = await act('todoAdd', text, at);
        if (r && !r.error) {
          input.value = '';
          when.value = '';
          custom.classList.add('hidden');
          toast(at ? `已添加，${fmtWhen(at)} 提醒你` : '已添加');
          input.focus();
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      const addBtn = h('button', { class: 'btn primary' }, '添加');
      addBtn.addEventListener('click', add);

      const addCard = h('div', { class: 'card todo-add-card' }, h('div', { class: 'row todo-add' }, input, when, custom, addBtn));

      // ---- 列表 ----
      const openBox = h('div', { class: 'card' });
      const doneBox = h('div', { class: 'card' });
      const openTitle = h('h2');
      const doneTitle = h('h2');
      const clearBtn = h('button', { class: 'btn small' }, '清除已完成');
      clearBtn.addEventListener('click', () => act('todoClearDone'));
      const doneSection = h('div', { class: 'section' },
        h('div', { class: 'section-head' }, doneTitle, clearBtn), doneBox);
      el.append(h('div', { class: 'section' }, openTitle, addCard, openBox), doneSection);

      let lastSig = '';
      watch((s) => {
        const list = s.todos || [];
        // 输入框正在编辑时不重画，免得打断
        if (document.activeElement && document.activeElement.classList.contains('todo-edit')) return;
        const sig = JSON.stringify(list) + Math.floor(Date.now() / 60000);
        if (sig === lastSig) return;
        lastSig = sig;
        const open = list.filter((t) => !t.done).sort((a, b) => {
          // 有提醒时间的按时间排在前面，其余按添加顺序
          if (a.remindAt && b.remindAt) return a.remindAt - b.remindAt;
          if (a.remindAt) return -1;
          if (b.remindAt) return 1;
          return a.createdAt - b.createdAt;
        });
        const done = list.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
        openTitle.textContent = `待办${open.length ? `（${open.length}）` : ''}`;
        doneTitle.textContent = `已完成（${done.length}）`;
        openBox.textContent = '';
        if (!open.length) openBox.append(h('div', { class: 'note' }, '没有待办，轻松一下吧 ✻'));
        open.forEach((t) => openBox.append(todoRow(t)));
        doneBox.textContent = '';
        done.slice(0, 30).forEach((t) => doneBox.append(todoRow(t)));
        doneSection.classList.toggle('hidden', !done.length);
      });

    },
  };
})();
