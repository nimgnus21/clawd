// 配饰和节日：帽子画在头顶的小画布上（16 x 5），脸上的配饰画进身体里
(() => {
  'use strict';

  const C = (window.Clawd = window.Clawd || {});

  const PAL = {
    R: '#D64545', // 红
    W: '#F4F1EA', // 白
    G: '#F2C14E', // 金
    B: '#4C9BE0', // 蓝
    P: '#F28CB1', // 粉
    Q: '#D9577F', // 深粉
    K: '#2E2B3A', // 黑紫
    O: '#E8833A', // 橙
    H: '#E8506A', // 心形红
    N: '#1F1E1D', // 黑
    S: '#9AA4AE', // 灰
    L: '#7CC47F', // 绿
    E: '#CFC8BD', // 浅灰（白色东西的描边，浅色桌面上也看得见）
    D: '#4E9A55', // 深绿
    A: '#8E2F3C', // 暗红
  };

  const HAT_W = 16;
  const HAT_H = 5;

  // 每顶帽子 5 行 x 16 列，最下面一行压在脑袋最上面一行上（像真的戴着）
  const HAT_OVERLAP = 1;
  const ITEMS = {
    santa: {
      name: '圣诞帽',
      hat: [
        '............WW..',
        '..........RRWW..',
        '.......RRRRR....',
        '....RRRRRRRRR...',
        '...WWWWWWWWWWW..',
      ],
    },
    party: {
      name: '派对帽',
      hat: [
        '.......PP.......',
        '.......GG.......',
        '......GBBG......',
        '.....BGGGGB.....',
        '....GGBBBBGG....',
      ],
    },
    witch: {
      name: '巫师帽',
      hat: [
        '.........KK.....',
        '........KKK.....',
        '.......KKKK.....',
        '......KOOOOK....',
        '..KKKKKKKKKKKK..',
      ],
    },
    cny: {
      name: '新春帽',
      hat: [
        '................',
        '.......GG.......',
        '.....RRRRRR.....',
        '....RGRRRRGR....',
        '...RRRRRRRRRR...',
      ],
    },
    bunny: {
      name: '兔耳朵',
      hat: [
        '....E......E....',
        '...EPE....EPE...',
        '...EPE....EPE...',
        '...EPE....EPE...',
        '...EEE....EEE...',
      ],
    },
    heart: {
      name: '爱心',
      hat: [
        '................',
        '.....HH..HH.....',
        '.....HHHHHH.....',
        '......HHHH......',
        '.......HH.......',
      ],
    },
    bow: {
      name: '蝴蝶结',
      hat: [
        '................',
        '................',
        '..........P...P.',
        '..........PPQPP.',
        '..........P...P.',
      ],
    },
    flower: {
      name: '小花',
      hat: [
        '................',
        '..........P.....',
        '.........PGP....',
        '..........P.....',
        '..........L.....',
      ],
    },
    chef: {
      name: '厨师帽',
      hat: [
        '.....EEEEEE.....',
        '....EWWWWWWE....',
        '....EWWWWWWE....',
        '.....EWWWWE.....',
        '.....SSSSSS.....',
      ],
    },
    grad: {
      name: '学士帽',
      hat: [
        '................',
        '..NNNNNNNNNNNN..',
        '.....NNNNNN.G...',
        '.....NNNNNN.G...',
        '............G...',
      ],
    },
    crown: {
      name: '皇冠',
      hat: [
        '................',
        '....G..GG..G....',
        '....GG.GG.GG....',
        '....GGGGGGGG....',
        '....GRGGGGBG....',
      ],
    },
    // ---- 小卖部配饰 ----
    sprout: {
      name: '头顶小草',
      hat: [
        '................',
        '......LL.LL.....',
        '.......LDL......',
        '........D.......',
        '........D.......',
      ],
    },
    starclip: {
      name: '星星发卡',
      hat: [
        '................',
        '...........G....',
        '.........GGGGG..',
        '..........GGG...',
        '..........G.G...',
      ],
    },
    catears: {
      name: '猫耳',
      hat: [
        '................',
        '..K..........K..',
        '..KK........KK..',
        '..KPK......KPK..',
        '..KKKK....KKKK..',
      ],
    },
    halo: {
      name: '天使光环',
      hat: [
        '................',
        '.....GGGGGG.....',
        '....G......G....',
        '.....GGGGGG.....',
        '................',
      ],
    },
    horns: {
      name: '小恶魔角',
      hat: [
        '................',
        '..A..........A..',
        '..RA........AR..',
        '...RR......RR...',
        '...RR......RR...',
      ],
    },
    scarf: {
      name: '红围巾',
      // 脖子（身体中下部）围一圈，右边垂下一截
      face(put, top) {
        for (let x = 2; x < 14; x++) put(x, top + 6, x % 3 === 0 ? PAL.A : PAL.R);
        put(10, top + 7, PAL.R);
        put(11, top + 7, PAL.R);
      },
    },
    headphones: {
      name: '耳机',
      hat: [
        '................',
        '................',
        '................',
        '....SSSSSSSS....',
        '..SS........SS..',
      ],
      // 两边的耳罩画在身体两侧
      face(put, top) {
        for (const y of [top + 1, top + 2, top + 3]) {
          put(1, y, PAL.K);
          put(14, y, PAL.K);
        }
        put(1, top, PAL.S);
        put(14, top, PAL.S);
      },
    },
    shades: {
      name: '墨镜',
      face(put, top, ey) {
        for (const y of [ey, ey + 1]) {
          for (let x = 3; x <= 6; x++) put(x, y, PAL.N);
          for (let x = 9; x <= 12; x++) put(x, y, PAL.N);
        }
        put(7, ey, PAL.N);
        put(8, ey, PAL.N);
        put(4, ey, PAL.S); // 反光
        put(10, ey, PAL.S);
      },
    },
    glasses: {
      name: '眼镜',
      face(put, top, ey) {
        const ring = (x0) => {
          for (let x = x0; x < x0 + 4; x++) { put(x, ey - 1, PAL.N); put(x, ey + 2, PAL.N); }
          put(x0, ey, PAL.N); put(x0, ey + 1, PAL.N);
          put(x0 + 3, ey, PAL.N); put(x0 + 3, ey + 1, PAL.N);
        };
        ring(3);
        ring(9);
        put(7, ey, PAL.N);
        put(8, ey, PAL.N);
      },
    },
  };

  // 头顶画布上的像素
  function hatPixels(id) {
    const item = ITEMS[id];
    if (!item || !item.hat) return [];
    const out = [];
    item.hat.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (PAL[ch]) out.push([x, y, PAL[ch]]);
      });
    });
    return out;
  }

  // ================= 节日 =================
  // 农历节日对应的公历日期（春节、中秋）
  const CNY = {
    2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03',
    2031: '01-23', 2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08',
  };
  const MID_AUTUMN = {
    2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12',
    2031: '10-01', 2032: '09-19', 2033: '09-08', 2034: '09-27', 2035: '09-16',
  };

  const dayNum = (d) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  const pad2 = (n) => String(n).padStart(2, '0');

  // 离某个公历日期（今年）差几天
  function diffDays(d, mmdd) {
    if (!mmdd) return Infinity;
    const [m, day] = mmdd.split('-').map(Number);
    return dayNum(d) - dayNum(new Date(d.getFullYear(), m - 1, day));
  }

  // 今天是什么节日：{ id, name, hat, line } 或 null。birthday 是 'MM-DD'
  function festival(d = new Date(), birthday = '') {
    const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (birthday && md === birthday) return { id: 'birthday', name: '生日', hat: 'party', line: '生日快乐！🎂 今天你最大' };
    const y = d.getFullYear();
    const cny = diffDays(d, CNY[y]);
    if (cny >= -1 && cny <= 7) return { id: 'cny', name: '春节', hat: 'cny', line: cny === -1 ? '除夕快乐！明天就过年啦 🧧' : '新年快乐，恭喜发财！🧧' };
    const ma = diffDays(d, MID_AUTUMN[y]);
    if (ma >= -1 && ma <= 1) return { id: 'midautumn', name: '中秋', hat: 'bunny', line: '中秋快乐！记得吃月饼 🥮' };
    if (md === '12-31' || md === '01-01' || md === '01-02') return { id: 'newyear', name: '元旦', hat: 'party', line: md === '12-31' ? '今年最后一天，辛苦啦！' : '新年快乐！🎉' };
    if (md === '02-14') return { id: 'valentine', name: '情人节', hat: 'heart', line: '情人节快乐 ♥' };
    if (md >= '10-25' && md <= '10-31') return { id: 'halloween', name: '万圣节', hat: 'witch', line: '万圣节快乐！不给糖就捣蛋 🎃' };
    if (md >= '12-20' && md <= '12-26') return { id: 'christmas', name: '圣诞', hat: 'santa', line: md === '12-25' ? '圣诞快乐！🎄' : '圣诞节快到啦 🎄' };
    return null;
  }

  C.outfits = { ITEMS, PAL, HAT_W, HAT_H, HAT_OVERLAP, hatPixels, festival };
})();
