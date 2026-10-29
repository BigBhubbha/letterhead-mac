'use strict';
// Letterhead Mail: an IMAP + SMTP client over the account already set up for sending.
// One connection does sync and actions, a second sits in IDLE on the Inbox so new mail shows up live.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const MailComposer = require('nodemailer/lib/mail-composer');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const engine = require('./engine');
const { imapOptions, friendlyImapError } = require('./drafts');

const HDRS = ['list-id', 'list-unsubscribe', 'precedence', 'auto-submitted', 'references', 'in-reply-to', 'x-auto-response-suppress', 'reply-to', 'x-autoreply', 'x-autorespond'];
const PAGE = 120;
const NOREPLY = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|updates|digest|marketing|automated|auto-?confirm|system)([._+-]|@)/i;

const SPECIAL_ORDER = { '\\Inbox': 0, '\\Flagged': 1, '\\Important': 2, '\\Sent': 3, '\\Drafts': 4, '\\All': 5, '\\Archive': 5, '\\Junk': 6, '\\Trash': 7 };
const NAME_GUESS = [['\\Sent', /^(sent|sent mail|sent items|sent messages)$/i], ['\\Drafts', /^drafts?$/i], ['\\Trash', /^(trash|deleted|deleted items|bin)$/i], ['\\Junk', /^(spam|junk|junk e-?mail|bulk mail)$/i], ['\\Archive', /^archives?$/i]];

