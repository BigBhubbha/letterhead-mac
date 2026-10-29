'use strict';
// Writing style: reads Shabd's Sent mail (only after he turns it on), keeps what he wrote and what he was replying to
// in the local database, measures his habits (greetings, sign-offs, length, phrases), optionally asks the AI for a short
// description of his tone, and finds his most similar past replies for each new draft. All stored on this Mac.
const crypto = require('crypto');
const { simpleParser } = require('mailparser');

const STOP = new Set('a an the and or but if then so to of in on at for from by with about as is are was were be been being am i me my we our you your he she it they them this that these those do does did have has had not no yes can could would should will just very really also too than there here what when where which who how all any some more most other into out up down over again further once only own same such both each few nor off s t don now re fwd hi hey hello dear thanks thank best regards'.split(' '));
const tokenize = s => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).map(w => { w = w.replace(/'s$/, ''); return w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w; }).filter(w => w.length > 1 && !STOP.has(w));
const words = s => String(s || '').trim().split(/\s+/).filter(Boolean);
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const pct = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };

/** Split one sent email into what he wrote and the quoted message he was answering. */
function splitReply(text) {
  let t = String(text || '').replace(/\r/g, '');
  let context = '';
  const markers = [/^\s*On .{5,200}wrote:\s*$/m, /^\s*-{2,}\s*Original Message\s*-{2,}/mi, /^\s*From: .+\n(?:Sent|Date): .+/m, /^\s*Le .{5,200}a écrit\s*:\s*$/m];
  let cut = -1;
  for (const re of markers) { const m = re.exec(t); if (m && (cut < 0 || m.index < cut)) cut = m.index; }
  if (cut >= 0) { context = t.slice(cut).replace(/^\s*.*\n/, ''); t = t.slice(0, cut); }
  const lines = t.split('\n'); const own = [], quoted = [];
  for (const l of lines) (/^\s*>/.test(l) ? quoted : own).push(l.replace(/^\s*>\s?/, ''));
  context = (context ? context.split('\n').map(l => l.replace(/^\s*>+\s?/, '')).join('\n') : '') + (quoted.length ? '\n' + quoted.join('\n') : '');
  let reply = own.join('\n');
  const sig = reply.search(/^-- ?$/m); if (sig > 0) reply = reply.slice(0, sig);
  return { reply: reply.replace(/\n{3,}/g, '\n\n').trim(), context: context.replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000) };
}

const GREET = /^(hi|hey|hello|dear|good (morning|afternoon|evening)|greetings|hiya|yo)\b/i;
function greetingOf(reply) {
  const first = (reply.split('\n').find(l => l.trim()) || '').trim();
  if (!GREET.test(first) || words(first).length > 7) return null;
  const m = GREET.exec(first)[0];
  const rest = first.slice(m.length).trim();
  const punct = /[,!:.]$/.test(rest || first) ? (rest || first).slice(-1) : '';
  const title = /^(dr|professor|prof|mr|mrs|ms|coach|mx)\b\.?/i.exec(rest);
  return (m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()) + (rest.replace(/[,!:.]$/, '') ? ' ' + (title ? title[0].replace(/^./, c => c.toUpperCase()) + ' {last name}' : '{name}') : '') + punct;
}
function signoffOf(reply) {
  const lines = reply.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { signoff: null, name: null };
  const last = lines[lines.length - 1], prev = lines[lines.length - 2];
  if (words(last).length <= 3 && /[,!]$/.test(prev) && words(prev).length <= 5) return { signoff: prev, name: last };
  if (/[,!]$/.test(last) && words(last).length <= 4) return { signoff: last, name: null };
  return { signoff: null, name: words(last).length <= 2 ? last : null };
}
function top(map, n, min = 1) { return [...map.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ text: k, count: c })); }

