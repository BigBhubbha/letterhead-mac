'use strict';
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu, nativeTheme, powerSaveBlocker, powerMonitor, Notification } = require('electron');
const { Scheduler } = require('./scheduler');
const { Updater } = require('./updater');
const { Power } = require('./power');
const fs = require('fs');
const path = require('path');
const engine = require('./engine');
const drafts = require('./drafts');
const wireMail = require('./mailwire');
const diag = require('./diag');
const os = require('os');

// --health-check=<file>: start, load the window hidden, write <file>, exit. The updater and the
// installer run this on a freshly swapped app before deleting the old copy.
// --smoke-test[=<file>]: full start with a throwaway data folder, visit every screen, report, exit.
const argVal = name => { const a = process.argv.find(x => x === name || x.startsWith(name + '=')); return a === undefined ? undefined : (a.includes('=') ? a.slice(a.indexOf('=') + 1) : ''); };
const HEALTH = argVal('--health-check');
const SMOKE = argVal('--smoke-test');
const MODE = HEALTH !== undefined ? 'health' : SMOKE !== undefined ? 'smoke' : 'normal';
if (MODE !== 'normal') app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'letterhead-' + MODE + '-')));

const isMac = process.platform === 'darwin';
let win = null;

const dataDir = () => app.getPath('userData');
const file = n => path.join(dataDir(), n);
function readJson(n, fallback) {
  let text; try { text = fs.readFileSync(file(n), 'utf8'); } catch (e) { return fallback; }
  try { return JSON.parse(text); } catch (e) {
    // keep the damaged file for the log instead of silently overwriting it later
    try { fs.renameSync(file(n), file(n) + '.damaged'); } catch (er) { /* ignore */ }
    try { require('./diag').log.error('data', `${n} was damaged and set aside as ${n}.damaged: ${e.message}`); } catch (er) { /* ignore */ }
    return fallback;
  }
}
// write to a temp file and rename, so a crash or full disk never leaves half a settings file
function writeJson(n, v) { fs.mkdirSync(dataDir(), { recursive: true }); const f = file(n), tmp = f + '.tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, f); }

// ---------- account (password encrypted with the macOS Keychain via safeStorage) ----------
function loadAccount(withSecret) {
  const a = readJson('account.json', null);
  if (!a) return null;
  const out = { ...a };
  delete out.passEnc; delete out.passPlain;
  out.hasPassword = !!(a.passEnc || a.passPlain);
  out.encrypted = !!a.passEnc;
  if (withSecret) {
    if (a.passEnc) { try { out.pass = safeStorage.decryptString(Buffer.from(a.passEnc, 'base64')); } catch (e) { out.pass = ''; out.keychainError = true; try { require('./diag').log.error('keychain', 'could not decrypt the saved password: ' + e.message); } catch (er) { /* ignore */ } } }
    else out.pass = a.passPlain || '';
  }
  return out;
}
function saveAccount(input) {
  const prev = readJson('account.json', {}) || {};
  const a = { preset: input.preset, host: input.host, port: Number(input.port), security: input.security, user: input.user, email: input.email || '', login: input.login || '', alias: input.alias || '',
    fromName: input.fromName || '', fromEmail: input.fromEmail || '', replyTo: input.replyTo || '', allowInsecure: !!input.allowInsecure,
    imapHost: input.imapHost || '', imapPort: Number(input.imapPort) || 993, imapSecurity: input.imapSecurity || 'ssl' };
  if (input.pass) {
    const pass = String(input.pass).replace(/\s+/g, input.preset === 'gmail' ? '' : ' ').trim();
    if (safeStorage.isEncryptionAvailable()) a.passEnc = safeStorage.encryptString(pass).toString('base64');
    else a.passPlain = pass; // only happens off macOS when no keyring is available
  } else { if (prev.passEnc) a.passEnc = prev.passEnc; if (prev.passPlain) a.passPlain = prev.passPlain; }
  writeJson('account.json', a);
  return loadAccount(false);
}
function accountForSend(input) {
  const saved = loadAccount(true) || {};
  const a = { ...saved, ...(input || {}) };
  if (!a.pass) a.pass = saved.pass;
  return a;
}

// ---------- rolling 24 hour usage ----------
const usage = {
  _list() { const now = Date.now(); return (readJson('usage.json', []) || []).filter(t => now - t < 86400000); },
  count() { return this._list().length; },
  record() { const l = this._list(); l.push(Date.now()); writeJson('usage.json', l); },
  oldest() { const l = this._list(); return l.length ? Math.min(...l) : null; },
};


const FEED_URL = process.env.LETTERHEAD_UPDATE_FEED || 'https://github.com/BigBhubbha/letterhead-mac/releases/latest/download/latest.json';
let scheduler = null, updater = null, power = null, quitting = false, wired = null;

function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }
const settings = () => readJson('settings.json', {}) || {};
const setting = (k, d) => { const v = settings()[k]; return v === undefined ? d : v; };

