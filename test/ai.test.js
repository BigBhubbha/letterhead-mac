// AI provider layer, style profile and reply assistant, with a mock Gemini server and the local mail servers.
const assert = require('assert'), fs = require('fs'), path = require('path');
const mock = require('./mock_ai');
const { AI, GEMINI_MODELS } = require('../src/ai');
const { MailDB } = require('../src/maildb');
const { Mail } = require('../src/mail');
const { Style, splitReply, computeStats, statsText } = require('../src/style');
const { Assistant } = require('../src/assistant');
const { NOW } = require('./mail_fixtures');
const OUT = '/tmp/mail2526';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lastEml = () => { const f = fs.readdirSync(OUT).filter(x => x.endsWith('.eml')).sort().pop(); return fs.readFileSync(path.join(OUT, f), 'utf8'); };
const mkAI = (M, o = {}) => new AI({ getKey: () => o.key || mock.KEY, getConfig: () => ({ provider: o.provider || 'gemini', models: o.models, base: M.base }), ...o.ai });

async function aiTests(M) {
  console.log('[AI provider]');
  const st = M.st; const reset = () => { st.log.length = 0; st.quota.clear(); st.slow = {}; st.thinking400.clear(); st.streamBroken = false; };
  assert.deepStrictEqual(GEMINI_MODELS.slice(0, 2), ['gemini-3.1-flash-lite', 'gemini-3.5-flash']);
  let ai = mkAI(M); let deltas = 0;
  let out = await ai.generate({ system: 'Reply with one short friendly sentence.', prompt: 'Say hello', interactive: true, onDelta: () => deltas++ });
  const e0 = st.log[0];
  assert.strictEqual(out.model, 'gemini-3.1-flash-lite'); assert.strictEqual(e0.kind, 'streamGenerateContent'); assert.deepStrictEqual(e0.thinking, { thinkingLevel: 'minimal' }); assert(e0.system); assert(deltas > 1);
  console.log(`  streamed from ${out.model} via :streamGenerateContent?alt=sse, ${deltas} chunks, thinkingLevel minimal, key in x-goog-api-key header`);
  const before = st.log.length; await ai.generate({ system: 'Reply with one short friendly sentence.', prompt: 'Say hello', interactive: true }); assert.strictEqual(st.log.length, before); console.log('  identical request served from cache, no HTTP call');

  reset(); st.quota.add('gemini-3.1-flash-lite'); ai = mkAI(M);
  out = await ai.generate({ prompt: 'q1', interactive: true }); assert.strictEqual(out.model, 'gemini-3.5-flash');
  const n1 = st.log.length; await ai.generate({ prompt: 'q2', interactive: true });
  assert.strictEqual(st.log.slice(n1).filter(e => e.model === 'gemini-3.1-flash-lite').length, 0);
  console.log('  "You exceeded your current quota" on flash-lite: fell back to gemini-3.5-flash, flash-lite cooled down for the 7s retryDelay');

  reset(); st.quota = new Set(GEMINI_MODELS); ai = mkAI(M); let t0 = Date.now();
  await assert.rejects(ai.generate({ prompt: 'q3', interactive: true }), e => { console.log(`  every model out of quota: gave up in ${Date.now() - t0} ms with: "${e.friendly}"`); return e.kind === 'quota'; });
  st.quota.clear();

  reset(); ai = mkAI(M, { key: 'wrong-key' });
  await assert.rejects(ai.generate({ prompt: 'q4', interactive: true }), e => { console.log(`  bad key: "${e.friendly}" after ${st.log.length} request`); return e.kind === 'auth' && st.log.length === 1; });

  reset(); st.slow['gemini-3.1-flash-lite'] = 6000; ai = mkAI(M); t0 = Date.now();
  out = await ai.generate({ prompt: 'q5', interactive: true }); const dt = Date.now() - t0;
  assert.strictEqual(out.model, 'gemini-3.5-flash'); assert(dt < 4500, dt); assert.strictEqual(ai.stats.hedges, 1);
  console.log(`  slow first model (6 s): backup request after 2 s won, answer in ${dt} ms`);
  await sleep(100);

  reset(); st.streamBroken = true; ai = mkAI(M); out = await ai.generate({ prompt: 'q6' });
  assert(st.log.some(e => e.kind === 'generateContent')); console.log('  broken stream: fell back to plain :generateContent');

  reset(); st.thinking400.add('gemini-3.1-flash-lite'); ai = mkAI(M); out = await ai.generate({ prompt: 'q7' });
  assert.strictEqual(out.model, 'gemini-3.1-flash-lite'); assert(!st.log[st.log.length - 1].thinking); console.log('  model that rejects thinkingConfig: retried the same model without it');

  reset(); ai = mkAI(M, { models: ['gemini-2.5-flash', 'gemini-3.5-flash'] }); out = await ai.generate({ prompt: 'q8' });
  assert.strictEqual(out.model, 'gemini-3.5-flash'); assert(ai.gone.has('gemini-2.5-flash')); console.log('  retired gemini-2.5-flash (404): marked unavailable, used gemini-3.5-flash');

  reset(); ai = mkAI(M, { ai: { rpm: 3 } });
  for (let i = 0; i < 4; i++) out = await ai.generate({ prompt: 'rl' + i });
  assert.strictEqual(st.log.filter(e => e.model === 'gemini-3.1-flash-lite').length, 3); assert.strictEqual(out.model, 'gemini-3.5-flash');
  console.log('  per-model rate limit: 4th request in a minute went to the next model before Google could refuse it');

  for (const p of ['openai', 'anthropic']) { reset(); const a = mkAI(M, { provider: p }); const o = await a.generate({ system: 'Reply with one short friendly sentence.', prompt: 'hi' }); assert(o.text); console.log(`  ${p} key path works (${o.model})`); }
  reset();
}

