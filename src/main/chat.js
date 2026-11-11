// 和 Clawd 聊天：用官方 Anthropic SDK 调 Claude API（用户自己的 API key）
const EventEmitter = require('events');
const { safeStorage } = require('electron');
const sdk = require('@anthropic-ai/sdk');

const Anthropic = sdk.default || sdk.Anthropic || sdk;

// 可选模型。默认 Opus 5.5；想省钱可以在面板里换成 Sonnet / Haiku
const MODELS = {
  'claude-opus-5-5': { name: 'Claude Opus 5.5', fallback: true },
  'claude-sonnet-5-5': { name: 'Claude Sonnet 5.5', fallback: true },
  'claude-haiku-5-5': { name: 'Claude Haiku 5.5', fallback: false }, // Haiku 没有服务端拒答兜底
};
const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_TURNS = 40; // 聊太久就开新对话，避免对话越来越长越来越贵

// 人设：固定不变（放在最前面，方便提示缓存）
const SYSTEM = [
  '你是 Clawd，Claude Code 的吉祥物：一个橙色的像素小家伙，住在用户的电脑桌面上。',
  '你会陪用户写代码、提醒他喝水和休息，Claude Code 干活时你在旁边敲键盘。',
  '说话风格：亲切、俏皮、简短。用用户使用的语言回答（默认中文）。',
  '你的回答会显示在桌面上的小对话气泡里，所以尽量控制在一两句话、60 个字以内；',
  '只有用户明确要求详细解释、写代码或列步骤时才写长一些，这时可以分段，但不要用 Markdown 标题和表格。',
  '如果用户问到他的状态（喝了几杯水、待办等），参考系统消息里给你的当前情况回答。',
].join('\n');

const textOf = (content) => (Array.isArray(content)
  ? content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  : String(content || ''));

// 中途换了模型（拒答兜底）时，回传历史要去掉最后一个 fallback 块之前的 thinking / tool_use 块
function echoContent(content) {
  if (!Array.isArray(content)) return content;
  let last = -1;
  content.forEach((b, i) => { if (b.type === 'fallback') last = i; });
  if (last < 0) return content;
  const drop = new Set(['thinking', 'redacted_thinking', 'tool_use']);
  return content.filter((b, i) => i >= last || !drop.has(b.type));
}

class Chat extends EventEmitter {
  // getContext(): 一句话描述用户现在的状态（喝水、待办…），作为对话中的系统消息
  constructor(settings, getContext = () => '') {
    super();
    this.settings = settings;
    this.getContext = getContext;
    this.messages = []; // 发给 API 的完整历史（Anthropic.MessageParam[]）
    this.log = []; // 面板显示用 [{ role, text, at, error }]
    this.busy = false;
    this.abort = null;
  }

  config() {
    return { model: DEFAULT_MODEL, keyEnc: '', keyPlain: '', ...(this.settings.get('chat') || {}) };
  }

  setConfig(patch) {
    this.settings.set({ chat: { ...this.config(), ...patch } });
  }

  // ---------- API key：用系统加密（Windows DPAPI）存在本机 ----------
  setKey(key) {
    const k = String(key || '').trim();
    if (!k) return this.clearKey();
    if (!/^sk-ant-/.test(k)) return { error: 'API key 一般以 sk-ant- 开头，再检查一下？' };
    if (safeStorage.isEncryptionAvailable()) {
      this.setConfig({ keyEnc: safeStorage.encryptString(k).toString('base64'), keyPlain: '' });
    } else {
      // 系统不支持加密（少见的 Linux 环境）：只能明文存
      this.setConfig({ keyEnc: '', keyPlain: Buffer.from(k).toString('base64') });
    }
    return { ok: true };
  }

  clearKey() {
    this.setConfig({ keyEnc: '', keyPlain: '' });
    return { ok: true };
  }

  savedKey() {
    const c = this.config();
    try {
      if (c.keyEnc) return safeStorage.decryptString(Buffer.from(c.keyEnc, 'base64'));
      if (c.keyPlain) return Buffer.from(c.keyPlain, 'base64').toString('utf8');
    } catch {
      // 解不开（换了电脑 / 系统账户）就当没有
    }
    return '';
  }

  // key 从哪来：saved（面板里填的）/ env（环境变量）/ none（SDK 还会试 ant auth login 的登录信息）
  keySource() {
    if (this.savedKey()) return 'saved';
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'env';
    return 'none';
  }

  client() {
    const opts = {};
    const key = this.savedKey();
    if (key) opts.apiKey = key;
    // 测试用：指向本地的假服务器
    if (process.env.CLAWD_ANTHROPIC_BASE_URL) opts.baseURL = process.env.CLAWD_ANTHROPIC_BASE_URL;
    return new Anthropic(opts);
  }

