// Claude Code 干活时 Clawd 的样子：不同的工具，不同的动作和道具（主 Clawd 和小队共用）
//   think 托腮想 / read 翻书 / edit 敲键盘 / run 挥锤子 / test 摇试管 / web 拿放大镜左右找 / todo 写字板 / agent 招手派小帮手 / tool 扳手
(() => {
  'use strict';

  const C = (window.Clawd = window.Clawd || {});

  const KIND_TEXT = {
    think: '想一想', read: '翻代码', edit: '改代码', run: '跑命令', test: '跑测试', web: '查资料', todo: '列清单', agent: '派帮手', tool: '用工具',
  };

  // eyes：外面算好的眼睛（眨眼 / 吃惊）
  function pose(kind, now, eyes = 'open') {
    const f = Math.floor(now / 160) % 2;
    switch (kind) {
      case 'think':
        return { eyes: eyes === 'blink' ? 'blink' : 'up', armR: 'mid', look: Math.floor(now / 1800) % 2 ? -1 : 0 };
      case 'read':
        return { eyes, look: 1, armR: 'mid', breath: 'idle' };
      case 'run': {
        const g = Math.floor(now / 240) % 2;
        return { eyes, look: 1, armR: g ? 'up' : 'mid', squish: g === 0 };
      }
      case 'test':
        return { eyes, look: 1, armR: 'mid', armL: Math.floor(now / 420) % 2 ? 'mid' : 'down' };
      case 'web':
        return { eyes, look: [-1, 0, 1, 0][Math.floor(now / 700) % 4], armR: 'mid' };
      case 'todo':
        return { eyes, look: 1, armR: f ? 'mid' : 'down', armL: 'mid' };
      case 'agent': {
        const g = Math.floor(now / 300) % 2;
        return { eyes: 'happy', armL: g ? 'up' : 'mid', armR: g ? 'mid' : 'up' };
      }
      default: // edit / tool：两只手交替敲键盘
        return { eyes, armL: f ? 'mid' : 'down', armR: f ? 'down' : 'mid' };
    }
  }

  // 手里的道具：{ art, frame, bottom }（bottom 以像素格为单位，从脚底算）
  function prop(kind, now) {
    switch (kind) {
      case 'read': return { art: 'book', frame: Math.floor(now / 900) % 3 === 2 ? 1 : 0, bottom: 4 };
      case 'run': return { art: 'hammer', frame: 0, bottom: Math.floor(now / 240) % 2 ? 6 : 4 };
      case 'test': return { art: 'flask', frame: Math.floor(now / 500) % 2, bottom: 4 };
      case 'web': return { art: 'magnifier', frame: 0, bottom: 4 };
      case 'todo': return { art: 'clipboard', frame: 0, bottom: 4 };
      case 'tool': return { art: 'wrench', frame: 0, bottom: 4 };
      default: return null;
    }
  }

  // 测试没过时的台词（轻松一点，测试挂掉是常事）
  const TEST_FAIL = ['测试红了…再改改', '啊哦，挂了一个', '没过，没关系，修好它'];
  const TEST_PASS = ['测试全绿 ✓', '测试通过 ✓', '绿了！✓'];

  C.ccLook = { pose, prop, KIND_TEXT, TEST_FAIL, TEST_PASS };
})();
