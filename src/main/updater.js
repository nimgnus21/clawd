// 自动更新：从 GitHub Releases 检查新版本，后台下载，退出时安装
// 需要在设置里填 GitHub 仓库（owner/repo）；没填就不检查。
const EventEmitter = require('events');
const { app } = require('electron');
const log = require('./log');

const FIRST_CHECK_MS = 30 * 1000;
const EVERY_MS = 6 * 3600 * 1000;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// 默认去这个仓库的 Releases 检查新版本（面板「关于」里可以改）
const DEFAULT_REPO = 'nimgnus21/clawd';

class Updater extends EventEmitter {
  // fake: 测试用的假 autoUpdater（EventEmitter，带 checkForUpdates / quitAndInstall）
  constructor(settings, fake = null) {
    super();
    this.settings = settings;
    this.fake = fake;
    this.au = null;
    this.state = { phase: 'idle', version: '', percent: 0, error: '', checkedAt: 0 };
    this.timer = null;
  }

  config() {
    return { repo: DEFAULT_REPO, auto: true, ...(this.settings.get('update') || {}) };
  }

  setConfig(patch) {
    const p = { ...patch };
    if ('repo' in p) {
      p.repo = String(p.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
      if (p.repo && !REPO_RE.test(p.repo)) return { error: '仓库格式应该是 owner/repo，比如 yourname/clawd-widget' };
    }
    this.settings.set({ update: { ...this.config(), ...p } });
    this.configure();
    return { ok: true };
  }

  // 只有打包后的版本才能更新（开发模式下没有安装程序可换）
  supported() {
    return !!this.fake || app.isPackaged;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.status());
  }

  status() {
    const c = this.config();
    return { ...this.state, repo: c.repo, auto: c.auto, supported: this.supported(), current: app.getVersion() };
  }

  load() {
    if (this.au) return this.au;
    if (this.fake) {
      this.au = this.fake;
    } else {
      // eslint-disable-next-line global-require
      this.au = require('electron-updater').autoUpdater;
      this.au.logger = { info: (m) => log.info('[update]', m), warn: (m) => log.info('[update]', m), error: (m) => log.error('[update]', m), debug: () => {} };
    }
    const au = this.au;
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    au.on('checking-for-update', () => this.set({ phase: 'checking', error: '' }));
    au.on('update-available', (info) => this.set({ phase: 'downloading', version: (info && info.version) || '', percent: 0 }));
    au.on('update-not-available', () => this.set({ phase: 'latest', checkedAt: Date.now() }));
    au.on('download-progress', (p) => this.set({ phase: 'downloading', percent: Math.round((p && p.percent) || 0) }));
    au.on('update-downloaded', (info) => {
      this.set({ phase: 'ready', version: (info && info.version) || this.state.version, percent: 100, checkedAt: Date.now() });
      this.emit('ready', this.state.version);
    });
    au.on('error', (err) => this.set({ phase: 'error', error: this.describe(err), checkedAt: Date.now() }));
    return au;
  }

  describe(err) {
    const m = String((err && err.message) || err || '');
    if (/404|not found/i.test(m)) return '仓库里还没有发布过安装包（Releases 为空），或者仓库名不对';
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(m)) return '连不上 GitHub，检查一下网络';
    return m.split('\n')[0].slice(0, 160);
  }

  configure() {
    const c = this.config();
    if (!this.supported() || !c.repo) return false;
    const [owner, repo] = c.repo.split('/');
    this.load().setFeedURL({ provider: 'github', owner, repo });
    return true;
  }

  start() {
    clearTimeout(this.timer);
    clearInterval(this.interval);
    this.timer = setTimeout(() => this.autoCheck(), FIRST_CHECK_MS);
    this.interval = setInterval(() => this.autoCheck(), EVERY_MS);
  }

  autoCheck() {
    if (this.config().auto) this.check();
  }

  async check() {
    if (!this.supported()) return { error: '开发模式下不能更新，用安装包装好的版本才行' };
    if (!this.config().repo) return { error: '还没设置 GitHub 仓库' };
    if (['checking', 'downloading'].includes(this.state.phase)) return { ok: true };
    try {
      this.configure();
      this.set({ phase: 'checking', error: '' });
      await this.load().checkForUpdates();
      return { ok: true };
    } catch (err) {
      this.set({ phase: 'error', error: this.describe(err), checkedAt: Date.now() });
      return { error: this.state.error };
    }
  }

  install() {
    if (this.state.phase !== 'ready') return { error: '还没有下载好的新版本' };
    // 立刻退出并安装，装完自动重新打开
    setImmediate(() => this.load().quitAndInstall(true, true));
    return { ok: true };
  }
}

// 测试用的假 autoUpdater：mode = 'available' | 'latest' | 'error'
function fakeAutoUpdater(mode) {
  const au = new EventEmitter();
  au.feed = null;
  au.installed = false;
  au.setFeedURL = (opts) => { au.feed = opts; };
  au.checkForUpdates = async () => {
    au.emit('checking-for-update');
    await new Promise((r) => setTimeout(r, 300));
    if (mode === 'error') { au.emit('error', new Error('HttpError: 404 Not Found')); return null; }
    if (mode === 'latest') { au.emit('update-not-available', { version: app.getVersion() }); return null; }
    au.emit('update-available', { version: '9.9.9' });
    for (const p of [20, 55, 90]) {
      await new Promise((r) => setTimeout(r, 200));
      au.emit('download-progress', { percent: p });
    }
    au.emit('update-downloaded', { version: '9.9.9' });
    return null;
  };
  au.quitAndInstall = () => { au.installed = true; };
  return au;
}

module.exports = { Updater, fakeAutoUpdater };
