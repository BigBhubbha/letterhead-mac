'use strict';
// Drafts over IMAP: find the Drafts folder, list drafts, prepare one for sending as-is,
// and clean up afterwards (delete the draft, save a copy to Sent where the server needs it).
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');

const DRAFT_NAMES = /^(drafts|draft|brouillons|entw(u|ü)rfe|borradores|bozze|concepten|\[gmail\]\/drafts|\[google mail\]\/drafts|inbox[./]drafts)$/i;
const SENT_NAMES = /^(sent|sent mail|sent items|sent messages|\[gmail\]\/sent mail|\[google mail\]\/sent mail|inbox[./]sent)$/i;

function imapOptions(acct) {
  const sec = acct.imapSecurity || 'ssl';
  const o = {
    host: acct.imapHost, port: Number(acct.imapPort) || 993,
    secure: sec === 'ssl',
    auth: { user: acct.user, pass: acct.pass },
    logger: false, emitLogs: false,
    connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 90000,
    disableAutoIdle: true,
  };
  if (sec === 'starttls') o.doSTARTTLS = true;
  if (sec === 'none') o.doSTARTTLS = false;
  if (acct.allowInsecure) o.tls = { rejectUnauthorized: false };
  return o;
}

function isGmailHost(acct, client) {
  if (/(^|\.)gmail\.com$|googlemail\.com$/i.test(acct.imapHost || '')) return true;
  return !!(client && client.capabilities && client.capabilities.has('X-GM-EXT-1'));
}

function friendlyImapError(e) {
  const raw = String((e && (e.responseText || e.response || e.message)) || 'Unknown error').split('\n')[0].slice(0, 220);
  if (e && (e.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials|LOGIN failed|authentication failed/i.test(raw)))
    return 'The mail server rejected the login for reading drafts. Check the app password. (' + raw + ')';
  if (e && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/.test(e.code || ''))
    return 'Could not reach the IMAP server ' + (e.address || '') + '. Check the server name and port. (' + (e.code || raw) + ')';
  return raw;
}

async function withClient(acct, fn) {
  const client = new ImapFlow(imapOptions(acct));
  client.on('error', () => {}); // surfaced through the awaited calls instead
  await client.connect();
  try { return await fn(client); }
  finally { try { await client.logout(); } catch (e) { try { client.close(); } catch (e2) {} } }
}

async function findFolders(client) {
  const list = await client.list();
  const pick = (use, re) => {
    const byUse = list.find(m => m.specialUse === use || (m.flags && m.flags.has && m.flags.has(use)));
    if (byUse) return { path: byUse.path, via: 'special-use' };
    const byName = list.find(m => re.test(m.path) || re.test(m.name));
    return byName ? { path: byName.path, via: 'name' } : null;
  };
  return { drafts: pick('\\Drafts', DRAFT_NAMES), sent: pick('\\Sent', SENT_NAMES) };
}

const addrList = a => (a ? (Array.isArray(a) ? a : [a]).flatMap(x => x.value || []).filter(v => v.address).map(v => ({ name: v.name || '', address: v.address })) : []);

