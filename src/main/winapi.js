// Windows 系统接口（通过 koffi 直接调用 user32 / shell32 / dwmapi）
// 用来：判断是否全屏 / 演示模式（自动勿扰），列出窗口位置（爬窗口）。
// 非 Windows 或加载失败时返回 null，调用方要自己降级。
const { IS_WIN } = require('./config');
const log = require('./log');

let api = null;
let loadError = '';

function load() {
  if (api || !IS_WIN) return api;
  try {
    log.debug('winapi: loading koffi');
    // eslint-disable-next-line global-require
    const koffi = require('koffi');
    log.debug('winapi: koffi loaded', koffi.version || '');
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    let dwmapi = null;
    try { dwmapi = koffi.load('dwmapi.dll'); } catch { /* 没有 DWM 也能用 */ }

    koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    koffi.struct('MONITORINFO', { cbSize: 'uint32_t', rcMonitor: 'RECT', rcWork: 'RECT', dwFlags: 'uint32_t' });
    const EnumProc = koffi.proto('bool __stdcall ClawdEnumProc(intptr_t hwnd, intptr_t lParam)');

    const f = {
      GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
      IsZoomed: user32.func('bool __stdcall IsZoomed(intptr_t hwnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint8_t *buf, int maxCount)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ uint8_t *buf, int maxCount)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
      MonitorFromWindow: user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hwnd, uint32_t flags)'),
      GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(intptr_t monitor, _Inout_ MONITORINFO *info)'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(ClawdEnumProc *cb, intptr_t lParam)'),
      SHQueryUserNotificationState: shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int *state)'),
      DwmRect: dwmapi ? dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ RECT *value, uint32_t size)') : null,
      DwmUint: dwmapi ? dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ uint32_t *value, uint32_t size)') : null,
    };
    api = { koffi, f, EnumProc };
    log.debug('winapi: functions declared');
  } catch (err) {
    loadError = String((err && err.message) || err);
    log.error('winapi load failed', err);
    api = null;
  }
  return api;
}

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const MONITOR_DEFAULTTONEAREST = 2;

// SHQueryUserNotificationState 的返回值
const QUNS = {
  1: 'not_present', // 锁屏 / 屏保
  2: 'busy', // 全屏程序
  3: 'd3d_fullscreen', // 全屏游戏
  4: 'presentation', // 演示模式
  5: 'accepts', // 正常
  6: 'quiet_time', // 系统刚装好的安静期
  7: 'app', // 应用（Win8 沉浸式）
};

function str16(fn, hwnd) {
  const buf = Buffer.alloc(512);
  const n = fn(hwnd, buf, 256);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function available() {
  return !!load();
}

function windowRect(hwnd) {
  const a = load();
  if (!a) return null;
  return safe(() => {
    // 优先用 DWM 的“可见边框”，不含 Win10/11 窗口四周透明的阴影边
    if (a.f.DwmRect) {
      const r = {};
      if (a.f.DwmRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) === 0 && r.right > r.left) return r;
    }
    const r = {};
    return a.f.GetWindowRect(hwnd, r) ? r : null;
  });
}

function monitorRect(hwnd) {
  const a = load();
  if (!a) return null;
  return safe(() => {
    const mon = a.f.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    const info = {
      cbSize: 40,
      rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
      rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
      dwFlags: 0,
    };
    return a.f.GetMonitorInfoW(mon, info) ? info : null;
  });
}

function isCloaked(hwnd) {
  const a = load();
  if (!a || !a.f.DwmUint) return false;
  return safe(() => {
    const v = [0];
    return a.f.DwmUint(hwnd, DWMWA_CLOAKED, v, 4) === 0 && v[0] !== 0;
  }, false);
}

function info(hwnd) {
  const a = load();
  if (!a || !hwnd) return null;
  log.debug('winapi: info', hwnd);
  return safe(() => {
    const ex = Number(a.f.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) || 0;
    const pid = [0];
    a.f.GetWindowThreadProcessId(hwnd, pid);
    return {
      hwnd: Number(hwnd),
      title: str16(a.f.GetWindowTextW, hwnd),
      cls: str16(a.f.GetClassNameW, hwnd),
      pid: pid[0],
      visible: !!a.f.IsWindowVisible(hwnd),
      minimized: !!a.f.IsIconic(hwnd),
      maximized: !!a.f.IsZoomed(hwnd),
      tool: !!(ex & WS_EX_TOOLWINDOW) || !!(ex & WS_EX_NOACTIVATE),
      rect: windowRect(hwnd),
    };
  });
}

// 系统的“请勿打扰”状态
function notificationState() {
  const a = load();
  if (!a) return null;
  log.debug('winapi: notificationState');
  return safe(() => {
    const out = [0];
    if (a.f.SHQueryUserNotificationState(out) !== 0) return null;
    return QUNS[out[0]] || String(out[0]);
  });
}

const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

// 前台窗口是不是全屏（盖住整个显示器）
function foregroundFullscreen(ignore = []) {
  const a = load();
  if (!a) return null;
  return safe(() => {
    log.debug('winapi: foreground');
    const fg = Number(a.f.GetForegroundWindow());
    log.debug('winapi: foreground =', fg);
    if (!fg || ignore.includes(fg)) return null;
    const w = info(fg);
    if (!w || !w.visible || w.minimized || SHELL_CLASSES.has(w.cls)) return null;
    const r = safe(() => { const x = {}; return a.f.GetWindowRect(fg, x) ? x : null; });
    const m = monitorRect(fg);
    if (!r || !m) return null;
    const mon = m.rcMonitor;
    const full = r.left <= mon.left && r.top <= mon.top && r.right >= mon.right && r.bottom >= mon.bottom;
    return full ? { title: w.title, cls: w.cls } : null;
  });
}

// 按从上到下的顺序列出可见的普通窗口（爬窗口用）
function listWindows(ignore = []) {
  const a = load();
  if (!a) return [];
  const hwnds = [];
  safe(() => a.f.EnumWindows((hwnd) => { hwnds.push(Number(hwnd)); return true; }, 0));
  const out = [];
  for (const h of hwnds) {
    if (ignore.includes(h)) continue;
    const w = info(h);
    if (!w || !w.visible || w.minimized || w.tool || !w.rect) continue;
    if (SHELL_CLASSES.has(w.cls) || !w.title) continue;
    if (w.rect.right - w.rect.left < 80 || w.rect.bottom - w.rect.top < 40) continue;
    if (isCloaked(h)) continue; // 其他虚拟桌面上的窗口、隐藏的 UWP 窗口
    out.push(w);
  }
  return out;
}

// Electron 窗口的 HWND
function hwndOf(win) {
  try {
    const buf = win.getNativeWindowHandle();
    return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
  } catch {
    return 0;
  }
}

module.exports = {
  available,
  loadError: () => loadError,
  notificationState,
  foregroundFullscreen,
  listWindows,
  windowRect,
  monitorRect,
  info,
  hwndOf,
};