function notify(title, body) {
  try { if (Notification.isSupported()) new Notification({ title, body, silent: false }).show(); } catch (e) {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 1040, minHeight: 660,
    title: 'Letterhead',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 20 },
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    backgroundColor: isMac ? '#00000000' : '#F4EEE3',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // ready-to-show is not always delivered for transparent, vibrant windows, so also show after load
  const showOnce = () => { if (win && !win.isDestroyed() && !win.isVisible() && !app.getLoginItemSettings().wasOpenedAsHidden) win.show(); };
  win.once('ready-to-show', showOnce);
  win.webContents.once('did-finish-load', () => setTimeout(showOnce, 1500));
  if (process.env.LETTERHEAD_HARNESS) require(process.env.LETTERHEAD_HARNESS)(win, { nativeTheme, getScheduler: () => scheduler, getUpdater: () => updater, getPower: () => power, getWired: () => wired });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); else if (/^mailto:/i.test(url)) send('menu', { action: 'compose', mailto: url }); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  // On a Mac, closing the window keeps Letterhead running in the background so schedules keep working.
  win.on('close', e => {
    if (isMac && !quitting) { e.preventDefault(); win.hide(); if (scheduler && scheduler.hasWork() && !setting('_hidHint', false)) { notify('Letterhead is still running', 'Scheduled batches will send on time. Quit from the menu bar to stop them.'); writeJson('settings.json', { ...settings(), _hidHint: true }); } }
  });
}
function showWindow() { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } }

