const E = require('../src/engine'), D = require('../src/drafts');
const fs = require('fs'), assert = require('assert');
const base = { host: '127.0.0.1', port: 2525, security: 'none', user: 'tester@example.com', pass: 'abcdabcdabcdabcd', fromName: 'Shabd Warar', fromEmail: 'tester@example.com', imapHost: '127.0.0.1', imapSecurity: 'none' };
const mem = () => { let l = []; return { count: () => l.length, record: () => l.push(1) }; };
const done = c => new Promise(r => c.on('update', u => { if (u.state === 'done' || u.state === 'cancelled') r(u); }));
const delivered = () => fs.readFileSync('/tmp/mail1/log.txt', 'utf8').trim().split('\n').map(l => { const p = l.split(' '); return { rcpts: p.slice(1, -1), file: '/tmp/mail1/' + p[p.length - 1] }; });
async function run(flavor, port, mode) {
  const acct = { ...base, imapPort: port };
  const v = await D.verifyImap(acct); assert(v.ok, JSON.stringify(v));
  console.log(`\n[${flavor}] verify ok, drafts folder: ${v.drafts}, gmail detected: ${v.gmail}`);
  const bad = await D.verifyImap({ ...acct, pass: 'nope' }); assert(!bad.ok); console.log('  bad password ->', bad.error);
  const L = await D.listDrafts(acct);
  console.log(`  listed ${L.drafts.length} drafts in ${L.folder} (found via ${L.via}), sent folder ${L.sentFolder}`);
  for (const d of L.drafts) console.log(`   uid ${d.uid}: to=[${d.recipients.join(', ')}] subj="${d.subject}" att=${d.attachments.map(a => a.filename + ':' + a.size).join(',') || '-'} snippet="${d.snippet.slice(0, 50)}"`);
  const sendable = L.drafts.filter(d => d.recipients.length), flagged = L.drafts.filter(d => !d.recipients.length);
  assert.strictEqual(flagged.length, 1); assert.strictEqual(L.via, 'special-use');
  const before = fs.existsSync('/tmp/mail1/log.txt') ? delivered().length : 0;
  const c = new E.Campaign({
    account: acct, mode, intervalMs: 700, jitterPct: 10, usage: mem(), dailyCap: 500,
    recipients: sendable.map(d => ({ email: d.recipients[0], fields: {}, meta: { uid: d.uid, recipients: d.recipients } })),
    ...D.campaignHooks(acct, { folder: L.folder, sentFolder: L.sentFolder, gmail: L.gmail, deleteDraft: true, saveSent: true }),
  });
  c.on('log', l => l.kind === 'note' && console.log('   note:', l.email, l.text));
  const t0 = Date.now(); c.start(); const u = await done(c);
  console.log(`  ${mode}: ${JSON.stringify(u.stats)} in ${Date.now() - t0}ms`);
  assert.strictEqual(u.stats.sent, sendable.length);
  const got = delivered().slice(before);
  for (const g of got) {
    const raw = fs.readFileSync(g.file, 'utf8');
    assert(!/^bcc:/im.test(raw), 'Bcc header leaked'); assert(/^Date: /m.test(raw)); assert(!/draft-1@example.com/.test(raw), 'old Message-ID kept');
  }
  const first = got.find(g => g.rcpts.includes('maya.okafor@stanford.example'));
  assert.deepStrictEqual(first.rcpts.sort(), ['labmgr@stanford.example', 'maya.okafor@stanford.example', 'shabd.archive@example.com']);
  const raw1 = fs.readFileSync(first.file, 'utf8');
  assert(/Shabd_Warar_Resume\.pdf/.test(raw1) && /text\/html/.test(raw1) && /Cc: Lab Manager/.test(raw1));
  console.log('  envelope for draft 1 ->', first.rcpts.join(', '), '| Bcc header stripped, Cc kept, HTML + PDF intact');
  const bccOnly = got.find(g => g.rcpts.includes('hsato@cmu.example')); assert.deepStrictEqual(bccOnly.rcpts.sort(), ['hsato@cmu.example', 'tlind@uw.example']);
  const after = await D.listDrafts(acct);
  console.log(`  drafts left after send: ${after.drafts.length} (${after.drafts.map(d => '"' + d.subject + '"').join(', ')})`);
  assert.strictEqual(after.drafts.length, 1);
  // check Sent folder contents
  const sentCount = await (async () => { const { ImapFlow } = require('imapflow'); const cl = new ImapFlow({ ...D.imapOptions(acct) }); await cl.connect(); const st = await cl.status(L.sentFolder, { messages: true }); await cl.logout(); return st.messages; })();
  console.log(`  messages in ${L.sentFolder}: ${sentCount} (${L.gmail ? 'expected 0, Gmail saves SMTP sends itself' : 'expected ' + sendable.length + ', appended by Letterhead'})`);
  assert.strictEqual(sentCount, L.gmail ? 0 : sendable.length);
  // a draft that vanished mid-run fails cleanly
  const c2 = new E.Campaign({ account: acct, mode: 'burst', usage: mem(), recipients: [{ email: 'x@y.example', meta: { uid: 9999, recipients: ['x@y.example'] } }], ...D.campaignHooks(acct, { folder: L.folder, deleteDraft: true }) });
  c2.start(); const u2 = await done(c2); console.log('  missing draft ->', u2.stats.failed, 'failed:', c2.items[0].error); assert.strictEqual(u2.stats.failed, 1);
}
(async () => {
  await run('gmail-like', 1143, 'interval');
  await run('generic', 1144, 'burst');
  console.log('\nALL DRAFTS TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
