// Energy regression test (pure Node, local SMTP on 2526). Guards the fixes from 2.2:
//  - waiting between emails and sitting paused cost (almost) no CPU: no polling loops
//  - a big batch does not rewrite batches.json per email (journal lines instead)
//  - the window gets at most about one list update a second, and the list has no recipients/items
//  - a crash mid batch loses nothing that the journal recorded
const { Scheduler } = require('../src/scheduler');
const E = require('../src/engine');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const acct = { host: '127.0.0.1', port: 2526, security: 'none', user: 'tester@example.com', pass: 'abcdabcdabcdabcd', fromEmail: 'tester@example.com' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const until = async (fn, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await sleep(25); } throw new Error('timeout'); };
const tpl = { subject: 'Hi {{first_name}}', body: 'Hello {{first_name}},\n\n' + 'A paragraph of a real letter. '.repeat(20) };
(async () => {
  // 1. a long interval wait and a long pause are idle
  let c = new E.Campaign({ account: acct, template: tpl, recipients: [{ email: 'a@x.example', fields: {} }, { email: 'b@x.example', fields: {} }], mode: 'interval', intervalMs: 4000, usage: { count: () => 0, record() {} } });
  c.start(); await until(() => c.state === 'waiting');
  let t0 = cpuMs(); await sleep(3000); const waitCost = cpuMs() - t0;
  c.pause('user'); t0 = cpuMs(); await sleep(2000); const pauseCost = cpuMs() - t0;
  console.log(`idle cost: waiting 3 s = ${waitCost.toFixed(1)} ms CPU, paused 2 s = ${pauseCost.toFixed(1)} ms CPU`);
  assert(waitCost < 40, 'waiting should not poll'); assert(pauseCost < 40, 'pause should not poll');
  c.resume(); await until(() => c.state === 'done'); assert.strictEqual(c.stats().sent, 2);
  console.log('resume after pause still sends the rest: ok');

  // 2. a 400 email batch through the scheduler
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-perf-')), file = path.join(dir, 'batches.json');
  const usage = { list: [], count() { return this.list.length; }, record() { this.list.push(Date.now()); } };
  const mk = () => new Scheduler({ file, autoTick: false, usage, getAccount: () => acct, getDailyCap: () => 0, getSetting: (k, d) => d, hooksFor: () => ({}), listThrottleMs: 1000 });
  const s = mk(); s.load();
  let emits = 0, emitBytes = 0; s.on('batches', l => { emits++; emitBytes += JSON.stringify(l).length; });
  const N = 400;
  const recipients = Array.from({ length: N }, (_, i) => ({ email: `prof${i}@lab${i % 30}.example`, fields: { first_name: 'Prof' + i, university: 'University ' + i, paper: 'A long paper title number ' + i } }));
  const snap0 = s.writes.snapshot;
  t0 = cpuMs(); const w0 = Date.now();
  const B = s.upsert({ name: 'Perf', kind: 'merge', merge: { recipients, subject: tpl.subject, body: tpl.body, attachments: [] }, scheduledAt: Date.now(), mode: 'burst' });
  await sleep(5); s.tick();
  await until(() => s.get(B.id).status === 'done', 120000);
  const wall = (Date.now() - w0) / 1000, cost = cpuMs() - t0;
  const snaps = s.writes.snapshot - snap0, lines = s.writes.journal;
  console.log(`${N} emails in ${wall.toFixed(1)} s: ${(cost / N).toFixed(2)} ms CPU each (scheduler + SMTP client), ${snaps} snapshot writes, ${lines} journal lines, ${emits} list updates (${Math.round(emitBytes / 1024)} KB)`);
  assert(snaps <= 6 + Math.ceil(wall / 60), 'batches.json rewritten too often: ' + snaps);
  assert(emits <= Math.ceil(wall) + 8, 'too many list updates for the window: ' + emits);
  const one = s.list().find(b => b.id === B.id);
  assert(!one.items && !one.merge && !one.drafts && one.stats.sent === N, 'list must be lean');
  console.log('list item for the window is', JSON.stringify(one).length, 'bytes');

  // 3. crash safety: journal is replayed on top of an older snapshot
  const C = s.upsert({ name: 'Crash', kind: 'merge', merge: { recipients: recipients.slice(0, 6), subject: 'x', body: 'y', attachments: [] }, scheduledAt: Date.now(), mode: 'interval', intervalMs: 300 });
  await sleep(5); s.tick(); await until(() => s.get(C.id).stats && s.get(C.id).stats.sent >= 3);
  s.saveNow(); // snapshot with 3 sent
  await until(() => s.get(C.id).stats.sent >= 5);
  const sentNow = s.get(C.id).items.filter(i => i.status === 'sent').map(i => i.id);
  s.active.cancel = () => {}; s.stop(); clearTimeout(s._compactT); clearTimeout(s._saveT); s._saveT = 1; s._compactT = 1; // crash: nothing else written
  const s2 = mk(); s2.load();
  const back = s2.get(C.id).items.filter(i => i.status === 'sent').map(i => i.id);
  console.log('after a crash: sent before crash', sentNow.join(','), '| restored as sent', back.join(','));
  for (const id of sentNow) assert(back.includes(id), 'lost a sent email in the crash: ' + id);
  assert.strictEqual(s2.get(C.id).status, 'missed');
  assert(!fs.existsSync(file + '.journal'), 'journal compacted after load');
  console.log('\nALL PERF TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