function snippetOf(parsed) {
  let t = parsed.text || '';
  if (!t && parsed.html) t = String(parsed.html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return t.replace(/\s+/g, ' ').trim();
}

async function summarize(uid, source, extra) {
  const p = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const to = addrList(p.to), cc = addrList(p.cc), bcc = addrList(p.bcc);
  const text = (p.text || snippetOf(p) || '').replace(/\r\n/g, '\n');
  return {
    uid, messageId: p.messageId || null, subject: p.subject || '', to, cc, bcc,
    recipients: [...to, ...cc, ...bcc].map(a => a.address),
    snippet: snippetOf(p).slice(0, 220),
    text: text.length > 20000 ? text.slice(0, 20000) + '\n...' : text,
    hasHtml: !!p.html,
    attachments: (p.attachments || []).filter(a => a.contentDisposition !== 'inline' || a.filename).map(a => ({ filename: a.filename || 'attachment', size: a.size || (a.content ? a.content.length : 0), type: a.contentType })),
    date: p.date ? p.date.getTime() : (extra && extra.internalDate ? new Date(extra.internalDate).getTime() : null),
    size: source.length,
    from: addrList(p.from)[0] || null,
  };
}

async function listDrafts(acct) {
  return withClient(acct, async client => {
    const f = await findFolders(client);
    if (!f.drafts) throw Object.assign(new Error('Could not find a Drafts folder on this account.'), { noDrafts: true });
    const gmail = isGmailHost(acct, client);
    const drafts = [];
    const lock = await client.getMailboxLock(f.drafts.path, { readOnly: true });
    try {
      if (client.mailbox.exists > 0) {
        for await (const m of client.fetch('1:*', { uid: true, source: true, internalDate: true, flags: true })) {
          try { drafts.push(await summarize(m.uid, m.source, m)); }
          catch (e) { drafts.push({ uid: m.uid, subject: '(could not read this draft)', to: [], cc: [], bcc: [], recipients: [], snippet: e.message, attachments: [], unreadable: true }); }
        }
      }
    } finally { lock.release(); }
    drafts.sort((a, b) => (b.date || 0) - (a.date || 0));
    return { folder: f.drafts.path, via: f.drafts.via, sentFolder: f.sent ? f.sent.path : null, gmail, drafts };
  });
}

// ---------- raw message preparation ----------
const DROP = new Set(['bcc', 'date', 'message-id', 'return-path', 'delivered-to', 'received', 'x-mozilla-draft-info', 'x-uniform-type-identifier', 'x-apple-auto-saved', 'x-apple-mail-remote-attachments', 'x-universally-unique-identifier', 'x-gm-thrid', 'x-gmail-labels', 'x-gm-msgid']);

function splitRaw(buf) {
  const s = buf.toString('binary');
  let i = s.indexOf('\r\n\r\n'), sepLen = 4;
  if (i < 0) { i = s.indexOf('\n\n'); sepLen = 2; }
  if (i < 0) return { head: s, body: '' , nl: '\r\n' };
  return { head: s.slice(0, i), body: s.slice(i + sepLen), nl: sepLen === 4 ? '\r\n' : '\n' };
}

function rfc2822Date(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', ao = Math.abs(off);
  return `${days[d.getDay()]}, ${d.getDate()} ${mons[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${p(Math.floor(ao / 60))}${p(ao % 60)}`;
}

function prepareRaw(source, acct, now) {
  const { head, body, nl } = splitRaw(Buffer.isBuffer(source) ? source : Buffer.from(source));
  // unfold into header blocks
  const lines = head.split(/\r?\n/), blocks = [];
  for (const l of lines) { if (/^[ \t]/.test(l) && blocks.length) blocks[blocks.length - 1] += '\r\n' + l; else if (l.length) blocks.push(l); }
  const kept = blocks.filter(b => !DROP.has(b.slice(0, b.indexOf(':')).trim().toLowerCase()));
  const hasFrom = kept.some(b => /^from\s*:/i.test(b));
  const fromAddr = acct.fromEmail || acct.user;
  const domain = String(fromAddr).split('@')[1] || 'letterhead.local';
  const extra = [`Date: ${rfc2822Date(now || new Date())}`, `Message-ID: <${crypto.randomUUID()}@${domain}>`];
  if (!hasFrom) extra.push('From: ' + (acct.fromName ? `"${String(acct.fromName).replace(/"/g, '')}" <${fromAddr}>` : fromAddr));
  const out = [...extra, ...kept].join('\r\n') + '\r\n\r\n' + (nl === '\n' ? body.replace(/\r?\n/g, '\r\n') : body);
  return Buffer.from(out, 'binary');
}

// Finds a draft by UID. Mail apps often save an edited draft as a new message with a new UID,
// so fall back to its Message-ID, then to an exact subject plus the same recipients.
async function fetchDraftSource(acct, folder, uid, hint) {
  return withClient(acct, async client => {
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
      let m = uid ? await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true }) : null;
      if ((!m || !m.source) && hint) {
        let uids = [];
        if (hint.messageId) uids = (await client.search({ header: { 'message-id': hint.messageId } }, { uid: true })) || [];
        if (!uids.length && hint.subject) {
          const cand = (await client.search({ subject: hint.subject }, { uid: true })) || [];
          for (const u of cand) {
            const c = await client.fetchOne(String(u), { uid: true, source: true }, { uid: true });
            const sum = c && c.source ? await summarize(u, c.source) : null;
            if (sum && sum.subject === hint.subject && sameSet(sum.recipients, hint.recipients || [])) uids.push(u);
          }
          if (uids.length > 1) throw Object.assign(new Error('More than one draft matches this one now. Refresh the batch from the Drafts tab.'), { gone: true });
        }
        if (uids.length) m = await client.fetchOne(String(uids[uids.length - 1]), { uid: true, source: true }, { uid: true });
      }
      if (!m || !m.source) throw Object.assign(new Error('This draft is no longer in your Drafts folder. It may have been sent or deleted.'), { gone: true });
      return { source: m.source, uid: m.uid };
    } finally { lock.release(); }
  });
}
const sameSet = (a, b) => a.length === b.length && a.map(x => x.toLowerCase()).sort().join() === b.map(x => x.toLowerCase()).sort().join();

