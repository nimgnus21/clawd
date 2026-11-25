// 和 Claude Code 联动：
// 1. 在本机 127.0.0.1 开一个小 HTTP 服务，接收 Claude Code 的 http hooks
// 2. 一键把 hooks 写进 ~/.claude/settings.json（先备份，可一键移除）
const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const HOOK_PATH = '/clawd/hook';
const MAX_BODY = 2 * 1024 * 1024;
// 任务开始 / 结束 / 等你确认 / 出错 / 会话结束；PreToolUse 用来显示正在用什么工具
// PostToolUse / PostToolUseFailure（只看 Bash）用来知道测试通过没有（失败时 error 第一行是 “Exit code N”）
const BASE_EVENTS = ['UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'SessionEnd'];
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'];
const TOOL_MATCHER = { PreToolUse: '*', PostToolUse: 'Bash', PostToolUseFailure: 'Bash' };
const DONE_SHOW_MS = 8000; // 做完的会话再留 8 秒（小 Clawd 庆祝完再走）

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function settingsPath() {
  return path.join(claudeDir(), 'settings.json');
}

const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// 把工具调用变成一句短短的描述，比如 “Edit main.js”
function toolLabel(name, input) {
  const i = input || {};
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return `${name} ${clip(basename(i.file_path), 24)}`;
    case 'NotebookEdit':
      return `Edit ${clip(basename(i.notebook_path), 24)}`;
    case 'Bash':
      return `Bash ${clip(i.description || i.command, 26)}`;
    case 'Grep':
      return `Grep "${clip(i.pattern, 18)}"`;
    case 'Glob':
      return `Glob ${clip(i.pattern, 22)}`;
    case 'WebFetch':
      try { return `Fetch ${new URL(i.url).hostname}`; } catch { return 'WebFetch'; }
    case 'WebSearch':
      return `Search "${clip(i.query, 18)}"`;
    case 'Agent':
    case 'Task':
      return `Agent ${clip(i.description || i.subagent_type, 22)}`;
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Updating todos';
    default: {
      const m = /^mcp__(.+?)__(.+)$/.exec(String(name || ''));
      if (m) return clip(`${m[1]} · ${m[2]}`, 28);
      return clip(name || 'Working', 28);
    }
  }
}

// 工具分成几类，小人用不同的动作和道具表现
//   read 翻书 / edit 敲键盘 / run 挥锤子 / test 跑测试 / web 放大镜 / todo 写字板 / agent 派小帮手 / tool 其他
const TEST_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|npx\s+(?:jest|vitest|mocha|playwright\s+test)|pytest|py\.test|jest|vitest|mocha|go\s+test|cargo\s+(?:test|nextest)|dotnet\s+test|phpunit|rspec|ctest|tox|unittest|gradlew?\b[^|;&]*\btest|mvnw?\b[^|;&]*\btest|make\s+test|deno\s+test|swift\s+test|mix\s+test)\b/i;
function isTestCommand(cmd) {
  return TEST_RE.test(String(cmd || ''));
}

function toolKind(name, input) {
  switch (name) {
    case 'Read': case 'Grep': case 'Glob': case 'LS': case 'NotebookRead':
      return 'read';
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return 'edit';
    case 'Bash': case 'PowerShell':
      return isTestCommand((input || {}).command) ? 'test' : 'run';
    case 'WebFetch': case 'WebSearch':
      return 'web';
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList':
      return 'todo';
    case 'Agent': case 'Task':
      return 'agent';
    default:
      return 'tool';
  }
}

// Claude Code 的提示是英文的，常见的几种翻成中文
function translateMessage(msg) {
  const m = String(msg || '');
  let r = /permission to use (.+?)\.?$/i.exec(m);
  if (r) {
    const mcp = /^mcp__(.+?)__(.+)$/.exec(r[1]);
    return `等你批准：${clip(mcp ? `${mcp[1]} · ${mcp[2]}` : r[1], 24)}`;
  }
  if (/waiting for your input/i.test(m)) return '在等你回复';
  r = /needs your (approval|attention)/i.exec(m);
  if (r) return '需要你看一下';
  return clip(m || 'Claude Code 等你确认', 40);
}

