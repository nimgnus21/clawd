// 台词
(() => {
  'use strict';

  const C = (window.Clawd = window.Clawd || {});

  const LINES = {
    click: [
      '你好呀，我是 Clawd！',
      '今天想做点什么？',
      '写完记得跑一下测试哦',
      '要不要 git commit 一下？',
      '喝口水，眨眨眼～',
      '这个 bug 交给我！',
      'LGTM ✓',
      '先想清楚，再动手',
      '卡住了？换个思路试试',
      '摸鱼被我抓到了！',
      '你今天也很棒！',
      '站起来伸个懒腰吧',
      '/compact 一下大脑',
      '按两下 Esc 可以回到过去 ⏪',
      '我是螃蟹？我是章鱼？我是 Clawd！',
      'Thinking… 才不是在发呆',
    ],
    pet: ['嘿嘿，好舒服～', '再摸一下！', '(〃ω〃)', '你的手好暖'],
    drag: ['哇——飞起来了！', '轻点轻点～', '要带我去哪？'],
    land: ['哎哟！', '安全着陆 ✓', '咚！'],
    wake: ['啊！我没睡着！', '欢迎回来～', '嗯？你回来啦'],
    water: ['该喝水啦！', '喝口水再继续吧', '补充一下水分～', '水杯在这儿！'],
    sit: ['坐太久啦，起来走走～', '站起来伸个懒腰吧', '活动一下肩膀和脖子', '起来接杯水、走两步'],
    sitDone: ['伸——懒——腰～ ✓', '舒服多了！', '动一动更有精神 ✓'],
    eye: ['眼睛累了吧？看看远处', '20 秒护眼时间到', '让眼睛放个假'],
    eyeDone: ['眼睛休息好啦 ✓', '视力 +1 ✓', '舒服了吧？继续加油'],
    hourFillers: ['又过了一小时', '起来走两步吧', '记得眨眨眼', '坐直，放松肩膀'],
    ccDone: ['搞定！', '做完啦！', 'Done!', '交差！'],
    hot: ['电脑好烫…', 'CPU 在冒烟了…', '风扇呼呼转…'],
    yawn: ['哈——欠～', '有点困…', '(￣o￣) zz'],
    muse: ['今天的代码真好看', '嗯…', '要不要来点咖啡？', '我在想 bug 藏在哪', '✻', '桌面好宽敞', '偷偷摸个鱼～', '数一数像素点…'],
    chase: ['抓到你了！', '嘿！', '鼠标别跑～'],
    sulk: ['有点无聊…摸摸我？', '陪我玩一下嘛…', '(｡•́︿•̀｡)', '今天还没喝水吧…'],
    joy: ['今天心情超好！', '嘿嘿～', '✦ 元气满满 ✦'],
    cool: ['呼～凉快了', '电脑缓过来了'],
    charging: ['⚡ 充电中，谢谢投喂！', '⚡ 补充能量～', '⚡ 插上电了，安心'],
    ccWaitAck: ['快去终端看看吧～', '它在等你点头呢', '去批准一下吧'],
  };

  const HOUR_LINES = {
    0: '零点了，快去睡觉！',
    9: '新的一天，冲！',
    12: '午饭时间到！',
    15: '下午茶时间～',
    18: '下班时间到，收工！',
    22: '该准备休息啦',
  };

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // Claude Code 风格的“思考中”动词和转圈符号
  const VERBS = ['Pondering', 'Clauding', 'Noodling', 'Percolating', 'Conjuring',
    'Musing', 'Simmering', 'Tinkering', 'Brewing', 'Scheming'];
  const FOCUS_VERBS = ['Focusing', 'Crafting', 'Cooking', 'Tinkering', 'Brewing', 'Clauding'];
  const SPINNER = ['·', '✢', '✳︎', '✶', '✻', '✽', '✻', '✶', '✳︎', '✢'];

  const pad2 = (n) => String(n).padStart(2, '0');
  const rand = (a, b) => a + Math.random() * (b - a);

  let lastLine = '';
  function pick(list) {
    let s;
    do { s = list[Math.floor(Math.random() * list.length)]; } while (list.length > 1 && s === lastLine);
    lastLine = s;
    return s;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return '这么晚还在忙？早点休息哦';
    if (h < 11) return '早上好！今天也一起加油 ✻';
    if (h < 14) return '中午好！记得吃饭～';
    if (h < 18) return '下午好！来杯咖啡？';
    if (h < 23) return '晚上好！今天辛苦啦';
    return '夜深了，别熬太晚～';
  }

  function clickLine() {
    const h = new Date().getHours();
    if ((h >= 23 || h < 5) && Math.random() < 0.3) return '很晚了，早点睡吧 (｡-ω-)zzZ';
    if (Math.random() < 0.12) {
      const d = new Date();
      return `现在是 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
    return pick(LINES.click);
  }

  function hourLine(h) {
    return `${pad2(h)}:00 ✻ ${HOUR_LINES[h] || pick(LINES.hourFillers)}`;
  }

  function mmss(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  }

  C.lines = {
    LINES, WEEK, VERBS, FOCUS_VERBS, SPINNER, pad2, rand, pick, greeting, clickLine, hourLine, mmss,
  };
})();