async function afterSent(acct, { folder, uid, deleteDraft, appendSent, sentFolder, raw }) {
  const notes = [];
  if (!deleteDraft && !(appendSent && sentFolder)) return notes;
  await withClient(acct, async client => {
    if (appendSent && sentFolder) {
      try { await client.append(sentFolder, raw, ['\\Seen'], new Date()); notes.push('copy saved to ' + sentFolder); }
      catch (e) { notes.push('could not save a copy to Sent (' + friendlyImapError(e) + ')'); }
    }
    if (deleteDraft) {
      const lock = await client.getMailboxLock(folder);
      try {
        const ok = await client.messageDelete(String(uid), { uid: true });
        notes.push(ok ? 'draft removed' : 'draft was already gone');
      } catch (e) { notes.push('could not remove the draft (' + friendlyImapError(e) + ')'); }
      finally { lock.release(); }
    }
  });
  return notes;
}

async function verifyImap(acct) {
  try { return await withClient(acct, async client => { const f = await findFolders(client); return { ok: true, drafts: f.drafts && f.drafts.path, gmail: isGmailHost(acct, client) }; }); }
  catch (e) { return { ok: false, error: friendlyImapError(e) }; }
}

function campaignHooks(account, cfg) {
  const wrap = e => { if (e.gone) return e; const w = new Error(friendlyImapError(e)); w.imap = true; w.authenticationFailed = !!e.authenticationFailed; return w; };
  return {
    messageBuilder: async item => {
      let got;
      try { got = await fetchDraftSource(account, cfg.folder, item.meta.uid, item.meta); } catch (e) { throw wrap(e); }
      // re-read recipients from the draft as it is now
      const now = await summarize(got.uid, got.source);
      if (!now.recipients.length) throw Object.assign(new Error('This draft has no recipient now. Add one in your mail app, then retry.'), { gone: true });
      item.meta.recipients = now.recipients; item.meta.uid = got.uid;
      const raw = prepareRaw(got.source, account);
      Object.defineProperty(item, '_raw', { value: raw, configurable: true, writable: true, enumerable: false });
      return { envelope: { from: account.fromEmail || account.user, to: item.meta.recipients }, raw };
    },
    afterSend: async item => {
      const raw = item._raw; delete item._raw;
      try {
        return await afterSent(account, { folder: cfg.folder, uid: item.meta.uid, deleteDraft: cfg.deleteDraft, appendSent: cfg.saveSent && !cfg.gmail, sentFolder: cfg.sentFolder, raw });
      } catch (e) { return ['sent, but cleanup on the IMAP server failed (' + friendlyImapError(e) + ')']; }
    },
    usageWeight: item => Math.max(1, item.meta.recipients.length),
  };
}

module.exports = { campaignHooks, listDrafts, fetchDraftSource, prepareRaw, afterSent, verifyImap, friendlyImapError, findFolders, imapOptions };
