// 简单日志：写到用户数据文件夹里的 clawd.log（超过 1MB 就清空重来）
// 设置环境变量 CLAWD_DEBUG_LOG=文件路径 可以把详细日志写到别处（调试用）
const fs = require('fs');
const path = require('path');

let file = process.env.CLAWD_DEBUG_LOG || '';
const verbose = !!process.env.CLAWD_DEBUG_LOG;

function init(userData) {
  if (!file) file = path.join(userData, 'clawd.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.writeFileSync(file, '');
  } catch {
    // 忽略
  }
}

function write(level, args) {
  if (!file) return;
  const text = args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  try {
    fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
  } catch {
    // 忽略
  }
}

module.exports = {
  init,
  info: (...a) => write('INFO', a),
  error: (...a) => write('ERROR', a),
  debug: (...a) => { if (verbose) write('DEBUG', a); },
  file: () => file,
};
