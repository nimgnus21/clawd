# Clawd 桌面小组件

一个住在你桌面上的 **Claude Code 吉祥物 Clawd**（橙色像素小家伙）。
透明背景、总在最前；陪你写代码、提醒你喝水休息，Claude Code 干活时它在旁边敲键盘。

> 非官方粉丝作品，仅供个人使用。

![预览](preview.png)

## Windows 直接安装

双击 `Clawd-Setup-x.x.x.exe` 按提示安装，装好后桌面和开始菜单里会有 Clawd。

第一次运行时 Windows 可能弹出「Windows 已保护你的电脑」（安装包没有付费的代码签名）：点 **更多信息 → 仍要运行**。

右键 Clawd → **控制面板…** 可以看到所有设置。

## 功能一览

### 互动
| 操作 | 反应 |
| --- | --- |
| 单击 | 跳一下、说句话（有时先 `✻ Pondering…`；偶尔念一下你没做完的待办） |
| 双击 | 跳舞 |
| 鼠标停在身上 | 被摸头：眯眼、脸红、冒爱心 |
| 鼠标在头顶 | 抬头看 |
| 拖动 | 手脚乱挥；散步模式下松手会掉回地面 |
| 闲着 | 每隔一会儿随机：打哈欠、伸懒腰、坐下发呆、张望、蹦一下、自言自语、冲鼠标挥手 |
| 电脑闲置 90 秒 | 睡觉 zZ，一动就醒 |

### Claude Code 联动
- Claude Code 干活时 Clawd 敲键盘，气泡里显示正在做什么（`Edit main.js`、`Bash Run tests`）和用时
- 等你批准时举手挥动 + 系统通知；点一下 Clawd 表示「知道了」
- 做完了跳起来庆祝 + 通知（短任务不打扰，门槛可调）
- **接入方法**：控制面板 →「Claude Code」→ **一键接入**。会在 `~/.claude/settings.json` 里加几条 http hooks（先备份成 `settings.json.clawd-backup`），随时可以一键移除
- 原理：Clawd 在本机 `127.0.0.1:47823` 开一个只收本机请求、带口令校验的小服务，Claude Code 把事件发过来。不联网

### 提醒（都可以在面板里调或关）
- **喝水**：默认每 45 分钟，Clawd 举起水杯，点它「咕嘟咕嘟」喝掉，记录今天第几杯
- **久坐**：连续用电脑 60 分钟提醒起来活动；离开 5 分钟自动算休息过
- **护眼 20-20-20**：每 20 分钟看远处 20 秒，点 Clawd 开始倒计时（默认关）
- **待办**：面板里添加，可以设提醒时间；到点 Clawd 举手提醒，点它完成，右键可以稍后 10 分钟 / 1 小时
- **专注计时**：25 / 45 / 15 / 5 分钟，专注时 Clawd 敲键盘
- **整点报时**、头顶**时钟**

### 勿扰
- 全屏看视频、玩游戏、PPT 放映时自动勿扰（仅 Windows）
- 也可以手动勿扰 30 分钟 / 1 小时 / 2 小时 / 到明早
- 勿扰时 Clawd 藏起来（或变淡不说话），提醒先攒着，结束后补上

### 成长和装扮
- 喝水、活动、护眼、完成待办、专注、Claude Code 完成任务、摸头都会加经验，升级解锁配饰：
  蝴蝶结、墨镜、小花、耳机、厨师帽、眼镜、学士帽、皇冠
- 心情会随时间慢慢下降，互动会让它开心；心情差时它会委屈巴巴，心情好时自己跳舞
- 节日自动换装：元旦、春节、情人节、万圣节、圣诞、中秋、你的生日（面板里设置）；遇到过的节日帽永久收进衣柜

### 其他
- **散步模式**：在任务栏上走来走去，偶尔追鼠标
- **爬窗口**（仅 Windows）：散步时能站到其他窗口顶上、偶尔跳上去，拖动窗口时跟着走，窗口关了就掉下来
- **电脑状态**：电量低提醒、CPU 一直很忙时流汗、内存快满提醒
- **统计**：每天喝水、专注、活动、护眼、Claude Code 任务、完成待办的图表（7 / 30 天）和表格
- **和 Clawd 聊天**：用 Claude API（需要你自己的 API key，见下面）
- **自动更新**：从 GitHub Releases 检查新版本（需要设置仓库，见下面）

## 和 Clawd 聊天

控制面板 →「聊天」→ 填入你的 Anthropic API key（在 console.anthropic.com 创建）。