function computeStats(rows) {
  const g = new Map(), gAcad = new Map(), gOther = new Map(), so = new Map(), names = new Map(), grams = new Map();
  const lens = [], sentLens = []; let excl = 0, ques = 0, contr = 0, emoji = 0, lowerStart = 0;
  for (const r of rows) {
    const rep = r.reply; const w = words(rep); if (!w.length) continue;
    lens.push(w.length);
    const gr = greetingOf(rep);
    if (gr) { g.set(gr, (g.get(gr) || 0) + 1); const acad = /\.edu$|\.ac\.|\.edu\./.test(r.toAddr || '') || /\b(dr|professor|prof)\b/i.test(rep.split('\n')[0]); (acad ? gAcad : gOther).set(gr, ((acad ? gAcad : gOther).get(gr) || 0) + 1); }
    const s = signoffOf(rep); if (s.signoff) so.set(s.signoff, (so.get(s.signoff) || 0) + 1); if (s.name) names.set(s.name, (names.get(s.name) || 0) + 1);
    if (/!/.test(rep)) excl++; if (/\?/.test(rep)) ques++;
    if (/\b\w+'(m|re|s|ve|ll|d|t)\b/i.test(rep)) contr++;
    if (/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(rep)) emoji++;
    const body = rep.split('\n').filter(l => l.trim()).slice(gr ? 1 : 0, s.signoff ? -2 : undefined).join(' ');
    if (/^[a-z]/.test(body.trim())) lowerStart++;
    for (const sen of body.split(/(?<=[.!?])\s+/)) { const n = words(sen).length; if (n) sentLens.push(n); }
    const toks = body.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
    const seen = new Set();
    for (let i = 0; i + 3 <= toks.length; i++) { const tri = toks.slice(i, i + 3); if (tri.every(t => STOP.has(t))) continue; const k = tri.join(' '); if (!seen.has(k)) { seen.add(k); grams.set(k, (grams.get(k) || 0) + 1); } }
  }
  const n = lens.length || 1;
  const phrases = top(grams, 40, Math.max(2, Math.round(rows.length * 0.04))).filter(p => !/\{|\d/.test(p.text)).slice(0, 12);
  return {
    count: lens.length, greetings: top(g, 5), greetingsAcademic: top(gAcad, 3), greetingsCasual: top(gOther, 3), signoffs: top(so, 5), name: (top(names, 1)[0] || {}).text || null,
    words: { median: median(lens), p25: pct(lens, 0.25), p75: pct(lens, 0.75) }, sentenceWords: Math.round(median(sentLens)) || 0,
    rates: { exclamation: +(excl / n).toFixed(2), question: +(ques / n).toFixed(2), contractions: +(contr / n).toFixed(2), emoji: +(emoji / n).toFixed(2), lowercaseStart: +(lowerStart / n).toFixed(2) },
    phrases,
  };
}
function statsText(st) {
  if (!st || !st.count) return '';
  const L = [];
  L.push(`Based on ${st.count} emails they sent.`);
  if (st.greetings.length) L.push(`Usual greetings: ${st.greetings.map(x => `"${x.text}"`).join(', ')}.` + (st.greetingsAcademic.length ? ` With professors and researchers: ${st.greetingsAcademic.map(x => `"${x.text}"`).join(', ')}.` : '') + (st.greetingsCasual.length ? ` With others: ${st.greetingsCasual.map(x => `"${x.text}"`).join(', ')}.` : ''));
  if (st.signoffs.length) L.push(`Usual sign-offs: ${st.signoffs.map(x => `"${x.text}"`).join(', ')}${st.name ? `, then "${st.name}"` : ''}.`);
  L.push(`Length: usually ${st.words.p25} to ${st.words.p75} words (median ${st.words.median}). Sentences around ${st.sentenceWords} words.`);
  const r = st.rates;
  L.push(`${Math.round(r.exclamation * 100)}% of emails use an exclamation mark, ${Math.round(r.question * 100)}% ask a question, ${Math.round(r.contractions * 100)}% use contractions${r.emoji ? `, ${Math.round(r.emoji * 100)}% use emoji` : ', no emoji'}.`);
  if (st.phrases.length) L.push(`Phrases they often use: ${st.phrases.slice(0, 8).map(p => `"${p.text}"`).join(', ')}.`);
  return L.join('\n');
}

class BM25 {
  constructor(docs) {
    this.docs = docs.map(d => ({ ...d, toks: tokenize(d.text) })); this.N = this.docs.length || 1;
    this.df = new Map(); let total = 0;
    for (const d of this.docs) { total += d.toks.length; d.tf = new Map(); for (const t of d.toks) d.tf.set(t, (d.tf.get(t) || 0) + 1); for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1); }
    this.avg = total / this.N || 1;
  }
  search(q, k = 3) {
    const qt = [...new Set(tokenize(q))]; const k1 = 1.4, b = 0.75;
    return this.docs.map(d => { let s = 0; for (const t of qt) { const f = d.tf.get(t); if (!f) continue; const idf = Math.log(1 + (this.N - this.df.get(t) + 0.5) / (this.df.get(t) + 0.5)); s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.toks.length / this.avg)); } return { d, s }; })
      .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map(x => ({ ...x.d.row, score: +x.s.toFixed(2) }));
  }
}