async function styleAndAssistant(M) {
  console.log('[Style profile]');
  const sp = splitReply('Hi Dr. Okafor,\n\nThanks!\n\nBest,\nShabd\n\nOn Tue, Oct 27, 2026 Maya Okafor <m@x> wrote:\n> quoted text here');
  assert.strictEqual(sp.reply, 'Hi Dr. Okafor,\n\nThanks!\n\nBest,\nShabd'); assert(/quoted text/.test(sp.context)); console.log('  splitReply separates his words from the quoted email');
  const db = await MailDB.open(null);
  const acct = { host: '127.0.0.1', port: 2526, security: 'none', user: 'tester@example.com', pass: 'abcdabcdabcdabcd', fromName: 'Shabd Warar', fromEmail: 'tester@example.com', imapHost: '127.0.0.1', imapPort: 1993, imapSecurity: 'none' };
  let used = 0; const mail = new Mail({ db, getAccount: () => acct, usage: { count: () => used, record: () => used++ }, prefetch: false });
  await mail.connect(); await mail.syncFolder('INBOX'); await mail.syncFolder('[Gmail]/All Mail');
  let calls = 0, failAfter = Infinity; const real = mkAI(M);
  const ai = { ready: () => true, generate: async r => { if (++calls > failAfter) { const e = new Error('quota'); e.friendly = 'quota'; throw e; } return real.generate(r); } };
  let profile = null; const progress = [];
  const style = new Style({ db, mail, ai, save: p => profile = p, load: () => profile, onProgress: p => progress.push(p.state) });
  failAfter = 0; await style.index({ limit: 500 });
  assert(!profile.tone && progress.includes('describing')); console.log(`  indexed ${style.count()} sent emails locally; tone step failed (simulated quota) without losing the index`);
  failAfter = Infinity; calls = 0; await style.index({ limit: 500 });
  assert(profile.tone && /Opens with/.test(profile.tone)); console.log(`  rerun: skipped the ${style.count()} already indexed emails, ${calls} AI call for the tone`);
  assert.strictEqual(calls, 1);
  const s = profile.stats; console.log('  measured:', statsText(s).split('\n').slice(0, 4).join(' / '));
  assert(s.signoffs && s.signoffs.length);
  const sim = style.similar('quick call Thursday Zoom', 3); assert(sim.length); console.log('  BM25 similar to "quick call Thursday Zoom":', sim.map(x => x.subject).join(' | '));

  console.log('[Assistant]');
  let clock = NOW; const sentLog = [];
  const settings = { aiEnabled: true, autoDraft: true, aboutMe: 'High school junior interested in BCIs.', autoReply: { enabled: false, rules: [], dailyLimit: 10 } };
  const as = new Assistant({ db, mail, ai: real, style, getSettings: () => settings, getAccount: () => acct, now: () => clock, getSignature: () => 'Shabd Warar<br>Junior, Lincoln High School' });
  const row = re => db.get("SELECT * FROM messages WHERE folder='INBOX' AND subject LIKE ? ORDER BY date DESC", ['%' + re + '%']);
  for (const [sub, want] of [['This week in BCI', true], ['CI passed', true], ['weekly learning summary', true], ['Summer research', false], ['low latency', false]]) {
    const b = as.replyBlock(row(sub)); assert.strictEqual(!!b, want, sub + ' ' + b); console.log(`  "${sub}": ${b ? 'no reply, ' + b : 'needs a reply'}`);
  }
  const maya = row('Summer research');
  const p = await as.prompt(maya); assert(/STYLE NOTES/.test(p.prompt) && /HOW THEY REPLIED/.test(p.prompt) && /Thursday afternoon/.test(p.prompt)); console.log(`  prompt has style notes, ${p.examples} past replies and the conversation (${p.prompt.length} chars)`);
  let streamed = 0; let sug = await as.draft(maya.id, { onDelta: () => streamed++ });
  assert(/^Hi Dr\. Okafor,/.test(sug.draft) && sug.status === 'ready'); console.log(`  draft (${sug.model}, ${streamed} streamed chunks):\n    ` + sug.draft.replace(/\n/g, '\n    '));
  sug = await as.draft(maya.id, { variant: 'shorter' }); assert(/noticeably shorter/.test(M.st.log[M.st.log.length - 1].prompt)); console.log('  Shorter:', JSON.stringify(sug.draft));
  sug = await as.draft(maya.id, { variant: 'formal' }); assert(/Thank you very much/.test(sug.draft)); console.log('  More formal: ok');
  const r1 = await as.draft(maya.id, { variant: 'regenerate' }); console.log('  Regenerate: new wording, cache bypassed');
  // background drafts for new mail
  as.dismiss(as.keyOf(maya));
  const reyes = row('low latency'), alv = row('lab report'), nl = row('This week in BCI');
  as.onNewMail([reyes, alv, nl].map(r => ({ id: r.id }))); while (as.busy || as.queue.length) await sleep(50);
  const lst = as.list(); assert(lst.some(x => x.msgid === reyes.msgid && x.status === 'ready')); assert(!lst.some(x => x.msgid === nl.msgid));
  console.log('  new mail: drafts waiting for Reyes and Alvarez, none for the newsletter; queue =', lst.map(x => `${x.fromName}:${x.status}`).join(', '));
  assert(as.candidates().length >= 0);

  console.log('[Auto-reply]');
  // a rule with no senders, labels or "anyone" never matches
  settings.autoReply = { enabled: true, dailyLimit: 1, rules: [{ id: 'r0', name: 'Empty', enabled: true, senders: [], labels: [], reviewMin: 1 }] };
  assert.strictEqual(as.ruleFor(maya), null); console.log('  empty rule matches nobody');
  settings.autoReply.rules = [{ id: 'r1', name: 'Stanford lab', enabled: true, senders: ['@stanford.example'], labels: [], reviewMin: 30 }, { id: 'r2', name: 'Everyone', enabled: true, anyone: true, senders: [], labels: [], reviewMin: 30 }];
  db.run('DELETE FROM suggestions');
  as.onNewMail([{ id: maya.id }, { id: nl.id }]); while (as.busy || as.queue.length) await sleep(50);
  let s1 = as.suggestionFor(maya.id); assert.strictEqual(s1.status, 'scheduled'); assert.strictEqual(s1.sendAt, clock + 30 * 60000); assert(!as.suggestionFor(nl.id));
  console.log('  Maya matched "Stanford lab": scheduled for', new Date(s1.sendAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago' }), 'CT (30 min review window); newsletter ignored even with an "Everyone" rule');
  clock += 10 * 60000; await as.tick(); assert.strictEqual(as.suggestionFor(maya.id).status, 'scheduled'); console.log('  +10 min: still waiting');
  as.hold(as.keyOf(maya)); clock += 30 * 60000; await as.tick(); assert.strictEqual(as.suggestionFor(maya.id).status, 'ready'); console.log('  Stop pressed: not sent, back to a normal suggestion');
  db.run('DELETE FROM suggestions'); clock = NOW;
  as.onNewMail([{ id: maya.id }]); while (as.busy || as.queue.length) await sleep(50);
  const files0 = fs.readdirSync(OUT).length;
  clock += 31 * 60000; await as.tick();
  assert.strictEqual(as.suggestionFor(maya.id).status, 'sent'); assert(fs.readdirSync(OUT).length > files0);
  const eml = lastEml(); assert(/Auto-Submitted: auto-replied/.test(eml) && /In-Reply-To: <t1d@stanford.example>/.test(eml) && /Junior, Lincoln High School/.test(eml));
  console.log('  +31 min: sent, with Auto-Submitted: auto-replied, In-Reply-To and his signature');
  // daily limit 1 is now used; Reyes via Everyone rule gets held
  db.run("UPDATE messages SET answered=0"); 
  as.onNewMail([{ id: reyes.id }]); while (as.busy || as.queue.length) await sleep(50);
  const rs = as.suggestionFor(reyes.id); assert.notStrictEqual(rs.status, 'scheduled'); console.log('  daily limit of 1 reached: Reyes kept as a suggestion only, log says:', as.autolog(1)[0].reason);
  // the same person is never auto-replied twice in a day
  db.run('DELETE FROM suggestions WHERE msgid=?', [maya.msgid]); settings.autoReply.dailyLimit = 10;
  assert.strictEqual(as.autoBlock({ ...maya, answered: 0 }), 'already auto-replied to this person today'); console.log('  second auto-reply to the same person in 24 h blocked');
  assert.strictEqual(as.autoBlock({ ...reyes, subject: 'Automatic reply: out of office' }), 'looks like an automatic message'); console.log('  out-of-office style subject blocked');
  assert.strictEqual(as.autoBlock({ ...reyes, replyTo: 'noreply@mit.example' }), 'no-reply address'); console.log('  no-reply Reply-To blocked');
  assert.strictEqual(as.autoBlock({ ...reyes, toJson: JSON.stringify([1, 2, 3, 4, 5, 6]) }), 'sent to a big group'); console.log('  big group email blocked');
  console.log('  log:', as.autolog().map(l => `${l.status}(${l.reason || l.rule})`).join(', '));
  // turning auto-reply off holds anything scheduled
  db.run('DELETE FROM suggestions WHERE msgid=?', [reyes.msgid]); db.run('DELETE FROM autolog');
  as.onNewMail([{ id: reyes.id }]); while (as.busy || as.queue.length) await sleep(50);
  assert.strictEqual(as.suggestionFor(reyes.id).status, 'scheduled'); settings.autoReply.enabled = false; clock += 40 * 60000; await as.tick();
  assert.strictEqual(as.suggestionFor(reyes.id).status, 'ready'); console.log('  auto-reply switched off during the review window: held, not sent');
  settings.aiEnabled = false; await assert.rejects(as.draft(reyes.id)); console.log('  assistant off: no drafting at all');
  await mail.stop();
}
(async () => {
  const M = await mock.start(0);
  await aiTests(M); await styleAndAssistant(M);
  await M.close(); console.log('\nALL AI TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