- key 用系统加密（Windows DPAPI）存在本机，只用来调 Claude API
- 默认模型 Claude Opus 5.5，可以换成更便宜的 Sonnet 5.5 / Haiku 5.5
- 用的是低思考强度（回得快、省钱）；Opus / Sonnet 开了「被拒答时自动换模型重试」
- 聊天会按你的 API 用量计费；对话里会附带今天喝水、待办等状态，方便 Clawd 回答
- 设置了环境变量 `ANTHROPIC_API_KEY`，或者用 `ant auth login` 登录过，不填 key 也能用

## 自动更新

Clawd 默认从 [nimgnus21/clawd](https://github.com/nimgnus21/clawd) 的 Releases 检查新版本（启动 30 秒后和每 6 小时一次），
有新版本就后台下载、退出时安装，也可以在控制面板「关于」里点「重启并更新」。

**仓库必须是公开的**（私有仓库的 Releases 别人下载不了，自动更新会失败）。

### 发一个新版本

1. 改版本号：`npm version patch`（2.0.0 → 2.0.1；大改动用 `minor`）
2. 打包：`npm run dist:win`
3. 在 GitHub 仓库页面 → **Releases → Draft a new release**：
   - Tag 填 `v` + 版本号，比如 `v2.0.1`
   - 把 `dist/` 里这三个文件拖进去：`Clawd-Setup-2.0.1.exe`、`Clawd-Setup-2.0.1.exe.blockmap`、`latest.yml`
   - 点 **Publish release**（不要勾 pre-release）

或者设置好 `GH_TOKEN` 环境变量（一个有仓库写权限的 GitHub token）后，一条命令打包并上传：

```bash
npx electron-builder --win --publish always
```

已经装了旧版的电脑，下次检查时就会自动更新到新版。

## 隐私

- 设置、统计、待办都存在本机：`%APPDATA%\Clawd\`（`settings.json`、`data.json`，日志 `clawd.log`）
- Claude Code 联动只在本机传递，服务只监听 `127.0.0.1`，需要安装时生成的口令
- 只有「聊天」会把内容发给 Anthropic 的 Claude API；「自动更新」只访问 GitHub 上的发布仓库（默认 nimgnus21/clawd）

## 从源码运行 / 打包

需要 [Node.js](https://nodejs.org) 18 或更新版本。

```bash
npm install
npm start
```

国内网络装不上 Electron 时：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com
```

打包（在哪个系统上打包，就生成哪个系统的安装包）：

```bash
npm run dist:win     # Windows：dist/Clawd-Setup-x.x.x.exe
npm run dist:mac     # macOS：.dmg
npm run dist:linux   # Linux：.AppImage
```

## 自己改造

| 想改什么 | 改哪里 |
| --- | --- |
| 台词 | `src/renderer/pet/lines.js` |
| 像素造型、表情 | `src/renderer/pet/sprite.js`（16×10 网格） |
| 配饰、节日 | `src/renderer/pet/outfits.js` |
| 行为、动作 | `src/renderer/pet/pet.js` |
| 默认设置 | `src/main/config.js` |
| 经验值、解锁等级 | `src/main/progress.js` |
| 聊天人设、模型 | `src/main/chat.js` |

## 文件结构

```
src/main/           主进程
  index.js            入口，把各模块连起来
  pet-window.js       透明小人窗口：拖动、掉落、散步、爬窗口
  surfaces.js         爬窗口的“地面”计算
  winapi.js           Windows 系统接口（全屏检测、窗口位置）
  reminders.js        喝水 / 久坐 / 护眼提醒
  todos.js            待办
  dnd.js              勿扰
  claude-code.js      Claude Code hooks 服务 + 一键接入
  chat.js             Claude API 聊天
  progress.js         经验、等级、心情
  stats.js            每日统计
  sysmon.js           CPU / 内存
  updater.js          自动更新
  panel-window.js     控制面板窗口
  menu.js             右键菜单、托盘
src/preload/        给页面暴露的接口
src/renderer/pet/   小人页面
src/renderer/panel/ 控制面板页面
assets/             图标
```

## 已知限制

- 自动勿扰的全屏检测、爬窗口只在 Windows 上有
- 如果你在 WSL 里用 Claude Code，需要在 WSL 的 `~/.claude/settings.json` 里手动加 hooks（地址用 Windows 主机 IP）
- Linux 上小人周围的透明区域不能点穿
- 安装包约 110MB，主要是 Electron 自带的浏览器内核
