'use strict';
// Sending engine. Pure Node (no Electron), so it can be tested on its own.
const nodemailer = require('nodemailer');
const { EventEmitter } = require('events');
const path = require('path');

function normKey(k) {
  return String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const TOKEN = /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

function merge(tpl, fields) {
  return String(tpl || '').replace(TOKEN, (m, key, fallback) => {
    const v = fields[normKey(key)];
    if (v != null && String(v).trim() !== '') return String(v).trim();
    return fallback != null ? fallback : '';
  });
}

function missingFields(tpl, fields) {
  const out = new Set();
  String(tpl || '').replace(TOKEN, (m, key, fallback) => {
    const v = fields[normKey(key)];
    if ((v == null || String(v).trim() === '') && fallback == null) out.add(normKey(key));
    return m;
  });
  return [...out];
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toHtml(text) {
  const paras = String(text).replace(/\r\n/g, '\n').split(/\n{2,}/);
  const body = paras.map(p => {
    let h = escapeHtml(p).replace(/\n/g, '<br>');
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1">$1</a>');
    return `<p style="margin:0 0 1em 0">${h}</p>`;
  }).join('');
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${body}</div>`;
}

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
function isEmail(s) { return EMAIL_RE.test(String(s || '').trim()); }

function buildTransport(acct) {
  const port = Number(acct.port) || 465;
  return nodemailer.createTransport({
    host: acct.host,
    port,
    secure: acct.security ? acct.security === 'ssl' : port === 465,
    requireTLS: acct.security === 'starttls',
    ignoreTLS: acct.security === 'none',
    auth: acct.user ? { user: acct.user, pass: acct.pass } : undefined,
    pool: true,
    maxConnections: 1,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 45000,
    tls: acct.allowInsecure ? { rejectUnauthorized: false } : undefined,
  });
}

function fromHeader(acct) {
  const addr = acct.fromEmail || acct.user;
  return acct.fromName ? { name: acct.fromName, address: addr } : addr;
}

function buildMessage(acct, tpl, fields, toAddr) {
  const subject = merge(tpl.subject, fields);
  const text = merge(tpl.body, fields);
  const msg = { from: fromHeader(acct), to: toAddr, subject, text, html: toHtml(text) };
  if (acct.replyTo) msg.replyTo = acct.replyTo;
  if (tpl.attachments && tpl.attachments.length) {
    msg.attachments = tpl.attachments.map(p => ({ filename: path.basename(p), path: p }));
  }
  return msg;
}

function classify(err) {
  if (err && err.gone) return 'recipient';
  if (err && err.imap) return err.authenticationFailed ? 'auth' : 'network';
  const code = err && (err.code || '');
  const rc = err && err.responseCode;
  const resp = String((err && (err.response || err.message)) || '');
  if (code === 'EAUTH' || rc === 535 || rc === 534) return 'auth';
  if (/5\.4\.5|sending limit|daily user sending|limit for sending/i.test(resp) || rc === 421 && /limit/i.test(resp)) return 'limit';
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(code)) return 'network';
  return 'recipient';
}

function friendlyError(err) {
  if (err && err.imap) return err.message;
  const kind = classify(err);
  const raw = String((err && (err.response || err.message)) || 'Unknown error').split('\n')[0].slice(0, 240);
  if (kind === 'auth') return 'The server rejected the login. Check the address and app password. (' + raw + ')';
  if (kind === 'limit') return 'The server says the sending limit was reached. (' + raw + ')';
  if (kind === 'network') return 'Could not reach the mail server. (' + raw + ')';
  return raw;
}

class Campaign extends EventEmitter {
  /**
   * opts: { account, template:{subject, body, attachments}, recipients:[{email, fields}],
   *         mode:'burst'|'interval', intervalMs, jitterPct, dailyCap, usage:{count(), record()},
   *         transportFactory? }
   */
  constructor(opts) {
    super();
    this.o = opts;
    this.items = opts.recipients.map((r, i) => ({
      id: i, email: String(r.email).trim(), fields: r.fields || {}, meta: r.meta || null,
      status: r.status || 'queued', error: r.error || null, note: r.note || null, sentAt: r.sentAt || null, messageId: r.messageId || null, attempts: r.attempts || 0,
    }));
    this.state = 'idle'; // idle | running | paused | waiting | done | cancelled
    this.pauseReason = null;
    this.pauseCode = null;
    this.nextAt = null;
    this.startedAt = null;
    this.finishedAt = null;
    this._paused = false;
    this._cancelled = false;
    this._running = false;
    this._consecutiveFails = 0;
  }

  stats() {
    const s = { total: this.items.length, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const it of this.items) s[it.status]++;
    return s;
  }

  snapshot() {
    return {
      state: this.state, pauseReason: this.pauseReason, nextAt: this.nextAt,
      startedAt: this.startedAt, finishedAt: this.finishedAt, mode: this.o.mode, source: this.o.source || 'merge', batchId: this.o.batchId || null, batchName: this.o.batchName || null, pauseCode: this.pauseCode,
      stats: this.stats(), items: this.items,
    };
  }

  _emit(item) {
    this.emit('update', { batchId: this.o.batchId || null, pauseCode: this.pauseCode, state: this.state, pauseReason: this.pauseReason, nextAt: this.nextAt, stats: this.stats(), item: item || null });
  }

  _log(kind, text, item) { this.emit('log', { t: Date.now(), kind, text, email: item ? item.email : null }); }

  start() {
    if (this._running) return;
    this._cancelled = false;
    this._paused = false;
    this.pauseReason = null;
    this.startedAt = this.startedAt || Date.now();
    this.finishedAt = null;
    this._run().catch(e => { this._log('error', 'Engine error: ' + e.message); this.state = 'done'; this._emit(); });
  }

  pause(reason, code) {
    if (this.state === 'done' || this.state === 'cancelled') return;
    this._paused = true;
    this.pauseReason = reason || 'user';
    this.pauseCode = code || (reason && reason !== 'user' ? 'other' : 'user');
    this.state = 'paused';
    this.nextAt = null;
    this._log('pause', reason && reason !== 'user' ? reason : 'Paused.');
    this._emit();
  }

  resume() {
    if (!this._paused) return;
    this._paused = false;
    this.pauseReason = null;
    this.pauseCode = null;
    this._consecutiveFails = 0;
    this.state = 'running';
    this._log('resume', 'Resumed.');
    this._emit();
    if (!this._running) this.start();
  }

  cancel() {
    this._cancelled = true;
    this._paused = false;
    for (const it of this.items) if (it.status === 'queued') it.status = 'skipped';
    this._log('cancel', 'Cancelled. Remaining recipients were skipped.');
    if (!this._running) { this.state = 'cancelled'; this.finishedAt = Date.now(); this._emit(); }
  }

  retryFailed() {
    let n = 0;
    for (const it of this.items) if (it.status === 'failed' || it.status === 'skipped') { it.status = 'queued'; it.error = null; n++; }
    if (!n) return 0;
    this._log('retry', `Retrying ${n} recipient${n === 1 ? '' : 's'}.`);
    this._cancelled = false;
    if (this._paused) { this._emit(); return n; }
    this.state = 'running';
    this._emit();
    if (!this._running) this.start();
    return n;
  }

  _delay() {
    const base = Math.max(0, Number(this.o.intervalMs) || 0);
    const j = Math.max(0, Math.min(90, Number(this.o.jitterPct) || 0)) / 100;
    const f = 1 + (Math.random() * 2 - 1) * j;
    return Math.round(base * f);
  }

  async _wait(ms) {
    let remaining = ms;
    const tick = 100;
    this.state = 'waiting';
    this.nextAt = Date.now() + remaining;
    this._emit();
    let wasPaused = false;
    while (remaining > 0) {
      if (this._cancelled) return;
      if (this._paused) { wasPaused = true; await sleep(tick); continue; }
      if (wasPaused) { wasPaused = false; this.state = 'waiting'; this.nextAt = Date.now() + remaining; this._emit(); }
      const step = Math.min(tick, remaining);
      await sleep(step);
      remaining -= step;
    }
    this.nextAt = null;
  }

  async _run() {
    this._running = true;
    this.state = 'running';
    this._emit();
    const factory = this.o.transportFactory || buildTransport;
    const transport = factory(this.o.account);
    let sentThisRun = 0;
    try {
      while (true) {
        if (this._cancelled) break;
        if (this._paused) { await sleep(150); continue; }
        const item = this.items.find(i => i.status === 'queued');
        if (!item) break;

        const cap = Number(typeof this.o.getDailyCap === 'function' ? this.o.getDailyCap() : this.o.dailyCap) || 0;
        if (cap > 0 && this.o.usage && this.o.usage.count() >= cap) {
          this.pause(`Paused at your daily cap of ${cap}. Resume later or raise the cap in Settings.`, 'cap');
          continue;
        }

        if (this.o.mode === 'interval' && sentThisRun > 0) {
          await this._wait(this._delay());
          if (this._cancelled) break;
          if (this._paused) continue;
        }

        if (!this.o.messageBuilder && !isEmail(item.email)) {
          item.status = 'failed'; item.error = 'Not a valid email address.';
          this._log('fail', item.error, item); this._emit(item);
          continue;
        }

        item.status = 'sending'; item.attempts++;
        this.state = 'running';
        this._emit(item);
        try {
          const msg = this.o.messageBuilder ? await this.o.messageBuilder(item) : buildMessage(this.o.account, this.o.template, item.fields, item.email);
          const info = await transport.sendMail(msg);
          item.status = 'sent'; item.sentAt = Date.now(); item.messageId = info.messageId || null; item.error = null;
          sentThisRun++;
          this._consecutiveFails = 0;
          const weight = this.o.usageWeight ? this.o.usageWeight(item) : 1;
          if (this.o.usage) for (let w = 0; w < weight; w++) this.o.usage.record();
          this._log('sent', 'Sent.', item);
          if (this.o.afterSend) {
            this._emit(item);
            try { const notes = await this.o.afterSend(item, msg); if (notes && notes.length) { item.note = notes.join(', '); this._log('note', item.note.charAt(0).toUpperCase() + item.note.slice(1) + '.', item); } }
            catch (e) { item.note = 'Sent, but cleanup failed: ' + e.message; this._log('note', item.note, item); }
          }
        } catch (err) {
          const kind = classify(err);
          item.status = 'failed'; item.error = friendlyError(err);
          this._log('fail', item.error, item);
          this._consecutiveFails++;
          if (kind === 'auth' || kind === 'limit') {
            item.status = 'queued'; item.attempts--;
            this._emit(item);
            this.pause(kind === 'auth' ? 'Paused: the server rejected your login. Fix the account, then resume.' : 'Paused: the server reported a sending limit. Try again later.', kind);
            continue;
          }
          if (this._consecutiveFails >= 3) {
            this._emit(item);
            this.pause('Paused after 3 failures in a row. Check your connection, then resume.');
            continue;
          }
          sentThisRun++; // keep the interval rhythm after a failure too
        }
        this._emit(item);
      }
    } finally {
      try { transport.close(); } catch (e) { /* ignore */ }
      this._running = false;
    }
    if (this._paused) return;
    this.nextAt = null;
    this.finishedAt = Date.now();
    this.state = this._cancelled ? 'cancelled' : 'done';
    const s = this.stats();
    this._log('done', `${this._cancelled ? 'Stopped' : 'Finished'}: ${s.sent} sent, ${s.failed} failed${s.skipped ? `, ${s.skipped} skipped` : ''}.`);
    this._emit();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function verifyAccount(acct, factory) {
  const t = (factory || buildTransport)(acct);
  try { await t.verify(); return { ok: true }; }
  catch (e) { return { ok: false, error: friendlyError(e) }; }
  finally { try { t.close(); } catch (e) {} }
}

async function sendTest(acct, template, fields, factory) {
  const t = (factory || buildTransport)(acct);
  try {
    const to = acct.fromEmail || acct.user;
    const msg = buildMessage(acct, template, fields, to);
    msg.subject = '[Test] ' + msg.subject;
    const info = await t.sendMail(msg);
    return { ok: true, to, messageId: info.messageId };
  } catch (e) { return { ok: false, error: friendlyError(e) }; }
  finally { try { t.close(); } catch (e) {} }
}

function toCsv(rows, headers) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [headers.map(esc).join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\r\n') + '\r\n';
}

function resultsCsv(items) {
  const fieldKeys = [];
  for (const it of items) for (const k of Object.keys(it.fields || {})) if (!fieldKeys.includes(k) && k !== 'email') fieldKeys.push(k);
  const headers = ['email', ...fieldKeys, 'status', 'sent_at_local', 'sent_at_utc', 'attempts', 'error', 'note', 'message_id'];
  const rows = items.map(it => {
    const r = { email: it.email, status: it.status, sent_at_local: it.sentAt ? new Date(it.sentAt).toLocaleString('en-US') : '', sent_at_utc: it.sentAt ? new Date(it.sentAt).toISOString() : '', attempts: it.attempts, error: it.error || '', note: it.note || '', message_id: it.messageId || '' };
    for (const k of fieldKeys) r[k] = it.fields[k];
    return r;
  });
  return toCsv(rows, headers);
}

module.exports = { friendlyError, normKey, merge, missingFields, toHtml, isEmail, buildTransport, buildMessage, Campaign, verifyAccount, sendTest, resultsCsv, classify };
