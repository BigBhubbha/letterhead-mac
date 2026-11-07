'use strict';
// Batches: named sends scheduled for a time. Owns the single active campaign so
// manual sends and batches never overlap. Pure Node, clock and storage injectable for tests.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const engine = require('./engine');

const LIVE = ['running', 'waiting', 'paused'];
const ACTIVE_BATCH = ['sending', 'paused'];

class Scheduler extends EventEmitter {
  constructor(o) {
    super();
    this.o = Object.assign({ now: Date.now, graceMs: 2 * 60 * 1000, tickMs: 15000, autoTick: true, compactMs: 60000, listThrottleMs: 1000 }, o);
    this.writes = { snapshot: 0, journal: 0 };
    this.batches = [];
    this.active = null;       // current Campaign
    this.activeBatchId = null;
    this.last = null;         // last finished campaign (for the Send view)
    this._saveT = null; this._compactT = null; this._listT = null;
    this._timer = null;
  }
  now() { return this.o.now(); }

  // ---------- persistence ----------
  // batches.json is a snapshot. While a batch sends, each item change is appended to
  // batches.json.journal as one short line instead of rewriting the whole file, and the snapshot
  // is rewritten at most once a minute (and right away when a batch changes state). On load the
  // journal is replayed on top of the snapshot, so nothing is lost if Letterhead quits or crashes.
  get journalFile() { return this.o.file + '.journal'; }
  load() {
    try { this.batches = JSON.parse(fs.readFileSync(this.o.file, 'utf8')).batches || []; } catch (e) { this.batches = []; }
    this._replayJournal();
    const now = this.now(), missed = [];
    for (const b of this.batches) {
      if (ACTIVE_BATCH.includes(b.status) || b.status === 'queued' && b.items) {
        // Letterhead quit or crashed during this batch
        for (const it of b.items || []) if (it.status === 'sending') { it.status = 'failed'; it.error = 'Interrupted while sending. It may or may not have gone out, check Sent before retrying.'; }
        b.status = 'missed'; b.missedReason = 'interrupted'; missed.push(b.id);
      } else if ((b.status === 'scheduled' || b.status === 'queued') && now - b.scheduledAt > this.o.graceMs) {
        b.status = 'missed'; b.missedReason = 'closed'; missed.push(b.id);
      }
      if (b.items) b.stats = countStats(b.items);
    }
    this.saveNow();
    if (this.o.autoTick) this._timer = setInterval(() => this.tick(), this.o.tickMs);
    return missed;
  }
  _replayJournal() {
    let text = ''; try { text = fs.readFileSync(this.journalFile, 'utf8'); } catch (e) { return 0; }
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch (e) { continue; } // a torn last line from a crash
      const b = this.get(d.b); if (!b || !b.items || !b.items[d.i]) continue;
      Object.assign(b.items[d.i], d.v); n++;
    }
    return n;
  }
  _journal(b, item) {
    const v = { status: item.status, error: item.error, note: item.note, sentAt: item.sentAt, messageId: item.messageId, attempts: item.attempts };
    if (item.meta) v.meta = item.meta;
    try { fs.mkdirSync(path.dirname(this.o.file), { recursive: true }); fs.appendFileSync(this.journalFile, JSON.stringify({ b: b.id, i: item.id, v }) + '\n'); }
    catch (e) { this.save(); }
    this.writes.journal++;
    if (!this._compactT) { this._compactT = setTimeout(() => { this._compactT = null; this.saveNow(); }, this.o.compactMs); if (this._compactT.unref) this._compactT.unref(); }
  }
  stop() { clearInterval(this._timer); clearTimeout(this._listT); }
  saveNow() {
    clearTimeout(this._saveT); this._saveT = null; clearTimeout(this._compactT); this._compactT = null;
    fs.mkdirSync(path.dirname(this.o.file), { recursive: true });
    const tmp = this.o.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, batches: this.batches }));
    fs.renameSync(tmp, this.o.file);
    try { fs.unlinkSync(this.journalFile); } catch (e) { /* none yet */ }
    this.writes.snapshot++;
  }
  save() { if (!this._saveT) this._saveT = setTimeout(() => this.saveNow(), 500); }
  changed() { this.save(); this._emitList(true); }
  // item progress: tell the window at most once a second
  _emitList(now) {
    if (now) { clearTimeout(this._listT); this._listT = null; this.emit('batches', this.list()); return; }
    if (!this._listT) this._listT = setTimeout(() => { this._listT = null; this.emit('batches', this.list()); }, this.o.listThrottleMs);
  }

  // ---------- queries ----------
  list() { return this.batches.map(b => this.publicBatch(b)); }
  // what the window needs for the list: no recipients, letter body, drafts or items (the editor
  // asks for a full batch with batches:get)
  publicBatch(b) {
    const { items, merge, drafts, ...rest } = b;
    const stats = items ? countStats(items) : { total: b.kind === 'drafts' ? ((drafts && drafts.items) || []).length : ((merge && merge.recipients) || []).length };
    return { ...rest, stats, queueAhead: b.status === 'queued' ? this.queueAhead(b) : null };
  }
  get(id) { return this.batches.find(b => b.id === id); }
  queueAhead(b) {
    if (this.active && this.activeBatchId !== b.id) return this.activeBatchId ? (this.get(this.activeBatchId) || {}).name || 'another batch' : 'a send you started';
    return null;
  }
  /** next time anything is due (for the keep-awake logic) */
  nextDue() {
    const t = this.batches.filter(b => b.status === 'scheduled').map(b => b.scheduledAt);
    return t.length ? Math.min(...t) : null;
  }
  hasWork() { return !!this.active && LIVE.includes(this.active.state) || this.batches.some(b => ['scheduled', 'queued', 'sending', 'paused'].includes(b.status)); }

  // ---------- edits ----------
  upsert(input) {
    const now = this.now();
    let b = input.id && this.get(input.id);
    if (b && ACTIVE_BATCH.includes(b.status)) throw new Error('This batch is sending. Pause or cancel it before editing.');
    const fresh = !b;
    if (!b) { b = { id: crypto.randomUUID(), createdAt: now }; this.batches.push(b); }
    const contentChanged = fresh || JSON.stringify([b.kind, b.merge, b.drafts]) !== JSON.stringify([input.kind, input.merge || null, input.drafts || null]);
    Object.assign(b, {
      name: String(input.name || 'Untitled batch').trim().slice(0, 80) || 'Untitled batch',
      kind: input.kind === 'drafts' ? 'drafts' : 'merge',
      merge: input.kind === 'drafts' ? null : input.merge,
      drafts: input.kind === 'drafts' ? input.drafts : null,
      scheduledAt: Number(input.scheduledAt) || now,
      tz: input.tz || null,
      mode: input.mode === 'burst' ? 'burst' : 'interval',
      intervalMs: Math.max(1000, Number(input.intervalMs) || 60000),
      jitterPct: Math.max(0, Math.min(90, Number(input.jitterPct) || 0)),
      lidClosed: !!input.lidClosed,
      status: 'scheduled', missedReason: null, lastError: null, updatedAt: now,
    });
    if (contentChanged) { b.items = null; b.startedAt = null; b.finishedAt = null; }
    this.changed();
    setImmediate(() => this.tick());
    return this.publicBatch(b);
  }
  duplicate(id) {
    const b = this.get(id); if (!b) throw new Error('Batch not found.');
    const now = this.now();
    const copy = JSON.parse(JSON.stringify({ ...b, items: null }));
    Object.assign(copy, { id: crypto.randomUUID(), name: (b.name + ' copy').slice(0, 80), createdAt: now, updatedAt: now, status: 'scheduled', startedAt: null, finishedAt: null, missedReason: null, lastError: null,
      scheduledAt: b.scheduledAt > now ? b.scheduledAt + 86400000 : now + 3600000 });
    this.batches.push(copy); this.changed(); return this.publicBatch(copy);
  }
  remove(id) {
    const b = this.get(id); if (!b) return false;
    if (ACTIVE_BATCH.includes(b.status)) throw new Error('Cancel the batch before deleting it.');
    this.batches = this.batches.filter(x => x !== b); this.changed(); return true;
  }
  cancel(id) {
    const b = this.get(id); if (!b) return false;
    if (this.activeBatchId === id && this.active) { this.active.cancel(); return true; }
    b.status = 'cancelled'; b.finishedAt = this.now(); this.changed(); return true;
  }
  reschedule(id, at) {
    const b = this.get(id); if (!b) throw new Error('Batch not found.');
    if (ACTIVE_BATCH.includes(b.status)) throw new Error('This batch is sending.');
    b.scheduledAt = Number(at); b.status = 'scheduled'; b.missedReason = null; b.updatedAt = this.now();
    this.changed(); setImmediate(() => this.tick()); return this.publicBatch(b);
  }
  sendNow(id) { return this.reschedule(id, this.now()); }
  pause(id) { if (this.activeBatchId === id && this.active) this.active.pause('user'); }
  resume(id) { if (this.activeBatchId === id && this.active) this.active.resume(); }
  retry(id) {
    const b = this.get(id); if (!b || !b.items) return 0;
    if (this.activeBatchId === id && this.active) { const r = this.active.retryFailed(); this.save(); return r; }
    let n = 0;
    for (const it of b.items) if (it.status === 'failed' || it.status === 'skipped' || it.status === 'blocked') { it.status = 'queued'; it.error = null; n++; }
    if (n) { b.status = 'scheduled'; b.scheduledAt = this.now(); b.missedReason = null; this.changed(); setImmediate(() => this.tick()); }
    return n;
  }

  // ---------- running ----------
  busy() { return !!(this.active && LIVE.includes(this.active.state)); }

  tick() {
    const now = this.now();
    let dirty = false;
    for (const b of this.batches) {
      if (b.status === 'scheduled' && b.scheduledAt <= now) {
        if (now - b.scheduledAt > this.o.graceMs) {
          b.status = 'missed'; b.missedReason = 'asleep'; dirty = true;
          this.emit('missed', [b.id]);
        } else { b.status = 'queued'; b.queuedAt = now; dirty = true; }
      }
    }
    // auto resume a batch paused only by the daily cap, once there is room again
    if (this.active && this.active.state === 'paused' && this.active.pauseCode === 'cap') {
      const cap = this.o.getDailyCap ? this.o.getDailyCap() : 0;
      if (!cap || this.o.usage.count() < cap) this.active.resume();
    }
    // and one paused for heat or a low battery, once the Mac has cooled down or is plugged in
    if (this.active && this.active.state === 'paused' && ['thermal', 'battery'].includes(this.active.pauseCode)) {
      const g = this.o.guard ? this.o.guard() : null;
      if (!g || g.code !== this.active.pauseCode) this.active.resume();
    }
    if (!this.busy()) {
      const next = this.batches.filter(b => b.status === 'queued').sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
      if (next) { this.startBatch(next); dirty = true; }
    }
    if (dirty) this.changed();
  }

  _campaign(opts, batch) {
    if (this.busy()) throw new Error(this.activeBatchId ? 'A scheduled batch is sending right now.' : 'A send is already in progress.');
    const account = this.o.getAccount();
    if (!account || !account.host || !account.pass) throw new Error('Connect an account first.');
    const hooks = opts.source === 'drafts' ? this.o.hooksFor(account, opts.draftsCfg) : {};
    const c = new engine.Campaign({ ...opts, ...hooks, guard: this.o.guard, account, usage: this.o.usage, dailyCap: this.o.getDailyCap ? this.o.getDailyCap() : opts.dailyCap, getDailyCap: this.o.getDailyCap });
    this.active = c; this.activeBatchId = batch ? batch.id : null;
    c.on('update', u => { this.emit('campaign:update', u); if (batch) this._onBatchUpdate(batch, c, u); else if (u.state === 'done' || u.state === 'cancelled') this._finished(c); });
    c.on('log', l => this.emit('campaign:log', l));
    return c;
  }

  runImmediate(cfg) { const c = this._campaign({ ...cfg, batchId: null }, null); c.start(); return c.snapshot(); }

  startBatch(b) {
    let recipients;
    if (b.items) recipients = b.items.map(it => ({ ...it }));
    else if (b.kind === 'drafts') recipients = (b.drafts.items || []).map(d => ({ email: d.recipients[0] + (d.recipients.length > 1 ? ` +${d.recipients.length - 1}` : ''), fields: { subject: d.subject }, meta: { uid: d.uid, messageId: d.messageId, subject: d.subject, recipients: d.recipients }, ...(d.replyBlocked ? { status: 'blocked', error: 'Blocked: ' + d.replyBlocked } : {}) }));
    else recipients = (b.merge.recipients || []).filter(r => engine.isEmail(r.email)).map(r => ({ email: r.email, fields: r.fields }));
    const opts = {
      batchId: b.id, batchName: b.name, mode: b.mode, intervalMs: b.intervalMs, jitterPct: b.jitterPct, recipients,
      source: b.kind === 'drafts' ? 'drafts' : 'merge',
      template: b.kind === 'merge' ? { subject: b.merge.subject, body: b.merge.body, attachments: b.merge.attachments || [] } : undefined,
      draftsCfg: b.kind === 'drafts' ? { folder: b.drafts.folder, sentFolder: b.drafts.sentFolder, gmail: b.drafts.gmail, deleteDraft: this.o.getSetting('delDraft', true), saveSent: this.o.getSetting('saveSent', true) } : undefined,
    };
    let c;
    try { c = this._campaign(opts, b); }
    catch (e) { b.status = 'failed'; b.lastError = e.message; b.finishedAt = this.now(); this.changed(); this.emit('notify', { title: `${b.name} could not start`, body: e.message }); return; }
    b.items = c.items; b.status = 'sending'; b.startedAt = b.startedAt || this.now(); b.finishedAt = null; b.lastError = null;
    this.emit('notify', { title: `Sending ${b.name}`, body: `${c.items.filter(i => i.status === 'queued').length} ${b.kind === 'drafts' ? 'drafts' : 'emails'}, ${b.mode === 'burst' ? 'all at once' : 'on your interval'}.` });
    this.changed();
    c.start();
  }

  _onBatchUpdate(b, c, u) {
    b.items = c.items;
    const prev = [b.status, b.pauseReason];
    if (u.state === 'paused') { b.status = 'paused'; b.pauseReason = u.pauseReason; b.pauseCode = u.pauseCode || null; }
    else if (u.state === 'running' || u.state === 'waiting') { b.status = 'sending'; b.pauseReason = null; b.pauseCode = null; b.nextAt = u.nextAt; }
    else if (u.state === 'done' || u.state === 'cancelled') {
      const s = c.stats();
      b.status = u.state === 'cancelled' ? 'cancelled' : (s.sent === 0 && s.failed > 0 ? 'failed' : 'done');
      b.finishedAt = this.now(); b.nextAt = null;
      this.emit('notify', { title: `${b.name} ${b.status === 'done' ? 'finished' : b.status === 'failed' ? 'failed' : 'stopped'}`, body: `${s.sent} sent, ${s.failed} failed${s.skipped ? `, ${s.skipped} skipped` : ''}${s.blocked ? `, ${s.blocked} blocked as replies` : ''}.` });
      this._finished(c);
    }
    b.stats = u.stats || countStats(b.items);
    if (u.item) this._journal(b, u.item);
    if (prev[0] !== b.status || prev[1] !== b.pauseReason || !u.item && !['running', 'waiting'].includes(u.state)) this.changed();
    else this._emitList(false);
  }
  _finished(c) {
    this.last = c; this.active = null; this.activeBatchId = null;
    setImmediate(() => this.tick());
  }
  snapshot() { const c = this.active || this.last; return c ? c.snapshot() : null; }
  current() { return this.active || this.last; }
  clearLast() { if (this.busy()) return false; this.last = null; if (this.active && !LIVE.includes(this.active.state)) this.active = null; return true; }
}

function countStats(items) {
  const s = { total: items.length, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, blocked: 0 };
  for (const it of items) s[it.status] = (s[it.status] || 0) + 1;
  return s;
}

module.exports = { Scheduler };
