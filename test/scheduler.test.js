// Scheduler with a fake clock, against the local SMTP (2525) and IMAP (1143, Gmail-like) test servers.
const { Scheduler } = require('../src/scheduler');
const D = require('../src/drafts');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const acct = { host: '127.0.0.1', port: 2525, security: 'none', user: 'tester@example.com', pass: 'abcdabcdabcdabcd', fromName: 'Shabd Warar', fromEmail: 'tester@example.com', imapHost: '127.0.0.1', imapPort: 1143, imapSecurity: 'none' };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-sched-')), file = path.join(dir, 'batches.json');
let T = Date.parse('2026-10-28T08:00:00-05:00');
const clock = () => T;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let usageList = []; const usage = { count: () => usageList.length, record: () => usageList.push(T) };
let cap = 500;
const mk = () => new Scheduler({ file, now: clock, autoTick: false, usage, getAccount: () => acct, getDailyCap: () => cap, getSetting: (k, d) => d, hooksFor: (a, c) => D.campaignHooks(a, c) });
const rcpts = (n, tag) => Array.from({ length: n }, (_, i) => ({ email: `${tag}${i}@lab.example`, fields: { first_name: tag + i } }));
const merge = (n, tag) => ({ recipients: rcpts(n, tag), columns: ['email', 'first_name'], subject: `Hello {{first_name}} (${tag})`, body: 'Hi {{first_name}},\n\nTest from batch ' + tag, attachments: [] });
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await sleep(50); } throw new Error('timeout'); };
const st = (s, id) => s.get(id).status;
(async () => {
  let s = mk(); s.load(); const notes = []; s.on('notify', n => notes.push(n.title));
  const A = s.upsert({ name: 'Stanford labs', kind: 'merge', merge: merge(3, 'a'), scheduledAt: T + 60000, mode: 'burst' });
  const B = s.upsert({ name: 'MIT labs', kind: 'merge', merge: merge(3, 'b'), scheduledAt: T + 60000, mode: 'interval', intervalMs: 400, jitterPct: 0 });
  const C = s.upsert({ name: 'Later', kind: 'merge', merge: merge(2, 'c'), scheduledAt: T + 3600000, mode: 'burst' });
  await sleep(20); s.tick();
  assert.strictEqual(st(s, A.id), 'scheduled'); console.log('before due: all scheduled');
  T += 61000; s.tick();
  assert.strictEqual(st(s, A.id), 'sending'); assert.strictEqual(st(s, B.id), 'queued');
  console.log('at due time: A sending, B queued behind it (overlap runs one after another), queueAhead =', s.publicBatch(s.get(B.id)).queueAhead);
  await until(() => st(s, A.id) === 'done'); await sleep(50); s.tick();
  await until(() => st(s, B.id) === 'done');
  console.log('A then B done:', s.get(A.id).stats, s.get(B.id).stats);
  const tA = Math.max(...s.get(A.id).items.map(i => i.sentAt)), tB = Math.min(...s.get(B.id).items.map(i => i.sentAt));
  assert(tB >= tA, 'B started before A finished');
  assert.strictEqual(st(s, C.id), 'scheduled');
  // shared daily cap across batches
  cap = usageList.length + 2;
  const E = s.upsert({ name: 'Cap test', kind: 'merge', merge: merge(4, 'e'), scheduledAt: T, mode: 'burst' });
  await sleep(10); s.tick();
  await until(() => st(s, E.id) === 'paused');
  console.log('cap: paused after', s.get(E.id).stats.sent, 'with reason:', s.get(E.id).pauseReason);
  assert.strictEqual(s.get(E.id).stats.sent, 2);
  cap = 500; s.tick(); await until(() => st(s, E.id) === 'done');
  console.log('cap freed: auto resumed and finished', s.get(E.id).stats);
  // asleep at the scheduled time: tick happens well after due time -> missed, nothing sent
  T += 3600000 + 10 * 60000; const before = usageList.length; s.tick();
  assert.strictEqual(st(s, C.id), 'missed'); assert.strictEqual(usageList.length, before);
  console.log('Mac asleep past due time: C is', st(s, C.id), 'reason', s.get(C.id).missedReason, ', nothing sent');
  s.sendNow(C.id); await sleep(10); s.tick(); await until(() => st(s, C.id) === 'done'); console.log('Send now after missed: C', st(s, C.id));
  // duplicate, cancel, reschedule
  const Dup = s.duplicate(A.id); assert.strictEqual(Dup.status, 'scheduled'); s.cancel(Dup.id); assert.strictEqual(st(s, Dup.id), 'cancelled');
  s.reschedule(Dup.id, T + 5000); assert.strictEqual(st(s, Dup.id), 'scheduled'); console.log('duplicate, cancel, reschedule ok');
  // drafts batch: pick drafts now, send later; one draft edited meanwhile (new UID, same Message-ID)
  const L = await D.listDrafts(acct);
  const pick = L.drafts.filter(d => d.recipients.length).slice(0, 2).map(d => ({ uid: d.uid, messageId: d.messageId, subject: d.subject, recipients: d.recipients }));
  pick[0].uid = 9999; // simulate the mail app re-saving the draft under a new UID
  const DR = s.upsert({ name: 'Drafts for Friday', kind: 'drafts', drafts: { folder: L.folder, sentFolder: L.sentFolder, gmail: L.gmail, items: pick }, scheduledAt: T + 1000, mode: 'interval', intervalMs: 300 });
  // persistence: restart the scheduler before it is due
  s.saveNow(); s = mk(); const missed0 = s.load(); assert.strictEqual(missed0.length, 0); assert.strictEqual(st(s, DR.id), 'scheduled');
  console.log('restart before due: batches restored,', s.batches.length, 'batches, nothing missed');
  T += 1500; s.tick(); await until(() => ['done', 'failed'].includes(st(s, DR.id)));
  console.log('drafts batch:', st(s, DR.id), s.get(DR.id).items.map(i => `${i.email} ${i.status}${i.note ? ' (' + i.note + ')' : ''}${i.error ? ' ' + i.error : ''}`));
  assert.strictEqual(s.get(DR.id).stats.sent, 2);
  // interrupted mid send, then app relaunch
  const I = s.upsert({ name: 'Interrupted', kind: 'merge', merge: merge(5, 'i'), scheduledAt: T, mode: 'interval', intervalMs: 5000 });
  await sleep(10); s.tick(); await until(() => s.get(I.id).stats && s.get(I.id).stats.sent === 1);
  s.saveNow(); s.active.cancel = () => {}; // simulate a crash: no cleanup
  const s2 = mk(); const missed = s2.load();
  assert(missed.includes(I.id)); assert.strictEqual(st(s2, I.id), 'missed');
  console.log('relaunch after crash: batch is', st(s2, I.id), '(' + s2.get(I.id).missedReason + '), items', s2.get(I.id).items.map(i => i.status).join(','));
  // past due at launch
  const L2 = s2.upsert({ name: 'Due while closed', kind: 'merge', merge: merge(1, 'l'), scheduledAt: T + 1000, mode: 'burst' });
  s2.saveNow(); T += 30 * 60000; const s3 = mk(); const m3 = s3.load();
  assert(m3.includes(L2.id)); console.log('launch after closed past due:', st(s3, L2.id), s3.get(L2.id).missedReason, ', never sent automatically');
  console.log('notifications:', notes.join(' | '));
  console.log('\nALL SCHEDULER TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
