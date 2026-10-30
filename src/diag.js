'use strict';
// Error log and diagnostics. Everything stays on this Mac in userData/logs/letterhead.log
// (rotated at 1 MB). "Copy diagnostics" builds a plain text report without passwords or keys.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX = 1024 * 1024;
let logFile = null;
const recent = [];
const SECRET = /(pass(word)?|key|token|secret|auth)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi;

function scrub(s) { return String(s).replace(SECRET, (m, k) => `${k}=[hidden]`).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[hidden]').replace(/sk-[A-Za-z0-9_-]{16,}/g, '[hidden]'); }
function init(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); logFile = path.join(dir, 'letterhead.log'); } catch (e) { logFile = null; }
}
function write(level, where, msg) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${where}: ${scrub(msg instanceof Error ? (msg.stack || msg.message) : msg)}`;
  recent.push(line); if (recent.length > 400) recent.shift();
  if (level === 'error') console.error(line); else if (process.env.LETTERHEAD_VERBOSE) console.log(line);
  if (!logFile) return;
  try {
    try { if (fs.statSync(logFile).size > MAX) fs.renameSync(logFile, logFile + '.1'); } catch (e) { /* no file yet */ }
    fs.appendFileSync(logFile, line + '\n');
  } catch (e) { /* disk full or similar, keep running */ }
}
const log = {
  info: (where, msg) => write('info', where, msg),
  warn: (where, msg) => write('warn', where, msg),
  error: (where, msg) => write('error', where, msg),
};
function tail(n = 300) {
  let lines = [];
  if (logFile) {
    for (const f of [logFile + '.1', logFile]) { try { lines = lines.concat(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)); } catch (e) { /* none */ } }
  }
  if (!lines.length) lines = recent.slice();
  return lines.slice(-n);
}
function errorCount(sinceMs) {
  return tail(2000).filter(l => / ERROR /.test(l) && Date.parse(l.slice(1, 25)) >= sinceMs).length;
}
function report(extra) {
  const lines = [
    'Letterhead diagnostics',
    `Created: ${new Date().toString()}`,
    `macOS: ${process.getSystemVersion ? process.getSystemVersion() : os.release()} (${process.platform} ${process.arch}), Darwin ${os.release()}`,
    `Memory: ${Math.round(os.totalmem() / 1073741824)} GB, free ${Math.round(os.freemem() / 1048576)} MB`,
  ];
  for (const [k, v] of Object.entries(extra || {})) lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  lines.push('', 'Recent log (last 120 lines):', ...tail(120));
  return scrub(lines.join('\n'));
}
module.exports = { init, log, tail, report, scrub, errorCount, get file() { return logFile; } };