function buildMenu() {
  const go = tab => () => { showWindow(); send('menu', { tab }); };
  const checkUpdates = { label: 'Check for Updates…', click: () => { showWindow(); send('menu', { tab: 'settings' }); updater && updater.check({ manual: true }); } };
  const tpl = [
    ...(isMac ? [{ label: 'Letterhead', submenu: [{ role: 'about' }, checkUpdates, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: go('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'New Email', accelerator: 'CmdOrCtrl+N', click: () => { showWindow(); send('menu', { action: 'compose' }); } },
      { label: 'New Batch…', accelerator: 'CmdOrCtrl+Shift+N', click: () => { showWindow(); send('menu', { action: 'newBatch' }); } },
      { type: 'separator' },
      { label: 'Import Recipients CSV…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', { action: 'import' }) },
      { label: 'Attach File…', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('menu', { action: 'attach' }) },
      { type: 'separator' },
      { label: 'Export Results CSV…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', { action: 'export' }) },
      { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Mail', accelerator: 'CmdOrCtrl+0', click: go('mail') },
      { label: 'Suggested Replies', accelerator: 'CmdOrCtrl+Shift+R', click: go('assist') },
      { type: 'separator' },
      { label: 'Account', accelerator: 'CmdOrCtrl+1', click: go('account') },
      { label: 'Recipients', accelerator: 'CmdOrCtrl+2', click: go('recipients') },
      { label: 'Letter', accelerator: 'CmdOrCtrl+3', click: go('letter') },
      { label: 'Drafts', accelerator: 'CmdOrCtrl+4', click: go('drafts') },
      { label: 'Send', accelerator: 'CmdOrCtrl+5', click: go('send') },
      { label: 'Schedule', accelerator: 'CmdOrCtrl+6', click: go('schedule') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { label: 'Sending', submenu: [
      { label: 'Send Test to Myself', accelerator: 'CmdOrCtrl+T', click: () => send('menu', { action: 'test' }) },
      { label: 'Pause or Resume', accelerator: 'CmdOrCtrl+P', click: () => send('menu', { action: 'toggle' }) },
      { label: 'Retry Failed', accelerator: 'CmdOrCtrl+R', click: () => send('menu', { action: 'retry' }) },
      { type: 'separator' },
      { label: 'Restore Normal Sleep', click: () => power && power.restoreNow() }] },
    { role: 'windowMenu' },
    ...(!isMac ? [{ label: 'Help', submenu: [checkUpdates] }] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------- keep awake ----------
function powerWanted() {
  const live = scheduler && scheduler.busy();
  const want = setting('keepAwake', false);
  const lidSetting = setting('keepAwakeLid', false);
  const next = scheduler ? scheduler.nextDue() : null;
  const queued = scheduler && scheduler.batches.some(b => ['queued', 'sending', 'paused'].includes(b.status));
  const lead = setting('lidLeadMin', 0); // 0 = from the moment a batch is scheduled
  const soon = next != null && (lead === 0 || next - Date.now() <= lead * 60000);
  const scheduledWork = next != null || queued;
  return {
    wantAwake: !!live || (want && scheduledWork),
    wantLid: !!(want && lidSetting && (live || queued || soon)),
  };
}
let powerT = null;
function refreshPower() { clearTimeout(powerT); powerT = setTimeout(() => power && power.update({ ...powerWanted(), blockerApi: powerSaveBlocker }).catch(() => {}), 200); }

// ---------- IPC ----------
ipcMain.handle('account:get', () => {
  const a = loadAccount(false); if (!a || !a.encrypted) return a;
  // check once that the Keychain still lets us read the password (a denied prompt makes every send fail)
  const full = loadAccount(true); if (full && full.keychainError) a.keychainError = true;
  return a;
});
ipcMain.handle('account:save', (e, a) => { const r = saveAccount(a); if (wired) wired.onAccount(); return r; });
ipcMain.handle('account:clear', () => { try { fs.unlinkSync(file('account.json')); } catch (e) {} if (wired) wired.mail.stop().catch(() => {}); return null; });
ipcMain.handle('account:verify', (e, a) => engine.verifyAccount(accountForSend(a)));
ipcMain.handle('draft:get', () => readJson('draft.json', null));
ipcMain.handle('draft:save', (e, d) => { writeJson('draft.json', d); return true; });
ipcMain.handle('settings:get', () => readJson('settings.json', null));
ipcMain.handle('settings:save', (e, s) => {
  writeJson('settings.json', { ...settings(), ...s }); refreshPower(); if (wired) wired.onSettings(s);
  if (updater && 'autoUpdate' in s) { updater.stop(); if (s.autoUpdate && (app.isPackaged || process.env.LETTERHEAD_UPDATE_FEED)) updater.start(); }
  return true;
});
ipcMain.handle('usage:get', () => ({ count: usage.count(), oldest: usage.oldest() }));
ipcMain.handle('usage:reset', () => { writeJson('usage.json', []); return { count: 0, oldest: null }; });
ipcMain.handle('open:external', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('app:info', () => ({ appPath: updater ? updater.appBundle() : null, logFile: diag.file, version: app.getVersion(), packaged: app.isPackaged, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, platform: process.platform, arch: process.arch, openAtLogin: app.getLoginItemSettings().openAtLogin }));
ipcMain.handle('app:openAtLogin', (e, on) => { try { app.setLoginItemSettings({ openAtLogin: !!on }); } catch (er) {} return app.getLoginItemSettings().openAtLogin; });

ipcMain.handle('csv:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import recipients', properties: ['openFile'], filters: [{ name: 'CSV or text', extensions: ['csv', 'tsv', 'txt'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
});
ipcMain.handle('attach:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Attach a file', properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map(p => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
});
ipcMain.handle('attach:stat', (e, paths) => paths.map(p => { try { return { path: p, name: path.basename(p), size: fs.statSync(p).size }; } catch (er) { return { path: p, name: path.basename(p), missing: true }; } }));
ipcMain.handle('send:test', async (e, { template, fields }) => { const r = await engine.sendTest(accountForSend(), template, fields || {}); if (r.ok) usage.record(); return r; });

ipcMain.handle('drafts:list', async () => {
  const account = accountForSend();
  if (!account || !account.pass) return { ok: false, error: 'Connect an account first.' };
  if (!account.imapHost) return { ok: false, error: 'Add your IMAP server on the Account tab to read drafts.' };
  try { return { ok: true, ...(await drafts.listDrafts(account)) }; }
  catch (e) { return { ok: false, error: e.noDrafts ? e.message : drafts.friendlyImapError(e), noDrafts: !!e.noDrafts }; }
});
ipcMain.handle('drafts:verify', (e, a) => drafts.verifyImap(accountForSend(a)));

// campaigns, all routed through the scheduler so batches and manual sends never overlap
ipcMain.handle('campaign:start', (e, cfg) => { try { return { ok: true, snapshot: scheduler.runImmediate(cfg) }; } catch (er) { return { ok: false, error: er.message }; } });
const cur = () => scheduler.current();
ipcMain.handle('campaign:pause', () => { const c = scheduler.active; c && c.pause('user'); return true; });
ipcMain.handle('campaign:resume', () => { const c = scheduler.active; c && c.resume(); return true; });
ipcMain.handle('campaign:cancel', () => { const c = scheduler.active; if (c) { if (scheduler.activeBatchId) scheduler.cancel(scheduler.activeBatchId); else c.cancel(); } return true; });
ipcMain.handle('campaign:retry', () => { if (scheduler.active) return scheduler.active.retryFailed(); const c = scheduler.last; if (!c) return 0; if (c.o.batchId) return scheduler.retry(c.o.batchId); scheduler.active = c; scheduler.last = null; return c.retryFailed(); });
ipcMain.handle('campaign:snapshot', () => scheduler.snapshot());
ipcMain.handle('campaign:clear', () => scheduler.clearLast());
const exportTo = async () => {
  const c = cur(); if (!c) return null;
  if (process.env.LETTERHEAD_EXPORT_TO) { fs.writeFileSync(process.env.LETTERHEAD_EXPORT_TO, engine.resultsCsv(c.items)); return process.env.LETTERHEAD_EXPORT_TO; }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const r = await dialog.showSaveDialog(win, { title: 'Export results', defaultPath: `letterhead-results-${stamp}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, engine.resultsCsv(c.items));
  return r.filePath;
};
ipcMain.handle('campaign:export', exportTo);

// batches
const wrapE = fn => (...a) => { try { return { ok: true, value: fn(...a) }; } catch (e) { return { ok: false, error: e.message }; } };
ipcMain.handle('batches:list', () => scheduler.list());
ipcMain.handle('batches:save', (e, b) => wrapE(() => scheduler.upsert(b))());
ipcMain.handle('batches:duplicate', (e, id) => wrapE(() => scheduler.duplicate(id))());
ipcMain.handle('batches:remove', (e, id) => wrapE(() => scheduler.remove(id))());
ipcMain.handle('batches:cancel', (e, id) => wrapE(() => scheduler.cancel(id))());
ipcMain.handle('batches:reschedule', (e, id, at) => wrapE(() => scheduler.reschedule(id, at))());
ipcMain.handle('batches:sendNow', (e, id) => wrapE(() => scheduler.sendNow(id))());
ipcMain.handle('batches:pause', (e, id) => wrapE(() => scheduler.pause(id))());
ipcMain.handle('batches:resume', (e, id) => wrapE(() => scheduler.resume(id))());
ipcMain.handle('batches:retry', (e, id) => wrapE(() => scheduler.retry(id))());
ipcMain.handle('batches:get', (e, id) => { const b = scheduler.get(id); return b ? JSON.parse(JSON.stringify(b)) : null; });
ipcMain.handle('batches:export', async (e, id) => {
  const b = scheduler.get(id); if (!b || !b.items) return null;
  if (process.env.LETTERHEAD_EXPORT_TO) { fs.writeFileSync(process.env.LETTERHEAD_EXPORT_TO, engine.resultsCsv(b.items)); return process.env.LETTERHEAD_EXPORT_TO; }
  const r = await dialog.showSaveDialog(win, { title: 'Export batch results', defaultPath: `${b.name.replace(/[^\w -]+/g, '')}-results.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, engine.resultsCsv(b.items)); return r.filePath;
});

// updates
ipcMain.handle('update:state', () => updater ? updater.state : null);
ipcMain.handle('update:check', () => updater ? updater.check({ manual: true }) : null);
ipcMain.handle('update:install', () => {
  if (!updater || updater.state.status !== 'ready') return { ok: false, error: 'No update is ready.' };
  if (scheduler.busy()) { pendingRestart = true; return { ok: true, waiting: true }; }
  return doInstall();
});
let pendingRestart = false;
function doInstall() {
  try { updater.install({ relaunch: true }); quitting = true; setTimeout(() => app.quit(), 150); return { ok: true }; }
  catch (e) { pendingRestart = false; return { ok: false, error: e.message }; }
}

// power
ipcMain.handle('power:status', () => power ? power.status() : null);
ipcMain.handle('power:restore', () => power ? power.restoreNow() : { ok: true });

// Test hook used only by the automated harness.
if (process.env.LETTERHEAD_USERDATA) app.setPath('userData', process.env.LETTERHEAD_USERDATA);

app.setName('Letterhead');
diag.init(path.join(app.getPath('userData'), 'logs'));
process.on('uncaughtException', e => diag.log.error('main', e));
process.on('unhandledRejection', e => diag.log.error('main (promise)', e));
const startedAt = Date.now();
diag.log.info('app', `start ${app.getVersion()} mode=${MODE} at ${process.execPath}`);

ipcMain.handle('diag:report', (e, where, msg) => { diag.log.error('renderer ' + String(where).slice(0, 60), String(msg).slice(0, 4000)); return true; });
ipcMain.handle('diag:log', () => ({ lines: diag.tail(400), file: diag.file }));
ipcMain.handle('diag:reveal', () => { if (diag.file) shell.showItemInFolder(diag.file); return true; });
ipcMain.handle('diag:copy', async () => {
  const { clipboard } = require('electron');
  const text = await diagnosticsText(); clipboard.writeText(text); return { ok: true, chars: text.length };
});
async function diagnosticsText() {
  const appPath = updater ? updater.appBundle() : null;
  const inst = updater ? updater.installability() : null;
  let mailStatus = null; try { mailStatus = wired ? wired.mail.status() : 'not started'; } catch (e) { mailStatus = 'error: ' + e.message; }
  const acct = loadAccount(false);
  const st = settings();
  const safeSettings = Object.fromEntries(Object.entries(st).filter(([k]) => !/sig|about|key|pass/i.test(k)).map(([k, v]) => [k, typeof v === 'object' ? '[set]' : v]));
  let quarantine = 'n/a';
  if (isMac && appPath) { try { quarantine = require('child_process').execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', appPath], { encoding: 'utf8', timeout: 3000 }).trim() || 'none'; } catch (e) { quarantine = 'none'; } }
  return diag.report({
    'Letterhead': `${app.getVersion()} (${app.isPackaged ? 'packaged' : 'dev'})`,
    'App location': appPath || process.execPath,
    'Can install updates here': inst ? (inst.ok ? 'yes' : 'no, ' + inst.note) : 'n/a',
    'Quarantine flag': quarantine,
    'Running for': Math.round((Date.now() - startedAt) / 60000) + ' min',
    'Account': acct ? `${acct.preset || 'custom'} ${acct.host}:${acct.port} imap ${acct.imapHost || 'none'} password ${acct.hasPassword ? (acct.encrypted ? 'saved, encrypted' : 'saved, not encrypted') : 'missing'}` : 'none',
    'Keychain encryption': (() => { try { return safeStorage.isEncryptionAvailable() ? 'available' : 'not available'; } catch (e) { return 'error ' + e.message; } })(),
    'Mail': mailStatus,
    'Update': updater ? { status: updater.state.status, version: updater.state.version, error: updater.state.error } : 'n/a',
    'Keep awake': power ? power.status() : 'n/a',
    'Batches': scheduler ? scheduler.batches.map(b => b.status).join(', ') || 'none' : 'n/a',
    'Settings': safeSettings,
  });
}

if (MODE === 'health') {
  if (isMac && app.dock) app.dock.hide();
  app.whenReady().then(async () => {
    const out = HEALTH || path.join(app.getPath('userData'), 'health.json');
    const res = { version: app.getVersion(), pid: process.pid, ok: false, t: Date.now() };
    const finish = code => { try { fs.writeFileSync(out, JSON.stringify(res)); } catch (e) { /* the caller times out */ } app.exit(code); };
    setTimeout(() => { res.error = 'timeout'; finish(2); }, 45000);
    try {
      const { MailDB } = require('./maildb'); const db = await MailDB.open(null); db.close && db.close(); // sql.js wasm loads
      const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
      await w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { health: '1' } });
      res.dom = await w.webContents.executeJavaScript('!!document.querySelector("#view-mail") && !!document.querySelector("#view-settings")');
      res.ok = !!res.dom; finish(res.ok ? 0 : 1);
    } catch (e) { res.error = e.message; finish(1); }
  });
} else {
const gotLock = process.env.LETTERHEAD_HARNESS || MODE === 'smoke' ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'system';
  buildMenu();
  const usageWithCap = usage;
  scheduler = new Scheduler({
    file: file('batches.json'), usage: usageWithCap,
    getAccount: () => accountForSend(),
    getDailyCap: () => Number(setting('cap', 500)) || 0,
    getSetting: (k, d) => setting(k, d),
    hooksFor: (account, cfg) => drafts.campaignHooks(account, cfg),
    tickMs: Number(process.env.LETTERHEAD_TICK_MS) || 15000,
  });
  scheduler.on('campaign:update', u => {
    send('campaign:update', u); refreshPower();
    if (pendingRestart && ['done', 'cancelled'].includes(u.state)) setTimeout(() => { if (pendingRestart && !scheduler.busy()) doInstall(); }, 1500);
  });
  scheduler.on('campaign:log', l => send('campaign:log', l));
  scheduler.on('batches', list => { send('batches:update', list); refreshPower(); });
  scheduler.on('missed', ids => { send('batches:missed', ids); notify('A scheduled batch was missed', 'Your Mac was asleep or Letterhead was closed at its time. Open Letterhead to send it now or pick a new time.'); });
  scheduler.on('notify', n => notify(n.title, n.body));
  const missedAtLaunch = scheduler.load();

  power = new Power({ dir: dataDir() });
  power.on('status', st => send('power:status', st));
  power.startupCheck().then(refreshPower);
  setInterval(refreshPower, 60000);

  updater = new Updater({
    currentVersion: app.getVersion(), feedUrl: FEED_URL, workDir: path.join(dataDir(), 'updates'),
    appPath: app.isPackaged || process.env.LETTERHEAD_APP_PATH ? (process.env.LETTERHEAD_APP_PATH || path.resolve(process.execPath, '..', '..', '..')) : null,
  });
  updater.on('state', st => { send('update:state', st); if (st.status === 'error') diag.log.warn('update', st.error); });
  updater.on('rollback', r => { diag.log.warn('update', `rolled back ${r.version}: ${r.reason}`); notify('Update did not start', `Letterhead ${r.version} did not open on this Mac, so you are still on ${app.getVersion()}. Nothing was lost.`); });
  updater.on('ready', ({ version }) => notify('Letterhead update ready', `Version ${version} is downloaded. Restart Letterhead to use it.`));
  if ((app.isPackaged || process.env.LETTERHEAD_UPDATE_FEED) && MODE === 'normal') { if (setting('autoUpdate', true)) updater.start(); }
  updater.confirmLaunch && updater.confirmLaunch();

  try {
    wired = await wireMail({ app, ipcMain, dialog, shell, safeStorage, Notification, send, settings, setting, saveSettings: p => writeJson('settings.json', { ...settings(), ...p }),
      accountForSend: () => accountForSend(), usage, getDailyCap: () => Number(setting('cap', 500)) || 0, file, readJson, writeJson, showWindow, getWin: () => win });
  } catch (e) {
    diag.log.error('mail wiring failed', e);
    // answer the mail and assistant calls with a clear error instead of leaving them unregistered
    const msg = 'Mail could not start: ' + e.message + '. Settings > Help > Copy diagnostics has details.';
    for (const ch of ['mail:status', 'mail:restart', 'mail:folders', 'mail:threads', 'mail:thread', 'mail:body', 'mail:sync', 'mail:more', 'mail:action', 'mail:search', 'mail:contacts', 'mail:select', 'mail:attachment', 'mail:send', 'mail:saveDraft', 'mail:deleteDraft', 'mail:openLink',
      'ai:status', 'ai:setKey', 'ai:test', 'style:index', 'style:progress', 'style:profile', 'style:saveProfile', 'style:clear',
      'assist:draft', 'assist:list', 'assist:candidates', 'assist:suggestion', 'assist:setDraft', 'assist:dismiss', 'assist:hold', 'assist:sendNow', 'assist:autolog', 'assist:queueBacklog']) {
      try { ipcMain.handle(ch, () => ({ ok: false, error: msg })); } catch (er) { /* already registered before the failure */ }
    }
  }
  createWindow();
  win.webContents.on('render-process-gone', (ev, d) => { diag.log.error('renderer gone', d.reason + ' ' + d.exitCode); if (d.reason !== 'clean-exit' && !quitting) setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 500); });
  win.webContents.on('unresponsive', () => diag.log.warn('window', 'not responding'));
  win.webContents.on('console-message', (ev, level, message, line, src) => { if (level >= 3 && !/ResizeObserver loop/.test(message)) diag.log.error('console', `${message} (${path.basename(String(src || ''))}:${line})`); });
  if (MODE === 'smoke') require('./smoke')(win, { app, diag, getWired: () => wired, getScheduler: () => scheduler, out: SMOKE, startedAt });
  if (missedAtLaunch.length) win.webContents.once('did-finish-load', () => setTimeout(() => send('batches:missed', missedAtLaunch), 600));
  powerMonitor.on('resume', () => scheduler.tick());
  app.on('activate', () => showWindow());
});

app.on('before-quit', e => {
  if (quitting || process.env.LETTERHEAD_HARNESS || MODE === 'smoke') { quitting = true; return; }
  const live = scheduler && scheduler.busy();
  const pending = scheduler && scheduler.batches.filter(b => ['scheduled', 'queued'].includes(b.status)).length;
  if (live || pending) {
    const r = dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : null, { type: 'warning', buttons: ['Keep Letterhead Open', 'Quit Anyway'], defaultId: 0, cancelId: 0,
      message: live ? 'A send is still in progress.' : `${pending} scheduled batch${pending === 1 ? ' is' : 'es are'} waiting.`,
      detail: live ? 'Quitting stops it. Anything already sent stays sent.' : 'Scheduled batches only send while Letterhead is open. Next time you open it, Letterhead will ask before sending anything it missed.' });
    if (r === 0) { e.preventDefault(); return; }
  }
  quitting = true;
  // install a downloaded update on the way out, without reopening
  if (updater && updater.state.status === 'ready' && setting('installOnQuit', true)) { try { updater.install({ relaunch: false }); } catch (er) {} }
});
app.on('will-quit', () => { if (wired) { wired.assistant.stop(); try { wired.db.flush(); } catch (e) {} wired.mail.stop().catch(() => {}); } if (scheduler) { scheduler.saveNow(); scheduler.stop(); } if (power) power.shutdown(); });
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
