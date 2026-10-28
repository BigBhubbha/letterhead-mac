const E = require('../src/engine');
const fs = require('fs'), assert = require('assert');
const acct = { host: '127.0.0.1', port: 2525, security: 'none', user: 'tester@example.com', pass: 'abcdabcdabcdabcd', fromName: 'Shabd Warar', fromEmail: 'tester@example.com' };
const tpl = { subject: 'RA inquiry for {{university|your lab}}', body: 'Dear Dr. {{last_name}},\n\nI read your paper at {{university}}. See https://example.com/cv.\n\nBest,\nShabd', attachments: [__dirname + '/resume.pdf'] };
fs.writeFileSync(__dirname + '/resume.pdf', '%PDF-1.4 fake resume');
const mk = n => Array.from({ length: n }, (_, i) => ({ email: `prof${i}@uni.edu`, fields: { email: `prof${i}@uni.edu`, last_name: 'Smith' + i, university: i % 2 ? 'MIT' : '' } }));
const memUsage = () => { let l = []; return { count: () => l.length, record: () => l.push(Date.now()), oldest: () => l[0] }; };
const done = c => new Promise(r => c.on('update', u => { if (u.state === 'done' || u.state === 'cancelled') r(u); }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // merge
  assert.strictEqual(E.merge('Hi {{First Name}} at {{uni|your school}}', { first_name: 'Ada' }), 'Hi Ada at your school');
  assert.deepStrictEqual(E.missingFields('{{a}} {{b|x}}', {}), ['a']);
  console.log('merge ok');

  let r = await E.verifyAccount(acct); assert(r.ok, JSON.stringify(r)); console.log('verify ok');
  r = await E.verifyAccount({ ...acct, pass: 'wrong' }); assert(!r.ok); console.log('verify bad pass ->', r.error);
  r = await E.sendTest(acct, tpl, mk(2)[1].fields); assert(r.ok); console.log('test send ok ->', r.to);

  // burst mode, with one bounce
  let list = mk(10); list[3] = { email: 'bounce@uni.edu', fields: { email: 'bounce@uni.edu', last_name: 'X', university: 'Y' } };
  let c = new E.Campaign({ account: acct, template: tpl, recipients: list, mode: 'burst', usage: memUsage(), dailyCap: 500 });
  let t0 = Date.now(); c.start(); let u = await done(c);
  console.log('burst:', u.stats, (Date.now() - t0) + 'ms');
  assert.strictEqual(u.stats.sent, 9); assert.strictEqual(u.stats.failed, 1);
  console.log('  failed note:', c.items[3].error);

  // retry failed (still bounces)
  c.retryFailed(); u = await done(c); assert.strictEqual(u.stats.failed, 1); assert.strictEqual(c.items[3].attempts, 2); console.log('retry ok, attempts', c.items[3].attempts);
  fs.writeFileSync('/tmp/results.csv', E.resultsCsv(c.items)); console.log('csv:\n' + fs.readFileSync('/tmp/results.csv', 'utf8').split('\n').slice(0, 5).join('\n'));

  // interval mode: 4 emails every 1.5s +/- 20%
  c = new E.Campaign({ account: acct, template: tpl, recipients: mk(4), mode: 'interval', intervalMs: 1500, jitterPct: 20, usage: memUsage(), dailyCap: 500 });
  const times = []; c.on('update', x => { if (x.item && x.item.status === 'sent') times.push(x.item.sentAt); });
  t0 = Date.now(); c.start(); u = await done(c);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  console.log('interval: sent', u.stats.sent, 'gaps', gaps);
  assert(gaps.every(g => g >= 1150 && g <= 1900));

  // pause / resume during an interval wait
  c = new E.Campaign({ account: acct, template: tpl, recipients: mk(3), mode: 'interval', intervalMs: 1000, jitterPct: 0, usage: memUsage() });
  const tt = []; c.on('update', x => { if (x.item && x.item.status === 'sent') tt.push(x.item.sentAt); });
  c.start(); await sleep(400); c.pause('user'); await sleep(2000); assert.strictEqual(c.stats().sent, 1); c.resume(); u = await done(c);
  console.log('pause/resume: sent', u.stats.sent, 'gap across pause', tt[1] - tt[0], 'ms (expect ~3000)');
  assert(tt[1] - tt[0] > 2500);

  // cancel
  c = new E.Campaign({ account: acct, template: tpl, recipients: mk(5), mode: 'interval', intervalMs: 800, usage: memUsage() });
  c.start(); await sleep(1200); c.cancel(); u = await done(c);
  console.log('cancel:', u.stats); assert(u.stats.skipped >= 2);

  // daily cap
  const us = memUsage(); for (let i = 0; i < 498; i++) us.record();
  c = new E.Campaign({ account: acct, template: tpl, recipients: mk(5), mode: 'burst', usage: us, dailyCap: 500 });
  let paused = new Promise(res => c.on('update', x => x.state === 'paused' && res(x)));
  c.start(); u = await paused; console.log('cap:', u.stats, '|', u.pauseReason); assert.strictEqual(u.stats.sent, 2); c.cancel(); await sleep(300);

  // auth failure pauses rather than failing everyone
  c = new E.Campaign({ account: { ...acct, pass: 'nope' }, template: tpl, recipients: mk(3), mode: 'burst', usage: memUsage() });
  paused = new Promise(res => c.on('update', x => x.state === 'paused' && res(x)));
  c.start(); u = await paused; console.log('auth:', u.stats, '|', u.pauseReason); assert.strictEqual(u.stats.queued, 3); c.cancel(); await sleep(300);
  console.log('ALL ENGINE TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