class ClaudeCode extends EventEmitter {
  constructor(settings, stats) {
    super();
    this.settings = settings;
    this.stats = stats;
    this.server = null;
    this.serverError = '';
    this.sessions = new Map(); // session_id -> { id, state, cwd, project, first, since, tool, kind, toolAt, waitSince, doneAt, result }
    this.lastEventAt = 0;
  }

  config() {
    return {
      enabled: true,
      port: 47823,
      token: '',
      tools: true, // 显示正在用的工具（需要 PreToolUse hook）
      notify: true, // 完成 / 等你确认时弹系统通知
      notifyMinSec: 30, // 任务超过这么久才通知完成
      ...(this.settings.get('claudeCode') || {}),
    };
  }

  setConfig(patch) {
    this.settings.set({ claudeCode: { ...this.config(), ...patch } });
  }

  ensureToken() {
    const cfg = this.config();
    if (!cfg.token) this.setConfig({ token: crypto.randomBytes(16).toString('hex') });
    return this.config().token;
  }

  hookUrl(port = this.config().port) {
    return `http://127.0.0.1:${port}${HOOK_PATH}`;
  }

  // ---------------- 本机 HTTP 服务 ----------------
  start() {
    this.ensureToken();
    this.restartServer();
    this.settings.on('change', (keys) => {
      if (!keys.includes('claudeCode')) return;
      const cfg = this.config();
      const running = this.server && this.server.listening;
      if (!cfg.enabled && running) this.stopServer();
      else if (cfg.enabled && (!running || this.server.address().port !== cfg.port)) this.restartServer();
    });
    // 很久没动静的会话当作已经结束（比如 Claude Code 被直接关掉）
    this.sweeper = setInterval(() => this.sweep(), 30000);
  }