const addrs = list => (list || []).filter(a => a && a.address).map(a => ({ name: a.name || '', address: String(a.address).toLowerCase() }));
const cleanId = s => String(s || '').trim().replace(/^<|>$/g, '');
const idList = s => String(s || '').match(/<[^>]+>/g)?.map(cleanId) || (s ? String(s).split(/\s+/).map(cleanId).filter(Boolean) : []);
const headerText = (buf) => String(buf || '');
function parseHeaderBlock(buf) {
  const out = {}; const text = headerText(buf).replace(/\r?\n[ \t]+/g, ' ');
  for (const line of text.split(/\r?\n/)) { const m = /^([^:]+):\s*(.*)$/.exec(line); if (m) out[m[1].toLowerCase()] = m[2].trim(); }
  return out;
}
/** Why a message is bulk or automated (and must never get an automatic reply), or '' if it looks personal. */
function bulkReason(h, fromAddr, selfAddrs = []) {
  const from = String(fromAddr || '').toLowerCase();
  if (!from) return 'no sender';
  if (selfAddrs.includes(from)) return 'from you';
  if (NOREPLY.test(from.split('@')[0] + '@')) return 'no-reply or automated sender';
  if (h['list-id']) return 'mailing list';
  if (h['list-unsubscribe']) return 'bulk mail (has an unsubscribe link)';
  if (/^(bulk|list|junk|auto_reply)$/i.test(h.precedence || '')) return 'bulk precedence';
  if (h['auto-submitted'] && !/^no$/i.test(h['auto-submitted'])) return 'automatic message';
  if (h['x-auto-response-suppress'] || h['x-autoreply'] || h['x-autorespond']) return 'automatic message';
  return '';
}
function textPartOf(struct) {
  let plain = null, html = null;
  (function walk(n) {
    if (!n) return;
    if (n.childNodes) return n.childNodes.forEach(walk);
    if (n.disposition === 'attachment') return;
    if (!plain && n.type === 'text/plain') plain = n;
    else if (!html && n.type === 'text/html') html = n;
  })(struct);
  return plain || html;
}
function hasAttachment(struct) {
  let found = false;
  (function walk(n) { if (!n || found) return; if (n.childNodes) return n.childNodes.forEach(walk); if (n.disposition === 'attachment' || (n.disposition !== 'inline' && /^(application|audio|video)\//.test(n.type || ''))) found = true; })(struct);
  return found;
}
function htmlToText(html) {
  return String(html || '').replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}
const snippetFrom = t => String(t || '').replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 220);
function firstName(name, addr) { const w = String(name || '').replace(/["']/g, '').trim().split(/\s+/).filter(Boolean); const t = w.find(x => !/^(dr|mr|mrs|ms|mx|prof|professor|sir)\.?$/i.test(x)) || w[0]; return t || String(addr || '').split('@')[0]; }
function normSubject(s) { return String(s || '').replace(/^\s*((re|fwd?|aw|wg|sv|fw)\s*(\[\d+\])?\s*:\s*)+/i, '').trim(); }

class Mail extends EventEmitter {
  /**
   * o: { db, getAccount, usage, imapFactory?, transportFactory?, notify? }
   */
  constructor(o) {
    super();
    this.o = o; this.db = o.db;
    this.ops = null; this.idle = null; this.gmail = false; this.state = 'idle'; this.error = null;
    this.startedAt = Date.now(); this._connecting = null; this._syncing = new Map(); this._timer = null; this._stopped = false;
  }
  account() { return this.o.getAccount(); }
  self() { const a = this.account() || {}; return [a.fromEmail, a.email, a.user, a.alias].filter(Boolean).map(s => String(s).toLowerCase()); }
  setState(state, error) { this.state = state; this.error = error || null; this.emit('status', this.status()); }
  status() { return { state: this.state, error: this.error, gmail: this.gmail, idle: !!(this.idle && this.idle.usable), account: (this.account() || {}).user || null }; }
  client(opts = {}) { const acct = this.account(); const o = { ...imapOptions(acct), ...opts }; const c = this.o.imapFactory ? this.o.imapFactory(o) : new ImapFlow(o); c.on('error', () => {}); return c; }

  // ---------- connection ----------
  async connect() {
    if (this.ops && this.ops.usable) return this.ops;
    if (this._connecting) return this._connecting;
    const acct = this.account();
    if (!acct || !acct.imapHost || !acct.pass) { this.setState('nosetup'); throw new Error('Connect your account and its IMAP server on the Account tab first.'); }
    this.setState('connecting');
    this._connecting = (async () => {
      const c = this.client();
      try { await c.connect(); }
      catch (e) { this.setState('offline', friendlyImapError(e)); throw e; }
      finally { this._connecting = null; }
      c.on('close', () => { if (this.ops === c) { this.ops = null; if (!this._stopped) this.setState('offline', 'Connection closed. Reconnecting…'); } });
      this.ops = c; this.gmail = c.capabilities.has('X-GM-EXT-1');
      await this.refreshFolders();
      this.setState('online');
      return c;
    })();
    return this._connecting;
  }
  async start() {
    this._stopped = false;
    try { await this.connect(); } catch (e) { this._retry(); return; }
    this.syncFolder(this.special('\\Inbox')).catch(() => {});
    setTimeout(() => { for (const s of ['\\Sent', '\\Drafts', '\\Flagged', '\\All']) { const p = this.special(s); if (p) this.syncFolder(p).catch(() => {}); } }, 1500);
    this.startIdle();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.periodic(), this.o.pollMs || 3 * 60 * 1000);
  }
  _retry() { clearTimeout(this._rt); if (!this._stopped) this._rt = setTimeout(() => this.start(), this._backoff = Math.min(120000, (this._backoff || 4000) * 2)); }
  async periodic() {
    try { await this.connect(); } catch (e) { return; }
    this._backoff = 0;
    const paths = new Set([this.special('\\Inbox'), this.current].filter(Boolean));
    for (const p of paths) await this.syncFolder(p).catch(() => {});
    if (!this.idle || !this.idle.usable) this.startIdle();
  }
  async startIdle() {
    if (this._stopped || (this.idle && this.idle.usable)) return;
    try {
      const c = this.client({ disableAutoIdle: false, autoIdleDelay: 1000, maxIdleTime: 4 * 60 * 1000, socketTimeout: 0 });
      await c.connect(); await c.mailboxOpen('INBOX', { readOnly: true });
      this.idle = c;
      let t = null;
      const kick = () => { clearTimeout(t); t = setTimeout(() => this.syncFolder(this.special('\\Inbox') || 'INBOX').catch(() => {}), 300); };
      c.on('exists', kick); c.on('expunge', kick); c.on('flags', kick);
      c.on('close', () => { if (this.idle === c) this.idle = null; if (!this._stopped) setTimeout(() => this.startIdle(), 15000); });
      c.idle().catch(() => {});
      this.emit('idle', true); this.emit('status', this.status());
    } catch (e) { setTimeout(() => this.startIdle(), 30000); }
  }
  async stop() {
    this._stopped = true; clearInterval(this._timer); clearTimeout(this._rt);
    for (const c of [this.idle, this.ops]) if (c) { try { await c.logout(); } catch (e) { try { c.close(); } catch (e2) {} } }
    this.idle = this.ops = null; this.db.flush();
  }
  async withBox(folder, fn) {
    const c = await this.connect();
    const lock = await c.getMailboxLock(folder);
    try { return await fn(c, c.mailbox); } finally { lock.release(); }
  }

  // ---------- folders ----------
  async refreshFolders() {
    const list = await this.ops.list();
    const rows = [];
    for (const m of list) {
      if (m.flags && m.flags.has('\\Noselect')) continue;
      let special = m.specialUse || (m.path.toUpperCase() === 'INBOX' ? '\\Inbox' : '');
      if (!special) { const g = NAME_GUESS.find(([, re]) => re.test(m.name)); if (g && !list.some(x => x.specialUse === g[0])) special = g[0]; }
      const isLabel = !special && !/^\[(gmail|google mail)\]/i.test(m.path) ? 1 : 0;
      rows.push({ path: m.path, name: m.path.toUpperCase() === 'INBOX' ? 'Inbox' : m.name, delim: m.delimiter, special, isLabel, sort: special in SPECIAL_ORDER ? SPECIAL_ORDER[special] : 20 });
    }
    this.db.tx(() => {
      const keep = new Set(rows.map(r => r.path));
      for (const f of this.db.all('SELECT path FROM folders')) if (!keep.has(f.path)) { this.db.run('DELETE FROM messages WHERE folder=?', [f.path]); this.db.run('DELETE FROM folders WHERE path=?', [f.path]); }
      for (const r of rows) this.db.run(`INSERT INTO folders(path,name,delim,special,isLabel,sort) VALUES(?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name, delim=excluded.delim, special=excluded.special, isLabel=excluded.isLabel, sort=excluded.sort`, [r.path, r.name, r.delim, r.special, r.isLabel, r.sort]);
    });
    this.emit('folders');
    return this.folders();
  }
  folders() {
    const f = this.db.all('SELECT path,name,special,isLabel,total,unread,synced,sort FROM folders ORDER BY sort, name COLLATE NOCASE');
    for (const x of f) { const u = this.db.get('SELECT count(*) n FROM messages WHERE folder=? AND seen=0', [x.path]); x.unreadCached = u ? u.n : 0; }
    return f;
  }
  special(use) { const r = this.db.get('SELECT path FROM folders WHERE special=? ORDER BY length(path) LIMIT 1', [use]); return r ? r.path : (use === '\\Inbox' ? 'INBOX' : null); }
  folderInfo(p) { return this.db.get('SELECT * FROM folders WHERE path=?', [p]); }
  async ensureFolder(use, name) {
    let p = this.special(use); if (p) return p;
    const c = await this.connect();
    try { await c.mailboxCreate(name); } catch (e) { if (!/exist/i.test(e.message + (e.responseText || ''))) throw e; }
    await this.refreshFolders();
    this.db.run('UPDATE folders SET special=? WHERE path=?', [use, name]);
    return name;
  }

  // ---------- sync ----------
  threadKey(env, gmThread, refs, inReplyTo, msgid) {
    if (gmThread) return 'g' + gmThread;
    const ids = [...refs, ...(inReplyTo ? [inReplyTo] : [])];
    if (ids.length) {
      const q = this.db.get(`SELECT thread FROM messages WHERE msgid IN (${ids.map(() => '?').join(',')}) AND thread IS NOT NULL LIMIT 1`, ids);
      if (q) return q.thread;
      return 'm' + ids[0];
    }
    const subj = normSubject(env.subject).toLowerCase();
    return 'm' + (msgid || crypto.createHash('sha1').update(subj + (env.date || '')).digest('hex'));
  }
  rowFrom(folder, m) {
    const env = m.envelope || {};
    const h = parseHeaderBlock(m.headers);
    const from = addrs(env.from)[0] || { name: '', address: '' };
    const msgid = cleanId(env.messageId);
    const refs = idList(h.references), irt = cleanId(env.inReplyTo || h['in-reply-to']);
    const flags = m.flags || new Set();
    return {
      folder, uid: m.uid, msgid, gmid: m.emailId || null, thread: this.threadKey(env, m.threadId, refs, irt, msgid),
      subject: env.subject || '', fromName: from.name, fromAddr: from.address, toJson: JSON.stringify(addrs(env.to)), ccJson: JSON.stringify(addrs(env.cc)),
      replyTo: (addrs(env.replyTo)[0] || {}).address || '', date: (env.date || m.internalDate) ? +new Date(env.date || m.internalDate) : Date.now(),
      seen: flags.has('\\Seen') ? 1 : 0, flagged: flags.has('\\Flagged') ? 1 : 0, answered: flags.has('\\Answered') ? 1 : 0, draft: flags.has('\\Draft') ? 1 : 0,
      labels: JSON.stringify(m.labels ? [...m.labels] : []), hasAtt: hasAttachment(m.bodyStructure) ? 1 : 0, size: m.size || 0, inReplyTo: irt, refs: JSON.stringify(refs),
      bulk: bulkReason(h, from.address, this.self()), _part: textPartOf(m.bodyStructure),
    };
  }
  upsert(r) {
    const prev = this.db.get('SELECT id, snippet, body FROM messages WHERE folder=? AND uid=?', [r.folder, r.uid]);
    if (prev) { this.db.run('UPDATE messages SET seen=?, flagged=?, answered=?, draft=?, labels=? WHERE id=?', [r.seen, r.flagged, r.answered, r.draft, r.labels, prev.id]); return null; }
    const twin = r.msgid ? this.db.get("SELECT snippet FROM messages WHERE msgid=? AND snippet<>'' LIMIT 1", [r.msgid]) : null;
    this.db.run(`INSERT INTO messages(folder,uid,msgid,gmid,thread,subject,fromName,fromAddr,toJson,ccJson,replyTo,date,seen,flagged,answered,draft,labels,hasAtt,snippet,size,inReplyTo,refs,bulk)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [r.folder, r.uid, r.msgid, r.gmid, r.thread, r.subject, r.fromName, r.fromAddr, r.toJson, r.ccJson, r.replyTo, r.date, r.seen, r.flagged, r.answered, r.draft, r.labels, r.hasAtt, twin ? twin.snippet : '', r.size, r.inReplyTo, r.refs, r.bulk]);
    return this.db.get('SELECT * FROM messages WHERE folder=? AND uid=?', [r.folder, r.uid]);
  }
  fetchQuery() { return { uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true, size: true, headers: HDRS, threadId: this.gmail, labels: this.gmail, emailId: this.gmail }; }

  /** Pull new mail and flag changes for one folder. older: also fetch the page before the oldest cached message. */
  async syncFolder(folder, { older = false } = {}) {
    if (!folder) return { added: [] };
    const key = folder + (older ? ':older' : '');
    if (this._syncing.has(key)) return this._syncing.get(key);
    const p = this._sync(folder, older).finally(() => this._syncing.delete(key));
    this._syncing.set(key, p); return p;
  }
  async _sync(folder, older) {
    const added = [], parts = [];
    const res = await this.withBox(folder, async (c, box) => {
      const info = this.folderInfo(folder) || {};
      const uv = Number(box.uidValidity);
      if (info.uidvalidity && info.uidvalidity !== uv) { this.db.run('DELETE FROM messages WHERE folder=?', [folder]); }
      const span = this.db.get('SELECT min(uid) lo, max(uid) hi, count(*) n FROM messages WHERE folder=?', [folder]);
      const q = this.fetchQuery();
      const take = async (range, opts) => { for await (const m of c.fetch(range, q, opts)) { const r = this.rowFrom(folder, m); const ins = this.upsert(r); if (ins) { added.push(ins); if (r._part) parts.push([ins, r._part]); } } };
      if (!span.n) { if (box.exists) await take(`${Math.max(1, box.exists - PAGE + 1)}:*`); }
      else {
        // flags and deletions for what is cached
        const seenUids = new Set();
        for await (const m of c.fetch(`${span.lo}:${span.hi}`, { uid: true, flags: true, labels: this.gmail }, { uid: true })) {
          seenUids.add(m.uid);
          const f = m.flags || new Set();
          this.db.run('UPDATE messages SET seen=?, flagged=?, answered=?, draft=?, labels=? WHERE folder=? AND uid=?', [f.has('\\Seen') ? 1 : 0, f.has('\\Flagged') ? 1 : 0, f.has('\\Answered') ? 1 : 0, f.has('\\Draft') ? 1 : 0, JSON.stringify(m.labels ? [...m.labels] : []), folder, m.uid]);
        }
        for (const r of this.db.all('SELECT uid FROM messages WHERE folder=?', [folder])) if (!seenUids.has(r.uid)) { this.db.run('DELETE FROM messages WHERE folder=? AND uid=?', [folder, r.uid]); this.db.dropBody(folder, r.uid); }
        if (box.uidNext > span.hi + 1) await take(`${span.hi + 1}:*`, { uid: true });
        if (older && span.lo > 1) {
          const uids = (await c.search({ uid: `1:${span.lo - 1}` }, { uid: true })) || [];
          const page = uids.slice(-PAGE);
          if (page.length) await take(page.join(','), { uid: true });
          if (uids.length <= PAGE) this.db.run('UPDATE folders SET complete=1 WHERE path=?', [folder]);
        }
      }
      // previews for new messages
      for (const [row, part] of parts.slice(-80)) {
        try {
          const d = await c.download(String(row.uid), part.part || '1', { uid: true, maxBytes: 6000 });
          const chunks = []; for await (const ch of d.content) chunks.push(ch);
          let t = Buffer.concat(chunks).toString('utf8'); if (part.type === 'text/html') t = htmlToText(t);
          this.db.run('UPDATE messages SET snippet=? WHERE id=?', [snippetFrom(t), row.id]);
        } catch (e) {}
      }
      const st = this.db.get('SELECT count(*) n FROM messages WHERE folder=?', [folder]);
      const ur = this.db.get('SELECT count(*) n FROM messages WHERE folder=? AND seen=0', [folder]);
      this.db.run('UPDATE folders SET uidvalidity=?, uidnext=?, total=?, unread=?, synced=?, complete=coalesce(complete, ?) WHERE path=?', [uv, Number(box.uidNext), box.exists, ur.n, Date.now(), box.exists <= st.n ? 1 : 0, folder]);
      return { added };
    });
    this.emit('changed', { folder, added: added.length });
    const inbox = this.special('\\Inbox') || 'INBOX';
    if (folder === inbox) {
      const fresh = added.filter(r => !r.seen && r.date > this.startedAt - 10 * 60 * 1000 && !this.self().includes(r.fromAddr));
      if (fresh.length && this._inboxPrimed) this.emit('newmail', fresh.map(r => this.listRow(r)));
      this._inboxPrimed = true;
      if (this.o.prefetch !== false) this.prefetch(inbox).catch(() => {});
    }
    return res;
  }
  async prefetch(folder, n = 40) {
    const rows = this.db.all('SELECT folder, uid, size FROM messages WHERE folder=? AND body=0 AND size<3000000 ORDER BY date DESC LIMIT ?', [folder, n]);
    for (const r of rows) { if (this._stopped) return; try { await this.body(r.folder, r.uid, { quiet: true }); } catch (e) {} }
  }

  // ---------- reading ----------
  listRow(r) {
    return { id: r.id, folder: r.folder, uid: r.uid, thread: r.thread, msgid: r.msgid, subject: r.subject, fromName: r.fromName, fromAddr: r.fromAddr, to: JSON.parse(r.toJson || '[]'), cc: JSON.parse(r.ccJson || '[]'),
      date: r.date, seen: !!r.seen, flagged: !!r.flagged, answered: !!r.answered, draft: !!r.draft, labels: JSON.parse(r.labels || '[]'), hasAtt: !!r.hasAtt, snippet: r.snippet || '', bulk: r.bulk || '', replyTo: r.replyTo || '', inReplyTo: r.inReplyTo, refs: JSON.parse(r.refs || '[]') };
  }
  /** Conversations in a folder, newest first. */
  threads(folder, { offset = 0, limit = 60, unreadOnly = false } = {}) {
    let where = 'folder=?', params = [folder];
    if (folder === '__starred') { const sp = this.special('\\Flagged'); if (sp) { where = 'folder=?'; params = [sp]; } else { where = 'flagged=1'; params = []; } }
    if (unreadOnly) where += ' AND seen=0';
    const groups = this.db.all(`SELECT thread, max(date) last, count(*) n, sum(seen=0) unread, max(flagged) flagged, max(hasAtt) att FROM messages WHERE ${where} GROUP BY thread ORDER BY last DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = this.db.get(`SELECT count(DISTINCT thread) n FROM messages WHERE ${where}`, params).n;
    const self = this.self();
    const items = groups.map(g => {
      const latest = this.db.get(`SELECT * FROM messages WHERE thread=? AND ${where} ORDER BY date DESC LIMIT 1`, [g.thread, ...params]);
      const all = this.db.all('SELECT fromName, fromAddr, seen, folder FROM messages WHERE thread=? ORDER BY date', [g.thread]);
      const seenNames = []; for (const m of all) { const nm = self.includes(m.fromAddr) ? 'me' : firstName(m.fromName, m.fromAddr); if (!seenNames.includes(nm)) seenNames.push(nm); }
      const count = new Set(this.db.all('SELECT coalesce(msgid, folder||uid) k FROM messages WHERE thread=?', [g.thread]).map(x => x.k)).size;
      const sug = this.db.get('SELECT status FROM suggestions WHERE thread=? ORDER BY updatedAt DESC LIMIT 1', [g.thread]);
      return { ...this.listRow(latest), thread: g.thread, count, unread: g.unread, flagged: !!g.flagged, hasAtt: !!g.att, last: g.last, people: seenNames.slice(-3), suggestion: sug ? sug.status : null };
    });
    return { items, total, offset, complete: !!(this.folderInfo(folder) || {}).complete };
  }
  /** Every message in a conversation, across folders, oldest first. */
  async thread(threadKey, { fetchGmail = true } = {}) {
    if (fetchGmail && this.gmail && threadKey.startsWith('g')) await this.fillGmailThread(threadKey.slice(1)).catch(() => {});
    const rows = this.db.all('SELECT * FROM messages WHERE thread=? ORDER BY date', [threadKey]);
    const trash = this.special('\\Trash'), spam = this.special('\\Junk'), all = this.special('\\All');
    const byId = new Map();
    for (const r of rows) {
      const k = r.msgid || r.folder + ':' + r.uid, cur = byId.get(k);
      const rank = x => (x.folder === all ? 1 : 0) + (x.folder === trash || x.folder === spam ? 2 : 0);
      if (!cur || rank(r) < rank(cur)) byId.set(k, r);
    }
    return [...byId.values()].sort((a, b) => a.date - b.date).map(r => ({ ...this.listRow(r), cached: !!r.body }));
  }
  async fillGmailThread(thrid) {
    const all = this.special('\\All'); if (!all) return;
    await this.withBox(all, async c => {
      const uids = await c.search({ threadId: thrid }, { uid: true });
      const have = new Set(this.db.all('SELECT uid FROM messages WHERE folder=?', [all]).map(r => r.uid));
      const need = (uids || []).filter(u => !have.has(u));
      if (need.length) for await (const m of c.fetch(need.join(','), this.fetchQuery(), { uid: true })) this.upsert(this.rowFrom(all, m));
    });
  }
  async body(folder, uid, { quiet } = {}) {
    const cached = this.db.readBody(folder, uid);
    if (cached) return cached;
    const src = await this.withBox(folder, async c => { const m = await c.fetchOne(String(uid), { source: true }, { uid: true }); return m && m.source; });
    if (!src) throw new Error('This message is no longer on the server.');
    const p = await simpleParser(src);
    let inlineBytes = 0;
    const atts = (p.attachments || []).map((a, i) => {
      const inline = !!(a.contentId && (a.related || a.contentDisposition === 'inline') && /^image\//.test(a.contentType));
      let dataUrl = null;
      if (inline && a.size < 1500000 && (inlineBytes += a.size) < 6000000) dataUrl = `data:${a.contentType};base64,${a.content.toString('base64')}`;
      return { index: i, filename: a.filename || (inline ? 'image' : 'attachment'), contentType: a.contentType, size: a.size, cid: a.contentId ? cleanId(a.contentId) : null, inline, dataUrl };
    });
    const h = k => { const v = p.headers.get(k); return v == null ? '' : typeof v === 'string' ? v : (v.text || v.value || JSON.stringify(v)); };
    const body = {
      html: p.html || null, text: p.text || (p.html ? htmlToText(p.html) : ''), attachments: atts,
      headers: { messageId: cleanId(p.messageId), references: [].concat(p.references || []).map(cleanId), inReplyTo: cleanId(p.inReplyTo), listId: h('list-id'), listUnsubscribe: h('list-unsubscribe'), replyTo: p.replyTo ? addrs(p.replyTo.value)[0] : null, date: p.date ? +p.date : null },
    };
    this.db.writeBody(folder, uid, body);
    this.db.run('UPDATE messages SET body=1, snippet=CASE WHEN snippet IS NULL OR snippet=\'\' THEN ? ELSE snippet END WHERE folder=? AND uid=?', [snippetFrom(body.text), folder, uid]);
    return body;
  }
  async attachment(folder, uid, index) {
    const src = await this.withBox(folder, async c => { const m = await c.fetchOne(String(uid), { source: true }, { uid: true }); return m && m.source; });
    if (!src) throw new Error('This message is no longer on the server.');
    const p = await simpleParser(src); const a = (p.attachments || [])[index];
    if (!a) throw new Error('Attachment not found.');
    return { filename: a.filename || 'attachment', contentType: a.contentType, content: a.content };
  }

  // ---------- actions ----------
  /** ids: message row ids. Groups them by folder for the IMAP calls, updates the cache right away. */
  rowsFor(ids) { return ids.length ? this.db.all(`SELECT * FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : []; }
  threadRows(thread, folder) { return folder ? this.db.all('SELECT * FROM messages WHERE thread=? AND folder=?', [thread, folder]) : this.db.all('SELECT * FROM messages WHERE thread=?', [thread]); }
  groupByFolder(rows) { const g = new Map(); for (const r of rows) { if (!g.has(r.folder)) g.set(r.folder, []); g.get(r.folder).push(r); } return g; }
  async flag(rows, flag, on) {
    const col = { '\\Seen': 'seen', '\\Flagged': 'flagged', '\\Answered': 'answered' }[flag];
    for (const r of rows) this.db.run(`UPDATE messages SET ${col}=? WHERE id=?`, [on ? 1 : 0, r.id]);
    if (flag === '\\Flagged' && this.gmail) { const st = this.special('\\Flagged'); if (st && on === false) this.db.run('DELETE FROM messages WHERE folder=? AND msgid IN (' + rows.map(() => '?').join(',') + ')', [st, ...rows.map(r => r.msgid)]); }
    this.emit('changed', { local: true });
    for (const [folder, rs] of this.groupByFolder(rows)) {
      await this.withBox(folder, c => on ? c.messageFlagsAdd(rs.map(r => r.uid).join(','), [flag], { uid: true }) : c.messageFlagsRemove(rs.map(r => r.uid).join(','), [flag], { uid: true }));
    }
    if (flag === '\\Flagged') { const st = this.special('\\Flagged'); if (st) this.syncFolder(st).catch(() => {}); }
  }
  async move(rows, dest) {
    if (!rows.length) return;
    for (const r of rows) { this.db.run('DELETE FROM messages WHERE id=?', [r.id]); this.db.dropBody(r.folder, r.uid); }
    this.emit('changed', { local: true });
    for (const [folder, rs] of this.groupByFolder(rows)) {
      if (folder === dest) continue;
      await this.withBox(folder, c => c.messageMove(rs.map(r => r.uid).join(','), dest, { uid: true }));
    }
    this.syncFolder(dest).catch(() => {});
  }
  async destroy(rows) {
    for (const r of rows) { this.db.run('DELETE FROM messages WHERE id=?', [r.id]); this.db.dropBody(r.folder, r.uid); }
    this.emit('changed', { local: true });
    for (const [folder, rs] of this.groupByFolder(rows)) await this.withBox(folder, c => c.messageDelete(rs.map(r => r.uid).join(','), { uid: true }));
  }
  async label(rows, label, on) {
    if (this.gmail) {
      for (const [folder, rs] of this.groupByFolder(rows)) await this.withBox(folder, c => on ? c.messageFlagsAdd(rs.map(r => r.uid).join(','), [label], { uid: true, useLabels: true }) : c.messageFlagsRemove(rs.map(r => r.uid).join(','), [label], { uid: true, useLabels: true }));
      for (const r of rows) { const l = new Set(JSON.parse(r.labels || '[]')); on ? l.add(label) : l.delete(label); this.db.run('UPDATE messages SET labels=? WHERE id=?', [JSON.stringify([...l]), r.id]); }
      this.syncFolder(label).catch(() => {});
    } else if (on) {
      for (const [folder, rs] of this.groupByFolder(rows)) await this.withBox(folder, c => c.messageCopy(rs.map(r => r.uid).join(','), label, { uid: true }));
      this.syncFolder(label).catch(() => {});
    }
    this.emit('changed', { local: true });
  }
  /** op: read unread star unstar archive trash delete spam notspam move label unlabel. target: {ids} or {thread, folder} */
  async action({ op, ids, thread, folder, arg }) {
    let rows = ids ? this.rowsFor(ids) : this.threadRows(thread, ['archive', 'trash', 'spam', 'notspam', 'move', 'delete'].includes(op) ? folder : null);
    if (op === 'star' && thread && !ids) { rows = this.threadRows(thread, null).sort((a, b) => b.date - a.date).slice(0, 1); }
    if (!rows.length) return { ok: true, n: 0 };
    const inbox = this.special('\\Inbox') || 'INBOX';
    switch (op) {
      case 'read': await this.flag(rows, '\\Seen', true); break;
      case 'unread': await this.flag(rows, '\\Seen', false); break;
      case 'star': await this.flag(rows, '\\Flagged', true); break;
      case 'unstar': await this.flag(this.threadRows(rows[0].thread, null), '\\Flagged', false); break;
      case 'archive': {
        const dest = this.gmail ? this.special('\\All') : await this.ensureFolder('\\Archive', 'Archive');
        await this.move(rows.filter(r => r.folder === inbox || !this.gmail || r.folder === folder), dest); break;
      }
      case 'trash': {
        const t = this.special('\\Trash') || await this.ensureFolder('\\Trash', 'Trash');
        const already = rows.filter(r => r.folder === t), rest = rows.filter(r => r.folder !== t);
        if (rest.length) await this.move(rest, t);
        if (already.length && arg === 'forever') await this.destroy(already);
        break;
      }
      case 'delete': await this.destroy(rows); break;
      case 'spam': await this.move(rows, this.special('\\Junk') || await this.ensureFolder('\\Junk', 'Junk')); break;
      case 'notspam': await this.move(rows, inbox); break;
      case 'move': await this.move(rows, arg); break;
      case 'label': await this.label(rows, arg, true); break;
      case 'unlabel': await this.label(rows, arg, false); break;
      default: throw new Error('Unknown action ' + op);
    }
    return { ok: true, n: rows.length };
  }

  // ---------- search ----------
  async search(q, { folder } = {}) {
    q = String(q || '').trim(); if (!q) return { items: [] };
    let rows = [];
    try {
      if (this.gmail) {
        const all = this.special('\\All') || folder || 'INBOX';
        rows = await this.withBox(all, async c => {
          const uids = ((await c.search({ gmraw: q }, { uid: true })) || []).slice(-100);
          const out = [];
          if (uids.length) for await (const m of c.fetch(uids.join(','), this.fetchQuery(), { uid: true })) { const r = this.rowFrom(all, m); this.upsert(r); out.push(this.db.get('SELECT * FROM messages WHERE folder=? AND uid=?', [all, m.uid])); }
          return out;
        });
      } else {
        const f = folder || 'INBOX';
        rows = await this.withBox(f, async c => {
          const uids = ((await c.search({ or: [{ subject: q }, { from: q }, { to: q }, { body: q }] }, { uid: true })) || []).slice(-100);
          const out = [];
          if (uids.length) for await (const m of c.fetch(uids.join(','), this.fetchQuery(), { uid: true })) { this.upsert(this.rowFrom(f, m)); out.push(this.db.get('SELECT * FROM messages WHERE folder=? AND uid=?', [f, m.uid])); }
          return out;
        });
      }
    } catch (e) { this.lastSearchError = e.message; }
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const local = this.db.all('SELECT * FROM messages WHERE subject LIKE ? OR fromName LIKE ? OR fromAddr LIKE ? OR snippet LIKE ? OR toJson LIKE ? ORDER BY date DESC LIMIT 200', [like, like, like, like, like]);
    const seen = new Map();
    for (const r of [...rows, ...local].filter(Boolean)) { const cur = seen.get(r.thread); if (!cur || r.date > cur.date) seen.set(r.thread, r); }
    const items = [...seen.values()].sort((a, b) => b.date - a.date).slice(0, 100).map(r => ({ ...this.listRow(r), count: new Set(this.db.all('SELECT coalesce(msgid, folder||uid) k FROM messages WHERE thread=?', [r.thread]).map(x => x.k)).size, unread: r.seen ? 0 : 1, people: [r.fromName || r.fromAddr] }));
    return { items, server: !this.lastSearchError };
  }
  contacts(q, limit = 8) {
    const like = '%' + String(q || '').toLowerCase().replace(/[%_]/g, '') + '%';
    const rows = this.db.all(`SELECT fromName name, fromAddr address, count(*) n, max(date) d FROM messages WHERE fromAddr LIKE ? OR lower(fromName) LIKE ? GROUP BY fromAddr ORDER BY n DESC, d DESC LIMIT 40`, [like, like]);
    const sent = this.special('\\Sent');
    if (sent) for (const r of this.db.all('SELECT toJson FROM messages WHERE folder=? ORDER BY date DESC LIMIT 400', [sent])) for (const a of JSON.parse(r.toJson || '[]')) if ((a.address + ' ' + a.name).toLowerCase().includes(String(q || '').toLowerCase())) rows.push({ name: a.name, address: a.address, n: 3 });
    const out = new Map(); for (const r of rows) { if (!r.address || NOREPLY.test(r.address.split('@')[0] + '@')) continue; const c = out.get(r.address); if (!c) out.set(r.address, { name: r.name, address: r.address, n: r.n }); else { c.n += r.n; c.name = c.name || r.name; } }
    return [...out.values()].sort((a, b) => b.n - a.n).slice(0, limit);
  }

  // ---------- compose ----------
  buildMail(d, { draft } = {}) {
    const acct = this.account();
    const fromAddr = acct.fromEmail || acct.alias || acct.email || acct.user;
    const att = (d.attachments || []).map(a => a.content ? { filename: a.filename, content: Buffer.from(a.content, 'base64'), contentType: a.contentType } : { filename: a.filename || path.basename(a.path), path: a.path });
    const mail = {
      from: acct.fromName ? { name: acct.fromName, address: fromAddr } : fromAddr,
      to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject || '', html: d.html, text: d.text || htmlToText(d.html || ''),
      attachments: att, messageId: d.messageId || `<${crypto.randomUUID()}@letterhead.local>`, date: new Date(),
      headers: {}, keepBcc: true,
    };
    if (acct.replyTo) mail.replyTo = acct.replyTo;
    if (d.inReplyTo) { mail.inReplyTo = '<' + cleanId(d.inReplyTo) + '>'; mail.references = (d.references || []).map(r => '<' + cleanId(r) + '>').join(' ') || mail.inReplyTo; }
    if (d.autoSubmitted) mail.headers['Auto-Submitted'] = 'auto-replied';
    if (!draft) mail.headers['X-Mailer'] = 'Letterhead';
    return mail;
  }
  async raw(mail) { return new Promise((res, rej) => new MailComposer(mail).compile().build((e, b) => e ? rej(e) : res(b))); }
  envelopeOf(d) {
    const list = [].concat(d.to || [], d.cc || [], d.bcc || []).flatMap(x => typeof x === 'string' ? x.split(',') : [x.address || x]).map(s => String(s).replace(/.*<([^>]+)>.*/, '$1').trim()).filter(Boolean);
    return [...new Set(list.map(s => s.toLowerCase()))];
  }
  /** Send a message composed in the app. d: {to,cc,bcc,subject,html,text,attachments,inReplyTo,references,replyOf:{id},draft:{folder,uid}} */
  async send(d) {
    const acct = this.account();
    if (!acct || !acct.host || !acct.pass) throw new Error('Connect an account first.');
    const rcpts = this.envelopeOf(d);
    if (!rcpts.length) throw new Error('Add at least one recipient.');
    const bad = rcpts.filter(a => !engine.isEmail(a)); if (bad.length) throw new Error('These addresses look wrong: ' + bad.join(', '));
    const cap = this.o.getDailyCap ? this.o.getDailyCap() : 0;
    if (cap && this.o.usage && this.o.usage.count() + rcpts.length > cap) throw new Error(`Sending this would pass your daily cap of ${cap}. Raise it in Settings or wait.`);
    const mail = this.buildMail(d);
    const raw = await this.raw(mail);
    const from = (acct.fromEmail || acct.alias || acct.email || acct.user);
    const t = this.o.transportFactory ? this.o.transportFactory(acct) : engine.buildTransport(acct);
    try { await t.sendMail({ envelope: { from, to: rcpts }, raw }); }
    catch (e) { throw new Error(engine.friendlyError ? engine.friendlyError(e) : e.message); }
    finally { try { t.close(); } catch (e) {} }
    if (this.o.usage) for (let i = 0; i < rcpts.length; i++) this.o.usage.record();
    const after = [];
    try {
      await this.connect();
      if (!this.gmail) { const sent = this.special('\\Sent') || await this.ensureFolder('\\Sent', 'Sent'); await this.withBox(sent, c => c.append(sent, raw, ['\\Seen'])); }
      if (d.draft && d.draft.uid) await this.deleteDraft(d.draft);
      if (d.replyOf) { const rows = this.rowsFor([d.replyOf]); if (rows.length) await this.flag(rows, '\\Answered', true); }
      const sent = this.special('\\Sent'); if (sent) this.syncFolder(sent).catch(() => {});
    } catch (e) { after.push(e.message); }
    return { ok: true, messageId: cleanId(mail.messageId), recipients: rcpts.length, warnings: after };
  }
  async saveDraft(d) {
    const folder = this.special('\\Drafts') || await this.ensureFolder('\\Drafts', 'Drafts');
    const mail = this.buildMail({ ...d, messageId: d.messageId || `<${crypto.randomUUID()}@letterhead.local>` }, { draft: true });
    const raw = await this.raw(mail);
    const r = await this.withBox(folder, c => c.append(folder, raw, ['\\Draft', '\\Seen']));
    if (d.draft && d.draft.uid && d.draft.folder) await this.deleteDraft(d.draft).catch(() => {});
    let uid = r && r.uid;
    if (!uid) uid = await this.withBox(folder, async c => { const u = await c.search({ header: { 'message-id': cleanId(mail.messageId) } }, { uid: true }); return u && u[u.length - 1]; });
    this.syncFolder(folder).catch(() => {});
    return { folder, uid, messageId: cleanId(mail.messageId) };
  }
  async deleteDraft({ folder, uid }) {
    if (!folder || !uid) return;
    this.db.run('DELETE FROM messages WHERE folder=? AND uid=?', [folder, uid]); this.db.dropBody(folder, uid);
    await this.withBox(folder, c => c.messageDelete(String(uid), { uid: true }));
    this.emit('changed', { folder });
  }
}

module.exports = { Mail, firstName, bulkReason, htmlToText, normSubject, snippetFrom, parseHeaderBlock, NOREPLY };
