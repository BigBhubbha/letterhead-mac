'use strict';
// Reply assistant: drafts replies in Shabd's voice, keeps a queue of suggested replies, and (only if he turns it on)
// sends automatic replies for mail that matches his rules, after a review window, under a daily limit.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { htmlToText, normSubject, NOREPLY } = require('./mail');

const AUTO_SUBJECT = /(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|undeliverable|delivery (status|failure)|mail delivery|returned mail|away from)/i;
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textToHtml = t => String(t || '').trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

function stripQuoted(t) {
  t = String(t || '').replace(/\r/g, '');
  const m = /^\s*On .{5,200}wrote:\s*$/m.exec(t); if (m) t = t.slice(0, m.index);
  return t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n').trim();
}
function matchSender(list, addr) {
  addr = String(addr || '').toLowerCase(); const dom = addr.split('@')[1] || '';
  return (list || []).some(x => { x = String(x || '').trim().toLowerCase(); if (!x) return false; if (x.includes('@') && !x.startsWith('@')) return x === addr; const d = x.replace(/^@/, ''); return dom === d || dom.endsWith('.' + d); });
}

class Assistant extends EventEmitter {
  /** o: { db, mail, ai, style, getSettings(), getAccount(), now?, getSignature?() } */
  constructor(o) { super(); this.o = Object.assign({ now: Date.now }, o); this.db = o.db; this.queue = []; this.busy = false; this._t = null; }
  now() { return this.o.now(); }
  s() { const st = this.o.getSettings() || {}; return { aiEnabled: !!st.aiEnabled, autoDraft: st.autoDraft !== false, autoDraftDaily: Number(st.autoDraftDaily) || 40, about: st.aboutMe || '', autoReply: Object.assign({ enabled: false, rules: [], dailyLimit: 10 }, st.autoReply || {}) }; }
  self() { return this.o.mail.self(); }
  start(tickMs = 15000) { clearInterval(this._t); this._t = setInterval(() => this.tick().catch(() => {}), tickMs); }
  stop() { clearInterval(this._t); }
  keyOf(r) { return r.msgid || `${r.folder}:${r.uid}`; }

  /** '' when the message deserves a reply, otherwise why not. */
  replyBlock(r) {
    if (!r) return 'missing';
    const self = this.self();
    if (self.includes(r.fromAddr)) return 'from you';
    if (r.bulk) return r.bulk;
    if (r.answered) return 'already answered';
    const latest = this.db.get('SELECT fromAddr, date FROM messages WHERE thread=? ORDER BY date DESC LIMIT 1', [r.thread]);
    if (latest && self.includes(latest.fromAddr) && latest.date >= r.date) return 'you replied already';
    if (this.now() - r.date > 14 * 86400000) return 'older than two weeks';
    return '';
  }
  /** Hard rules for automatic replies. These are never overridden by a rule. */
  autoBlock(r) {
    const b = this.replyBlock(r); if (b) return b;
    if (AUTO_SUBJECT.test(r.subject || '')) return 'looks like an automatic message';
    if (NOREPLY.test(String(r.replyTo || '').split('@')[0] + '@')) return 'no-reply address';
    const rc = JSON.parse(r.toJson || '[]').length + JSON.parse(r.ccJson || '[]').length;
    if (rc > 5) return 'sent to a big group';
    if (this.now() - r.date > 24 * 3600e3) return 'older than a day';
    const recent = this.db.get("SELECT count(*) n FROM autolog WHERE status='sent' AND toAddr=? AND t>?", [r.fromAddr, this.now() - 24 * 3600e3]).n;
    if (recent) return 'already auto-replied to this person today';
    const inThread = this.db.get("SELECT count(*) n FROM suggestions WHERE thread=? AND auto=1 AND status='sent'", [r.thread]).n;
    if (inThread) return 'already auto-replied in this conversation';
    return '';
  }
  ruleFor(r) {
    const ar = this.s().autoReply; if (!ar.enabled) return null;
    const labels = [r.folder, ...JSON.parse(r.labels || '[]')].map(x => String(x).toLowerCase());
    for (const rule of ar.rules || []) {
      if (!rule.enabled) continue;
      const hasS = (rule.senders || []).filter(Boolean).length, hasL = (rule.labels || []).filter(Boolean).length;
      if (!hasS && !hasL && !rule.anyone) continue;
      if (hasS && !matchSender(rule.senders, r.fromAddr)) continue;
      if (hasL && !(rule.labels || []).some(l => labels.includes(String(l).toLowerCase()))) continue;
      return rule;
    }
    return null;
  }
  sentToday() { return this.db.get("SELECT count(*) n FROM autolog WHERE status='sent' AND t>?", [this.now() - 24 * 3600e3]).n; }
  draftsToday() { return this.db.kvGet('ai.drafts', []).filter(t => this.now() - t < 24 * 3600e3).length; }
  log(r, status, reason, rule) { this.db.run('INSERT INTO autolog(t,toAddr,subject,status,reason,rule) VALUES(?,?,?,?,?,?)', [this.now(), r.fromAddr, r.subject, status, reason || '', rule || '']); this.emit('log'); }