  stopServer() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.emit('status');
  }

  restartServer() {
    this.stopServer();
    const cfg = this.config();
    if (!cfg.enabled) return;
    this.serverError = '';
    const server = http.createServer((req, res) => this.handle(req, res));
    server.on('error', (err) => {
      this.serverError = err.code === 'EADDRINUSE' ? `端口 ${cfg.port} 被别的程序占用了` : String(err.message || err);
      this.server = null;
      this.emit('status');
    });
    server.listen(cfg.port, '127.0.0.1', () => this.emit('status'));
    this.server = server;
  }

  handle(req, res) {
    const reply = (code) => {
      res.writeHead(code);
      res.end();
    };
    if (req.method !== 'POST' || req.url !== HOOK_PATH) return reply(404);
    // 必须带上安装时生成的口令，防止别的网页或程序乱发
    if (req.headers['x-clawd-token'] !== this.config().token) return reply(403);

    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      // 2xx + 空响应 = 对 Claude Code 来说什么都不做，绝不会拦住它
      reply(204);
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // 太大被截断的 Write/Edit 内容解析不了也没关系，只要事件名
        const m = /"hook_event_name"\s*:\s*"(\w+)"/.exec(Buffer.concat(chunks).toString('utf8'));
        const s = /"session_id"\s*:\s*"([^"]+)"/.exec(Buffer.concat(chunks).toString('utf8'));
        const t = /"tool_name"\s*:\s*"([^"]+)"/.exec(Buffer.concat(chunks).toString('utf8'));
        if (m) body = { hook_event_name: m[1], session_id: s ? s[1] : '', tool_name: t ? t[1] : '' };
      }
      if (body) this.onEvent(body);
    });
    req.on('error', () => {});
    return undefined;
  }

  // ---------------- 事件 → 状态 ----------------
  onEvent(e) {
    const now = Date.now();
    this.lastEventAt = now;
    const id = String(e.session_id || 'default');
    const project = basename(e.cwd);
    let s = this.sessions.get(id);
    const fresh = () => ({ id, state: 'working', cwd: e.cwd || '', project, first: now, since: now, tool: '', kind: 'think', toolAt: now, seen: now, demo: !!e.__demo });

    switch (e.hook_event_name) {
      case 'UserPromptSubmit':
        s = { ...fresh(), first: s ? s.first : now };
        this.sessions.set(id, s);
        break;
      case 'PreToolUse':
        if (!s) s = fresh();
        s.state = 'working';
        s.waitSince = 0;
        s.doneAt = 0;
        s.tool = toolLabel(e.tool_name, e.tool_input);
        s.kind = toolKind(e.tool_name, e.tool_input);
        s.toolAt = now;
        s.seen = now;
        this.sessions.set(id, s);
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (!s) break;
        s.seen = now;
        const input = e.tool_input || {};
        if (e.tool_name !== 'Bash' || !isTestCommand(input.command)) break;
        const failed = e.hook_event_name === 'PostToolUseFailure';
        // 中途取消的不算；失败要真的跑完退出（Exit code N）
        if (failed && (e.is_interrupt || !/^Exit code [1-9]/.test(String(e.error || '')))) break;
        s.result = { ok: !failed, at: now };
        this.emit('event', { demo: !!e.__demo, type: 'test', ok: !failed, project: s.project, session: id });
        break;
      }
      case 'Notification': {
        if (!s) s = { ...fresh(), state: 'idle' };
        s.seen = now;
        if (e.notification_type === 'idle_prompt') {
          // 已经做完、在等你回复；不算“需要确认”
          s.state = 'idle';
          this.sessions.set(id, s);
          this.emit('event', { type: 'idle', project: s.project, message: e.message || '' });
          break;
        }
        if (s.state !== 'waiting') s.waitSince = now;
        s.state = 'waiting';
        s.message = translateMessage(e.message);
        this.sessions.set(id, s);
        this.emit('event', { demo: !!e.__demo, type: 'waiting', project: s.project, message: s.message, session: id });
        break;
      }
      case 'Stop': {
        const took = s && s.since ? now - s.since : 0;
        if (s) {
          s.state = 'idle';
          s.seen = now;
          s.doneAt = now;
          s.waitSince = 0;
          s.took = took;
        }
        if (!e.__demo) {
          this.stats.add('ccTasks', 1);
          if (took > 0) this.stats.add('ccSeconds', Math.round(took / 1000));
        }
        this.emit('event', {
          demo: !!e.__demo,
          type: 'done',
          project: (s && s.project) || project,
          took,
          session: id,
          summary: clip(e.last_assistant_message, 60),
        });
        // 庆祝完了再发一次快照，让做完的小 Clawd 离开
        setTimeout(() => this.emit('sessions', this.snapshot()), DONE_SHOW_MS + 200);
        break;
      }
      case 'StopFailure':
        if (s) { s.state = 'idle'; s.waitSince = 0; }
        this.emit('event', { type: 'error', project: (s && s.project) || project, message: clip(e.last_assistant_message || e.error, 50), session: id });
        break;
      case 'SessionEnd':
        this.sessions.delete(id);
        break;
      default:
        break;
    }
    this.emit('sessions', this.snapshot());
  }

  // 控制面板上的“演示一遍”：假装同时跑了两个任务（看小 Clawd 怎么干活、跑测试、等批准、庆祝）
  demo() {
    (this.demoTimers || []).forEach(clearTimeout);
    const A = { session_id: 'clawd-demo', cwd: '/demo/my-project', __demo: true };
    const B = { session_id: 'clawd-demo-2', cwd: '/demo/api-server', __demo: true };
    const steps = [
      [0, A, { hook_event_name: 'UserPromptSubmit', prompt: 'demo' }],
      [1200, A, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'src/app.js' } }],
      [1800, B, { hook_event_name: 'UserPromptSubmit', prompt: 'demo' }],
      [2600, B, { hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query: 'express rate limit' } }],
      [3000, A, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } }],
      [4800, A, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } }],
      [5200, B, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'server.js' } }],
      [6600, A, { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1\n1 failing' }],
      [7400, A, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } }],
      [8000, B, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }],
      [9000, A, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } }],
      [10600, A, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok', stderr: '' } }],
      [11400, A, { hook_event_name: 'Stop', last_assistant_message: 'Demo done.' }],
      [13000, B, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { description: 'Restart server' } }],
      [15000, B, { hook_event_name: 'Stop', last_assistant_message: 'Demo done.' }],
      [24000, A, { hook_event_name: 'SessionEnd', reason: 'other' }],
      [24000, B, { hook_event_name: 'SessionEnd', reason: 'other' }],
    ];
    this.demoTimers = steps.map(([ms, base, e]) => setTimeout(() => this.onEvent({ ...base, ...e }), ms));
  }

  sweep() {
    const now = Date.now();
    let changed = false;
    for (const [id, s] of this.sessions) {
      // 工作中但 15 分钟没任何消息：多半是被关掉了
      if (s.state !== 'idle' && now - (s.seen || s.since || 0) > 15 * 60000) {
        s.state = 'idle';
        changed = true;
      }
      if (s.state === 'idle' && now - (s.seen || 0) > 6 * 3600000) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('sessions', this.snapshot());
  }

  // 发给小人的状态：最需要关注的那个会话 + 总数 + 每个会话（一个会话一只 Clawd）
  snapshot() {
    const now = Date.now();
    const tools = this.config().tools;
    const view = (s) => ({
      id: s.id,
      state: s.state === 'idle' ? 'done' : s.state,
      project: s.project,
      since: s.since,
      first: s.first,
      tool: tools ? s.tool : '',
      kind: tools ? s.kind || 'think' : 'edit',
      message: s.message || '',
      waitSince: s.waitSince || 0,
      doneAt: s.doneAt || 0,
      result: s.result && now - s.result.at < 6000 ? s.result : null,
    });
    const list = [...this.sessions.values()].filter((s) => s.state !== 'idle');
    const rank = { waiting: 2, working: 1 };
    list.sort((a, b) => (rank[b.state] - rank[a.state]) || ((b.toolAt || b.since) - (a.toolAt || a.since)));
    const top = list[0];
    // 小队：正在干活 / 等批准的，加上刚做完还在庆祝的；按开始的先后排，位置不会乱跳
    const crew = [...this.sessions.values()]
      .filter((s) => s.state !== 'idle' || (s.doneAt && now - s.doneAt < DONE_SHOW_MS))
      .sort((a, b) => (a.first || a.since) - (b.first || b.since))
      .map(view);
    return {
      active: list.length,
      top: top ? view(top) : null,
      sessions: crew,
    };
  }

  // 正在干活（不是等批准）的会话里，最早开始的那个已经跑了多久（毫秒）；没有就是 0
  runningFor() {
    const now = Date.now();
    let best = 0;
    for (const s of this.sessions.values()) if (s.state === 'working') best = Math.max(best, now - (s.since || now));
    return best;
  }

  // ---------------- 写入 / 移除 ~/.claude/settings.json 里的 hooks ----------------
  isOurHook(h) {
    return h && typeof h.url === 'string' && h.url.includes(HOOK_PATH);
  }

  readClaudeSettings() {
    const file = settingsPath();
    if (!fs.existsSync(file)) return { file, json: {} };
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return { file, json: {} };
    // 解析失败就抛错，绝不覆盖用户的文件
    return { file, json: JSON.parse(text), text };
  }

  // 去掉我们自己加的 hooks，保留用户其他的
  static stripOurs(json, isOurs) {
    const hooks = json.hooks && typeof json.hooks === 'object' ? json.hooks : null;
    if (!hooks) return json;
    for (const ev of Object.keys(hooks)) {
      if (!Array.isArray(hooks[ev])) continue;
      hooks[ev] = hooks[ev]
        .map((group) => {
          if (!group || !Array.isArray(group.hooks)) return group;
          return { ...group, hooks: group.hooks.filter((h) => !isOurs(h)) };
        })
        .filter((group) => !group || !Array.isArray(group.hooks) || group.hooks.length > 0);
      if (hooks[ev].length === 0) delete hooks[ev];
    }
    if (Object.keys(hooks).length === 0) delete json.hooks;
    return json;
  }

  writeClaudeSettings(file, json, originalText) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (originalText !== undefined) {
      // 第一次改之前备份一份
      const backup = `${file}.clawd-backup`;
      if (!fs.existsSync(backup)) fs.writeFileSync(backup, originalText);
    }
    const tmp = `${file}.clawd-tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  install() {
    const cfg = this.config();
    const token = this.ensureToken();
    const { file, json, text } = this.readClaudeSettings();
    ClaudeCode.stripOurs(json, (h) => this.isOurHook(h));
    json.hooks = json.hooks && typeof json.hooks === 'object' ? json.hooks : {};
    const handler = {
      type: 'http',
      url: this.hookUrl(cfg.port),
      headers: { 'X-Clawd-Token': token },
      timeout: 2,
    };
    const events = [...BASE_EVENTS, ...(cfg.tools ? TOOL_EVENTS : [])];
    for (const ev of events) {
      const group = TOOL_MATCHER[ev] ? { matcher: TOOL_MATCHER[ev], hooks: [handler] } : { hooks: [handler] };
      json.hooks[ev] = [...(Array.isArray(json.hooks[ev]) ? json.hooks[ev] : []), group];
    }
    this.writeClaudeSettings(file, json, text);
    this.emit('status');
    return this.status();
  }

  // 已经接入、但缺了新版本才有的事件：自动补上（只动我们自己加的那几条，改之前有备份）
  upgradeHooks() {
    const st = this.status();
    if (!st.installed || st.stale || !st.outdated || st.error) return false;
    this.install();
    return true;
  }

  uninstall() {
    const { file, json, text } = this.readClaudeSettings();
    if (text === undefined) return this.status();
    ClaudeCode.stripOurs(json, (h) => this.isOurHook(h));
    this.writeClaudeSettings(file, json, text);
    this.emit('status');
    return this.status();
  }

  status() {
    const cfg = this.config();
    let installed = false;
    let installedUrl = '';
    let error = '';
    const ours = new Set();
    try {
      const { json } = this.readClaudeSettings();
      const hooks = (json && json.hooks) || {};
      for (const ev of Object.keys(hooks)) {
        for (const g of hooks[ev] || []) {
          for (const h of (g && g.hooks) || []) {
            if (this.isOurHook(h)) {
              installed = true;
              installedUrl = h.url;
              ours.add(ev);
            }
          }
        }
      }
    } catch (err) {
      error = `读不了 ${settingsPath()}：${err.message}`;
    }
    return {
      enabled: cfg.enabled,
      port: cfg.port,
      listening: !!(this.server && this.server.listening),
      serverError: this.serverError,
      installed,
      // 装的时候用的端口和现在不一样，需要重新接入
      stale: installed && installedUrl !== this.hookUrl(cfg.port),
      // 新版本多了几个事件（测试结果等），老的接入缺了
      outdated: installed && [...BASE_EVENTS, ...(cfg.tools ? TOOL_EVENTS : [])].some((ev) => !ours.has(ev)),
      settingsFile: settingsPath(),
      error,
      lastEventAt: this.lastEventAt,
      active: this.snapshot().active,
    };
  }
}

module.exports = { ClaudeCode, toolLabel, toolKind, isTestCommand, translateMessage, HOOK_PATH };
