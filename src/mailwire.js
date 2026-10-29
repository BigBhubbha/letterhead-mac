'use strict';
// Wires the mail client, the AI provider, the style profile and the reply assistant into the Electron main process.
const fs = require('fs'), path = require('path');
const { MailDB } = require('./maildb');
const { Mail } = require('./mail');
const { AI, PROVIDER_NAMES, DEFAULTS } = require('./ai');
const { Style, statsText } = require('./style');
const { Assistant } = require('./assistant');

module.exports = async function wireMail(x) {
  const { app, ipcMain, dialog, shell, safeStorage, Notification, send, settings, setting, saveSettings, accountForSend, usage, getDailyCap, file, readJson, writeJson, showWindow, getWin } = x;
  const db = await MailDB.open(file('mail.sqlite'), { bodyDir: file('mailcache') });

  // ---------- AI keys: encrypted with safeStorage (key held in the macOS Keychain). Never written in plain text on a Mac. ----------
  const keyFile = 'aikeys.json';
  const keys = () => readJson(keyFile, {}) || {};
  const getKey = p => { const k = keys()[p]; if (!k) return ''; if (k.enc) { try { return safeStorage.decryptString(Buffer.from(k.enc, 'base64')); } catch (e) { return ''; } } return k.plain || ''; };
  const setKey = (p, v) => {
    const all = keys(); v = String(v || '').trim();
    if (!v) delete all[p];
    else if (safeStorage.isEncryptionAvailable()) all[p] = { enc: safeStorage.encryptString(v).toString('base64'), tail: v.slice(-4), at: Date.now() };
    else all[p] = { plain: v, tail: v.slice(-4), at: Date.now() }; // only off macOS without a keyring
    writeJson(keyFile, all); ai.cache.clear(); ai.gone.clear(); ai.cool.clear();
  };
  const keyStatus = () => { const all = keys(); const out = {}; for (const p of Object.keys(PROVIDER_NAMES)) out[p] = all[p] ? { saved: true, tail: all[p].tail, encrypted: !!all[p].enc } : { saved: false }; return out; };
  const ai = new AI({ getKey, getConfig: () => ({ provider: setting('aiProvider', 'gemini'), models: (setting('aiModels', {}) || {})[setting('aiProvider', 'gemini')] }) });

  // ---------- style profile, stored locally in style.json ----------
  const style = new Style({ db, mail: null, ai, save: p => { if (p) writeJson('style.json', p); else { try { fs.unlinkSync(file('style.json')); } catch (e) {} } send('style:profile', p); }, load: () => readJson('style.json', null), onProgress: p => send('style:progress', p) });

  const mail = new Mail({ db, getAccount: () => accountForSend(), usage, getDailyCap, prefetch: true });
  style.o.mail = mail;
  const assistant = new Assistant({ db, mail, ai, style, getSettings: settings, getAccount: () => accountForSend(), getSignature: () => setting('signature', '') });

  const badge = () => { try { const inbox = mail.special('\\Inbox') || 'INBOX'; const n = db.get('SELECT count(DISTINCT thread) n FROM messages WHERE folder=? AND seen=0', [inbox]).n; if (app.setBadgeCount) app.setBadgeCount(setting('dockBadge', true) ? n : 0); } catch (e) {} };
  let changedT = null;
  mail.on('status', s => send('mail:status', s));
  mail.on('folders', () => send('mail:folders', null));
  mail.on('changed', c => { clearTimeout(changedT); changedT = setTimeout(() => { send('mail:changed', c); badge(); }, 120); });
  mail.on('newmail', list => {
    send('mail:new', list); badge();
    const w = getWin();
    if (setting('notifyMail', true) && (!w || !w.isFocused())) {
      const pick = list.filter(m => !m.bulk).slice(0, 3);
      for (const m of pick) {
        try { if (!Notification.isSupported()) break; const n = new Notification({ title: m.fromName || m.fromAddr, subtitle: m.subject, body: m.snippet || '', silent: false }); n.on('click', () => { showWindow(); send('mail:open', { thread: m.thread, folder: m.folder, id: m.id }); }); n.show(); } catch (e) {}
      }
    }
    assistant.onNewMail(list);
  });
  assistant.on('changed', s => send('assist:changed', s));
  assistant.on('log', () => send('assist:log', null));
  assistant.on('scheduled', s => { try { if (Notification.isSupported()) { const n = new Notification({ title: 'Automatic reply waiting', body: `To ${s.fromName || s.fromAddr}: sends at ${new Date(s.sendAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} unless you stop it.` }); n.on('click', () => { showWindow(); send('menu', { tab: 'assist' }); }); n.show(); } } catch (e) {} });
  assistant.on('autosent', s => send('assist:changed', s));

  const wipeIfOtherAccount = () => {
    const a = accountForSend() || {}; const who = String(a.user || '').toLowerCase(); const was = db.kvGet('mailUser', null);
    if (who && was && was !== who) {
      db.tx(() => { for (const t of ['messages', 'folders', 'suggestions', 'sent_index', 'autolog']) db.run('DELETE FROM ' + t); db.run("DELETE FROM kv WHERE k LIKE 'style.%' OR k='ai.drafts'"); });
      try { fs.rmSync(file('mailcache'), { recursive: true, force: true }); } catch (e) {}
      try { fs.unlinkSync(file('style.json')); } catch (e) {}
    }
    if (who) db.kvSet('mailUser', who);
  };
  const mailReady = () => { const a = accountForSend(); return !!(a && a.user && a.pass && setting('mailEnabled', true)); };
  const startMail = () => { if (mailReady()) { wipeIfOtherAccount(); mail._stopped = false; mail.start().catch(() => {}); } };
  startMail();
  assistant.start();

  const wrap = fn => async (e, ...a) => { try { return { ok: true, value: await fn(...a) } } catch (er) { return { ok: false, error: er.friendly || er.message } } };
  const h = (ch, fn) => ipcMain.handle(ch, wrap(fn));

  // ---------- mail ----------
  h('mail:status', () => ({ ...mail.status(), ready: mailReady(), lastSync: db.kvGet('lastSync', null) }));
  h('mail:restart', async () => { await mail.stop().catch(() => {}); mail._stopped = false; mail.ops = null; mail.idle = null; startMail(); return true; });
  h('mail:folders', () => mail.folders());
  h('mail:threads', (folder, o) => mail.threads(folder, o || {}));
  h('mail:thread', key => mail.thread(key));
  h('mail:body', (folder, uid) => mail.body(folder, uid));
  h('mail:sync', folder => mail.syncFolder(folder));
  h('mail:more', folder => mail.syncFolder(folder, { older: true }));
  h('mail:action', a => mail.action(a));
  h('mail:search', q => mail.search(q));
  h('mail:contacts', q => mail.contacts(q));
  h('mail:select', folder => { mail.current = folder; return true; });
  h('mail:attachment', async (folder, uid, index, how) => {
    const a = await mail.attachment(folder, uid, index);
    const safe = String(a.filename).replace(/[\/\\:\0]/g, '_').slice(0, 180) || 'attachment';
    if (how === 'save') {
      const r = await dialog.showSaveDialog(getWin(), { defaultPath: path.join(app.getPath('downloads'), safe) });
      if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, a.content); shell.showItemInFolder(r.filePath); return r.filePath;
    }
    const dir = path.join(app.getPath('temp'), 'letterhead-open', String(Date.now())); fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, safe); fs.writeFileSync(p, a.content);
    const err = await shell.openPath(p); if (err) throw new Error(err); return p;
  });
  const withForward = async d => {
    if (d.forward && d.forward.uid) {
      const extra = [];
      for (const i of d.forward.indexes || []) { const a = await mail.attachment(d.forward.folder, d.forward.uid, i); extra.push({ filename: a.filename, contentType: a.contentType, content: a.content.toString('base64') }); }
      d = { ...d, attachments: [...(d.attachments || []), ...extra] };
    }
    return d;
  };
  h('mail:send', async d => {
    const r = await mail.send(await withForward(d));
    if (d.suggestionKey) assistant.markSent(d.suggestionKey);
    return r;
  });
  h('mail:saveDraft', async d => mail.saveDraft(await withForward(d)));
  h('mail:deleteDraft', d => mail.deleteDraft(d));
  h('mail:openLink', url => { if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url); return true; });

  // ---------- AI ----------
  h('ai:status', () => ({ provider: setting('aiProvider', 'gemini'), keys: keyStatus(), names: PROVIDER_NAMES, models: Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, v.models])), stats: ai.stats, encryption: safeStorage.isEncryptionAvailable() }));
  h('ai:setKey', (p, k) => { if (!PROVIDER_NAMES[p]) throw new Error('Unknown provider'); setKey(p, k); return keyStatus(); });
  h('ai:test', async () => { const r = await ai.test(); return { text: r.text, model: r.model }; });

  // ---------- style ----------
  h('style:index', async limit => { const n = Math.max(100, Math.min(3000, Number(limit) || 1000)); saveSettings({ indexWindow: n }); style.index({ limit: n }).catch(() => {}); return true; });
  h('style:progress', () => style.progress);
  h('style:profile', () => { const p = readJson('style.json', null); return p ? { ...p, statsText: p.stats ? statsText(p.stats) : '', count: style.count() } : { count: style.count() }; });
  h('style:saveProfile', patch => { const p = { ...(readJson('style.json', {}) || {}), ...patch }; writeJson('style.json', p); return p; });
  h('style:clear', () => { style.clear(); return true; });

  // ---------- assistant ----------
  h('assist:draft', async (id, o = {}) => {
    const sid = o.stream || null;
    return assistant.draft(id, { variant: o.variant, instruction: o.instruction, interactive: true, onDelta: sid ? t => send('assist:delta', { id, sid, t }) : null });
  });
  h('assist:list', () => assistant.list());
  h('assist:candidates', () => assistant.candidates());
  h('assist:suggestion', id => assistant.suggestionFor(id));
  h('assist:setDraft', (k, t) => assistant.setDraft(k, t));
  h('assist:dismiss', k => assistant.dismiss(k));
  h('assist:hold', k => assistant.hold(k));
  h('assist:sendNow', async k => {
    const s = db.get('SELECT * FROM suggestions WHERE k=?', [k]); if (!s) throw new Error('Suggestion not found');
    const r = db.get('SELECT * FROM messages WHERE (msgid=? AND msgid IS NOT NULL) OR (folder=? AND uid=?) LIMIT 1', [s.msgid, s.folder, s.uid]); if (!r) throw new Error('That email is gone.');
    await assistant.sendReply(r, s.draft, { auto: false }); return assistant.markSent(k);
  });
  h('assist:autolog', () => assistant.autolog());
  h('assist:queueBacklog', ids => { assistant.onNewMail((ids || []).map(id => ({ id }))); return true; });

  return {
    mail, ai, style, assistant, db, badge,
    onSettings: s => { if ('mailEnabled' in s) { if (s.mailEnabled) startMail(); else mail.stop().catch(() => {}); } if ('dockBadge' in s) badge(); },
    onAccount: async () => { await mail.stop().catch(() => {}); mail._stopped = false; mail.ops = null; mail.idle = null; startMail(); send('mail:status', mail.status()); },
    shutdown: async () => { assistant.stop(); try { await mail.stop(); } catch (e) {} db.flush(); },
  };
};