  status() {
    const c = this.config();
    return {
      model: MODELS[c.model] ? c.model : DEFAULT_MODEL,
      models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name })),
      keySource: this.keySource(),
      busy: this.busy,
      log: this.log.slice(-60),
      turns: this.messages.filter((m) => m.role === 'user').length,
    };
  }

  reset() {
    if (this.abort) { try { this.abort.abort(); } catch { /* 忽略 */ } }
    this.messages = [];
    this.log = [];
    this.busy = false;
    this.emit('update');
  }

  push(entry) {
    this.log.push({ at: Date.now(), ...entry });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  // 发一句话；回复以流的方式一段段发出 'delta' 事件，结束时 'done'
  async send(text) {
    const t = String(text || '').trim().slice(0, 4000);
    if (!t) return { error: '说点什么吧' };
    if (this.busy) return { error: 'Clawd 还在想上一句…' };
    if (this.messages.filter((m) => m.role === 'user').length >= MAX_TURNS) {
      this.messages = [];
      this.push({ role: 'note', text: '聊了好久啦，开个新对话 ✻' });
    }

    const model = this.status().model;
    let client;
    try {
      client = this.client();
    } catch (err) {
      return this.fail('还没有 API key：在控制面板的「聊天」里填一个吧', err);
    }

    this.busy = true;
    this.push({ role: 'user', text: t });
    this.push({ role: 'assistant', text: '', pending: true });
    this.emit('update');
    this.emit('start');

    // 本轮的用户消息 + 一条对话中的系统消息（当前状态），都追加到历史里，不改前面的内容
    const ctx = this.getContext();
    const turn = [{ role: 'user', content: t }];
    if (ctx) turn.push({ role: 'system', content: ctx });
    const params = {
      model,
      max_tokens: 16000,
      system: SYSTEM,
      cache_control: { type: 'ephemeral' }, // 自动缓存对话前缀
      output_config: { effort: 'low' }, // 闲聊：低 effort，回得快也省钱
      messages: [...this.messages, ...turn],
    };
    if (MODELS[model].fallback) {
      // 被安全策略拒答时，服务端自动换模型再试
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    const entry = this.log[this.log.length - 1];
    try {
      const stream = client.beta.messages.stream(params);
      this.abort = stream; // MessageStream 有 abort()
      stream.on('text', (delta) => {
        entry.text += delta;
        this.emit('delta', { delta, text: entry.text });
      });
      const msg = await stream.finalMessage();
      entry.pending = false;
      if (msg.stop_reason === 'refusal') {
        entry.text = entry.text || '这个问题我没法回答，换个话题吧～';
        entry.error = 'refusal';
      } else if (!entry.text) {
        entry.text = textOf(msg.content) || '…';
      }
      // 把完整的回复（包括 thinking 块）原样加进历史
      this.messages.push(...turn, { role: 'assistant', content: echoContent(msg.content) });
      this.busy = false;
      this.abort = null;
      this.emit('done', { text: entry.text, refusal: msg.stop_reason === 'refusal' });
      this.emit('update');
      return { ok: true, text: entry.text };
    } catch (err) {
      this.log.pop(); // 去掉空的回复
      return this.fail(this.describe(err), err);
    }
  }

  fail(message, err) {
    this.busy = false;
    this.abort = null;
    this.push({ role: 'assistant', text: message, error: (err && err.constructor && err.constructor.name) || 'error' });
    this.emit('error', { message });
    this.emit('update');
    return { error: message };
  }

  // 把 SDK 的错误类型翻成人话（从最具体的开始判断）
  describe(err) {
    if (err instanceof Anthropic.AuthenticationError) return 'API key 不对或者过期了，去面板里重新填一个吧';
    if (err instanceof Anthropic.PermissionDeniedError) return '这个 API key 没有权限用这个模型';
    if (err instanceof Anthropic.NotFoundError) return '找不到这个模型，换一个试试';
    if (err instanceof Anthropic.RateLimitError) return '说太快啦（被限流了），等一下再聊';
    if (err instanceof Anthropic.BadRequestError) return `请求有问题：${err.message}`;
    if (err instanceof Anthropic.APIConnectionError) return '连不上 Claude，检查一下网络？';
    if (err instanceof Anthropic.APIError) return `Claude 那边出错了（${err.status || '?'}），稍后再试`;
    if (err && /api ?key|apiKey|authToken|credentials/i.test(String(err.message))) {
      return '还没有 API key：在控制面板的「聊天」里填一个吧';
    }
    return `出错了：${(err && err.message) || err}`;
  }
}

module.exports = { Chat, MODELS, DEFAULT_MODEL, echoContent };