  // ---------- drafting ----------
  async conversation(r) {
    const msgs = (await this.o.mail.thread(r.thread, { fetchGmail: true }).catch(() => [])).filter(m => m.date <= r.date + 1000).slice(-6);
    const out = [];
    for (const m of msgs) { let body = null; try { body = await this.o.mail.body(m.folder, m.uid); } catch (e) {} out.push({ ...m, text: stripQuoted(body ? body.text || htmlToText(body.html) : m.snippet) }); }
    return out;
  }
  async prompt(r, { variant = 'default', instruction = '', previous = '' } = {}) {
    const acct = this.o.getAccount() || {}; const name = acct.fromName || 'the user'; const email = acct.fromEmail || acct.user;
    const convo = await this.conversation(r);
    const last = convo[convo.length - 1] || { text: r.snippet, fromName: r.fromName, fromAddr: r.fromAddr };
    const inConvo = new Set(convo.map(m => m.msgid));
    const examples = this.o.style ? this.o.style.similar(`${r.subject} ${last.text}`, 5).filter(e => !inConvo.has(e.msgid)).slice(0, 3) : [];
    const self = this.self();
    const system = `You are drafting an email reply on behalf of ${name} (${email}). Write the way they write, using the style notes and past examples, so it sounds like them and not like an assistant. Output only the body of the reply, starting with the greeting if they usually use one. No subject line, no quoted text, no notes to the user. Be warm, helpful and natural. If the reply needs a fact or decision you do not have (a time, a date, a yes or no, a number, a file), write a short placeholder in square brackets such as [Thursday at 4 PM?] instead of making it up.`;
    const parts = [];
    const prof = this.o.style ? this.o.style.profileText() : '';
    if (prof) parts.push('STYLE NOTES\n' + prof);
    const about = this.s().about; if (about) parts.push('ABOUT THEM\n' + about);
    if (examples.length) parts.push('HOW THEY REPLIED TO SIMILAR EMAILS\n' + examples.map((e, i) => `Example ${i + 1}\nThey received: ${clip(e.context || e.subject, 600)}\nThey wrote:\n${clip(e.reply, 900)}`).join('\n\n'));
    parts.push('THE CONVERSATION (oldest first)\n' + convo.map(m => `From: ${self.includes(m.fromAddr) ? name + ' (them)' : (m.fromName || m.fromAddr) + ' <' + m.fromAddr + '>'}\nDate: ${new Date(m.date).toDateString()}\nSubject: ${m.subject}\n\n${clip(m.text, 2500)}`).join('\n\n-----\n\n'));
    const ask = { default: '', shorter: 'Make this reply noticeably shorter: two to four sentences.', formal: 'Make this reply a bit more formal and polished than usual, still in their voice.', casual: 'Make this reply a bit more relaxed and friendly.', regenerate: 'Write a fresh version with different wording.' }[variant] || '';
    let task = `Write ${name}'s reply to the last message, from ${last.fromName || last.fromAddr}. ${ask} ${instruction ? 'Also: ' + instruction : ''}`.trim();
    if (previous && ['shorter', 'formal', 'casual', 'custom'].includes(variant)) task += `\n\nHere is the current draft to adjust:\n${previous}`;
    parts.push(task);
    return { system, prompt: parts.join('\n\n'), examples: examples.length };
  }
  upsertSuggestion(r, patch) {
    const k = this.keyOf(r), now = this.now();
    const cur = this.db.get('SELECT * FROM suggestions WHERE k=?', [k]);
    if (!cur) this.db.run('INSERT INTO suggestions(k,thread,msgid,folder,uid,fromAddr,fromName,subject,snippet,date,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', [k, r.thread, r.msgid, r.folder, r.uid, r.fromAddr, r.fromName, r.subject, r.snippet, r.date, 'pending', now, now]);
    const fields = Object.keys(patch); if (fields.length) this.db.run(`UPDATE suggestions SET ${fields.map(f => f + '=?').join(',')}, updatedAt=? WHERE k=?`, [...fields.map(f => patch[f]), now, k]);
    const out = this.db.get('SELECT * FROM suggestions WHERE k=?', [k]); this.emit('changed', out); return out;
  }
  rowOf(id) { return this.db.get('SELECT * FROM messages WHERE id=?', [id]); }
  /** Generate (or adjust) a draft for message row id. */
  async draft(id, { variant = 'default', instruction = '', interactive = true, onDelta } = {}) {
    if (!this.s().aiEnabled) throw new Error('Turn on the AI assistant in Settings first.');
    const r = this.rowOf(id); if (!r) throw new Error('That message is gone.');
    const cur = this.db.get('SELECT * FROM suggestions WHERE k=?', [this.keyOf(r)]);
    this.upsertSuggestion(r, { status: 'working', error: null });
    try {
      const p = await this.prompt(r, { variant, instruction, previous: cur && cur.draft });
      const out = await this.o.ai.generate({ system: p.system, prompt: p.prompt, maxTokens: 900, temperature: variant === 'regenerate' ? 0.95 : 0.7, interactive, onDelta, nonce: variant === 'regenerate' ? crypto.randomUUID() : '' });
      const text = out.text.replace(/^```\w*\n?|```$/g, '').replace(/^(subject|re):.*\n+/i, '').trim();
      return this.upsertSuggestion(r, { status: cur && cur.status === 'scheduled' ? 'scheduled' : 'ready', draft: text, variant, model: out.model, error: null });
    } catch (e) {
      this.upsertSuggestion(r, { status: cur && cur.draft ? (cur.status === 'working' ? 'ready' : cur.status) : 'error', error: e.friendly || e.message });
      throw e;
    }
  }
  /** New Inbox mail from the mail client. */
  onNewMail(list) {
    const st = this.s(); if (!st.aiEnabled) return;
    for (const item of list) {
      const r = this.rowOf(item.id); if (!r) continue;
      if (this.replyBlock(r)) continue;
      const rule = this.ruleFor(r);
      const why = rule ? this.autoBlock(r) : '';
      if (rule && why) this.log(r, 'skipped', why, rule.name);
      if (rule && !why) this.queue.push({ id: r.id, rule });
      else if (st.autoDraft && this.draftsToday() < st.autoDraftDaily) this.queue.push({ id: r.id });
    }
    this.pump();
  }
  async pump() {
    if (this.busy) return; this.busy = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift(); const r = this.rowOf(job.id); if (!r) continue;
        const ex = this.db.get('SELECT status FROM suggestions WHERE k=?', [this.keyOf(r)]);
        if (ex && ['ready', 'scheduled', 'sent', 'dismissed'].includes(ex.status) && !job.rule) continue;
        try {
          const l = this.db.kvGet('ai.drafts', []).filter(t => this.now() - t < 24 * 3600e3); l.push(this.now()); this.db.kvSet('ai.drafts', l);
          const sug = await this.draft(r.id, { interactive: false });
          if (job.rule) {
            const ar = this.s().autoReply;
            if (this.sentToday() >= ar.dailyLimit) { this.upsertSuggestion(r, { auto: 0 }); this.log(r, 'skipped', `daily limit of ${ar.dailyLimit} reached`, job.rule.name); continue; }
            const mins = Math.max(1, Number(job.rule.reviewMin) || 30);
            this.upsertSuggestion(r, { status: 'scheduled', auto: 1, rule: job.rule.name, sendAt: this.now() + mins * 60000 });
            this.emit('scheduled', { ...sug, sendAt: this.now() + mins * 60000 });
          }
        } catch (e) { /* recorded on the suggestion */ }
      }
    } finally { this.busy = false; }
  }
  /** Send automatic replies whose review window is over, after checking everything again. */
  async tick() {
    const due = this.db.all("SELECT * FROM suggestions WHERE status='scheduled' AND sendAt<=?", [this.now()]);
    for (const s of due) {
      const r = this.db.get('SELECT * FROM messages WHERE (msgid=? AND msgid IS NOT NULL) OR (folder=? AND uid=?) ORDER BY folder<>? LIMIT 1', [s.msgid, s.folder, s.uid, s.folder]);
      const ar = this.s().autoReply;
      const rule = r && this.ruleFor(r);
      let why = !this.s().aiEnabled ? 'assistant turned off' : !ar.enabled ? 'auto-reply turned off' : !r ? 'message no longer in your mailbox' : !rule ? 'no rule matches any more' : this.autoBlock({ ...r, date: Math.max(r.date, this.now() - 3600e3) });
      if (!why && this.sentToday() >= ar.dailyLimit) why = `daily limit of ${ar.dailyLimit} reached`;
      if (why) { this.upsertSuggestion(s, { status: 'ready', auto: 0, sendAt: null, error: 'Not sent automatically: ' + why }); this.log(s, 'held', why, s.rule); continue; }
      try { await this.sendReply(r, s.draft, { auto: true }); this.upsertSuggestion(s, { status: 'sent', sendAt: null }); this.log(s, 'sent', '', s.rule); this.emit('autosent', s); }
      catch (e) { this.upsertSuggestion(s, { status: 'ready', auto: 0, error: 'Automatic send failed: ' + e.message }); this.log(s, 'failed', e.message, s.rule); }
    }
  }
  async sendReply(r, text, { auto = false, html } = {}) {
    const sig = this.o.getSignature ? this.o.getSignature() : '';
    const refs = [...JSON.parse(r.refs || '[]'), r.msgid].filter(Boolean);
    const subject = /^re:/i.test(r.subject || '') ? r.subject : 'Re: ' + normSubject(r.subject);
    const body = html || textToHtml(text);
    return this.o.mail.send({ to: [r.replyTo || r.fromAddr], subject, html: body + (sig ? `<div class="lh-sig"><br>${sig}</div>` : ''), inReplyTo: r.msgid, references: refs, replyOf: r.id, autoSubmitted: auto });
  }
  // ---------- queue view ----------
  list() {
    const rows = this.db.all("SELECT * FROM suggestions WHERE status NOT IN ('dismissed') AND (status<>'sent' OR updatedAt>?) ORDER BY CASE status WHEN 'scheduled' THEN 0 WHEN 'ready' THEN 1 WHEN 'working' THEN 2 WHEN 'pending' THEN 2 WHEN 'error' THEN 3 ELSE 4 END, date DESC LIMIT 200", [this.now() - 2 * 86400000]);
    return rows.map(s => { const m = this.db.get('SELECT id, seen, answered, folder FROM messages WHERE (msgid=? AND msgid IS NOT NULL) OR (folder=? AND uid=?) LIMIT 1', [s.msgid, s.folder, s.uid]); return { ...s, messageId: m ? m.id : null, gone: !m }; });
  }
  /** Inbox messages that look like they need an answer and have no suggestion yet. */
  candidates(limit = 30) {
    const inbox = this.o.mail.special('\\Inbox') || 'INBOX';
    const rows = this.db.all("SELECT * FROM messages WHERE folder=? AND (bulk IS NULL OR bulk='') AND answered=0 AND date>? ORDER BY date DESC LIMIT 200", [inbox, this.now() - 14 * 86400000]);
    const out = [], threads = new Set();
    for (const r of rows) { if (threads.has(r.thread)) continue; threads.add(r.thread); if (this.replyBlock(r)) continue; if (this.db.get('SELECT 1 FROM suggestions WHERE k=?', [this.keyOf(r)])) continue; out.push(this.o.mail.listRow(r)); if (out.length >= limit) break; }
    return out;
  }
  suggestionFor(id) { const r = this.rowOf(id); return r ? this.db.get('SELECT * FROM suggestions WHERE k=?', [this.keyOf(r)]) : null; }
  setDraft(k, text) { const s = this.db.get('SELECT * FROM suggestions WHERE k=?', [k]); if (s) return this.upsertSuggestion(s, { draft: text }); }
  dismiss(k) { const s = this.db.get('SELECT * FROM suggestions WHERE k=?', [k]); if (s) return this.upsertSuggestion(s, { status: 'dismissed', sendAt: null, auto: 0 }); }
  hold(k) { const s = this.db.get('SELECT * FROM suggestions WHERE k=?', [k]); if (s && s.status === 'scheduled') { this.log(s, 'cancelled', 'you stopped it', s.rule); return this.upsertSuggestion(s, { status: 'ready', sendAt: null, auto: 0, error: null }); } return s; }
  markSent(k) { const s = this.db.get('SELECT * FROM suggestions WHERE k=?', [k]); if (s) return this.upsertSuggestion(s, { status: 'sent', sendAt: null }); }
  autolog(limit = 100) { return this.db.all('SELECT * FROM autolog ORDER BY t DESC, rowid DESC LIMIT ?', [limit]); }
}

module.exports = { Assistant, matchSender, stripQuoted, textToHtml, AUTO_SUBJECT };