class Style {
  /** o: { db, mail, ai, getProfileFile, save(profile), load() } */
  constructor(o) { this.o = o; this.db = o.db; this._bm = null; this._bmN = -1; this.job = null; this.progress = { state: 'idle' }; }
  count() { return this.db.get('SELECT count(*) n FROM sent_index').n; }
  rows(limit = 5000) { return this.db.all('SELECT * FROM sent_index ORDER BY date DESC LIMIT ?', [limit]); }
  setProgress(p) { this.progress = { ...this.progress, ...p }; this.o.onProgress && this.o.onProgress(this.progress); }

  /** Read up to `limit` newest Sent messages into the index. Resumable: already indexed ones are skipped. */
  async index({ limit = 1000, signal, useAI = true } = {}) {
    if (this.job) return this.job;
    this.job = (async () => {
      const mail = this.o.mail;
      const sent = mail.special('\\Sent') || (await mail.connect(), mail.special('\\Sent'));
      if (!sent) throw new Error('Could not find your Sent folder.');
      this.setProgress({ state: 'listing', done: 0, total: 0, error: null });
      const uids = await mail.withBox(sent, c => c.search({ all: true }, { uid: true }));
      const want = (uids || []).slice(-limit).reverse();
      const have = new Set(this.db.all('SELECT uid FROM sent_index').map(r => r.uid));
      const todo = want.filter(u => !have.has(u));
      this.setProgress({ state: 'reading', total: want.length, done: want.length - todo.length });
      const hashes = new Set(this.db.all('SELECT hash FROM sent_index').map(r => r.hash));
      for (let i = 0; i < todo.length; i += 25) {
        if (signal && signal.aborted) throw new Error('Stopped');
        const batch = todo.slice(i, i + 25);
        const got = await mail.withBox(sent, async c => { const out = []; for await (const m of c.fetch(batch.join(','), { uid: true, source: true, envelope: true }, { uid: true })) out.push(m); return out; });
        const rows = [];
        for (const m of got) {
          try {
            const p = await simpleParser(m.source);
            const text = p.text || String(p.html || '').replace(/<[^>]+>/g, ' ');
            const { reply, context } = splitReply(text);
            if (words(reply).length < 3) continue;
            const hash = crypto.createHash('sha1').update(reply.toLowerCase().replace(/\s+/g, ' ').replace(/^(hi|hey|dear|hello)\s+\S+/, '')).digest('hex');
            const to = (p.to && p.to.value && p.to.value[0]) || {};
            rows.push([p.messageId ? p.messageId.replace(/^<|>$/g, '') : 'uid' + m.uid, m.uid, p.date ? +p.date : Date.now(), (to.address || '').toLowerCase(), to.name || '', p.subject || '', reply.slice(0, 6000), context, hashes.has(hash) ? hash + ':dup' : hash]);
            hashes.add(hash);
          } catch (e) {}
        }
        this.db.tx(() => { for (const r of rows) this.db.run('INSERT OR IGNORE INTO sent_index(msgid,uid,date,toAddr,toName,subject,reply,context,hash) VALUES(?,?,?,?,?,?,?,?,?)', r); });
        this.setProgress({ done: Math.min(want.length, want.length - todo.length + i + batch.length) });
        await new Promise(r => setTimeout(r, 60)); // be gentle with the server
      }
      // keep only the window he chose
      const keep = new Set(want); const extra = this.db.all('SELECT id, uid FROM sent_index').filter(r => !keep.has(r.uid));
      if (extra.length) this.db.tx(() => extra.forEach(r => this.db.run('DELETE FROM sent_index WHERE id=?', [r.id])));
      this._bm = null;
      const stats = computeStats(this.db.all("SELECT * FROM sent_index WHERE hash NOT LIKE '%:dup'"));
      const prof = { ...(this.o.load() || {}), stats, indexedAt: Date.now(), indexedCount: this.count(), window: limit };
      this.o.save(prof);
      if (useAI && this.o.ai && this.o.ai.ready()) await this.describeTone({ signal }).catch(e => this.setProgress({ toneError: e.friendly || e.message }));
      this.setProgress({ state: 'done' });
      return this.o.load();
    })().catch(e => { this.setProgress({ state: 'error', error: e.message }); throw e; }).finally(() => { this.job = null; });
    return this.job;
  }
  /** Ask the AI for a short description of his tone, from a sample of his emails, in small throttled batches. Resumable. */
  async describeTone({ signal } = {}) {
    const all = this.db.all("SELECT * FROM sent_index WHERE hash NOT LIKE '%:dup' ORDER BY date DESC");
    const okLen = all.filter(r => { const n = words(r.reply).length; return n >= 15 && n <= 260; });
    const byTo = new Map(); for (const r of okLen) { if (!byTo.has(r.toAddr)) byTo.set(r.toAddr, []); byTo.get(r.toAddr).push(r); }
    const sample = []; let round = 0;
    while (sample.length < 45 && round < 10) { for (const list of byTo.values()) if (list[round] && sample.length < 45) sample.push(list[round]); round++; }
    if (sample.length < 3) return null;
    const key = crypto.createHash('sha1').update(sample.map(r => r.id).join(',')).digest('hex');
    let st = this.db.kvGet('style.tone', null); if (!st || st.key !== key) st = { key, notes: [] };
    const batches = []; for (let i = 0; i < sample.length; i += 15) batches.push(sample.slice(i, i + 15));
    for (let i = st.notes.length; i < batches.length; i++) {
      this.setProgress({ state: 'describing', step: i + 1, steps: batches.length + 1 });
      const emails = batches[i].map((r, j) => `Email ${j + 1} (to ${/\.edu$/.test(r.toAddr) ? 'a professor or researcher' : 'someone'}):\n${r.reply}`).join('\n\n---\n\n');
      const out = await this.o.ai.generate({ system: 'You are a writing coach who describes how a person writes emails.', prompt: `Here are emails written by one person. Describe their writing style in 6 to 10 short bullet points: tone and warmth, how formal they are with different kinds of people, how they open and close, sentence length, punctuation habits, and words or phrases they like. Describe the style only. Do not repeat phone numbers, addresses or other private details.\n\n${emails}`, maxTokens: 500, temperature: 0.3, signal });
      st.notes.push(out.text); this.db.kvSet('style.tone', st);
    }
    this.setProgress({ state: 'describing', step: batches.length + 1, steps: batches.length + 1 });
    const merged = st.notes.length === 1 ? st.notes[0] : (await this.o.ai.generate({ system: 'You are a writing coach.', prompt: `Combine these notes about one person's email style into a single profile of 8 to 12 short bullet points. Keep the specific habits.\n\n${st.notes.join('\n\n')}`, maxTokens: 600, temperature: 0.2, signal })).text;
    const prof = { ...(this.o.load() || {}), tone: merged.trim(), toneAt: Date.now() };
    this.o.save(prof); this.db.kvSet('style.tone', null);
    return prof;
  }
  similar(query, k = 3) {
    const n = this.count(); if (!n) return [];
    if (!this._bm || this._bmN !== n) { this._bm = new BM25(this.db.all("SELECT * FROM sent_index WHERE hash NOT LIKE '%:dup'").map(r => ({ row: r, text: `${r.subject} ${r.subject} ${r.context} ${r.reply.slice(0, 400)}` }))); this._bmN = n; }
    return this._bm.search(query, k);
  }
  profileText() {
    const p = this.o.load() || {};
    return [p.tone ? 'Tone and habits:\n' + p.tone : '', p.stats ? 'Measured habits:\n' + statsText(p.stats) : '', p.extra ? 'Notes from them:\n' + p.extra : ''].filter(Boolean).join('\n\n');
  }
  clear() { this.db.tx(() => { this.db.run('DELETE FROM sent_index'); this.db.run("DELETE FROM kv WHERE k LIKE 'style.%'"); }); this._bm = null; this.o.save(null); }
}

module.exports = { Style, splitReply, computeStats, statsText, greetingOf, signoffOf, BM25, tokenize };
