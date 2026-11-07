// Reply blocking: Letterhead must never send a reply, even from a queued drafts batch.
// Local only: in-process hoodiecrow IMAP and a counting mock SMTP transport. No real mail.
const assert = require('assert');
const hoodiecrow = require('hoodiecrow-imap');
const { ImapFlow } = require('imapflow');
const E = require('../src/engine'), D = require('../src/drafts'), G = require('../src/replyguard');

// ---------- detection ----------
const yes = ['Re: hi', 'RE: hi', 're:hi', 'Re[2]: x', 'RE(3): x', 'Fwd: x', 'FW: x', '[lab] Re: x', 'AW: Frage', 'SV: hej', 'Odp: x', 'RIF: x', 'Antw: x', 'Ответ: x', '回复：你好', '答复: x', '返信: x', '회신: x', 'رد: x', 'Re：x'];
const no = ['Hello', 'Research question', 'Regarding your paper', 'Interested in your work on BCI', 'Summer research assistant, inner speech decoding', 'Reaching out', 'Fwding is not a word', 'Resume attached', ''];
for (const s of yes) assert(G.subjectReason(s), 'should block subject ' + s);
for (const s of no) assert(!G.subjectReason(s), 'should allow subject ' + s);
assert(G.rawReplyReason('To: a@b.example\r\nIN-REPLY-TO: <x@y>\r\nSubject: Hello\r\n\r\nbody'), 'uppercase In-Reply-To');
assert(G.rawReplyReason('To: a@b.example\r\nreferences:\r\n <x@y>\r\n <z@y>\r\nSubject: Hello\r\n\r\nbody'), 'folded lowercase References');
assert(G.rawReplyReason('To: a@b.example\nSubject: =?UTF-8?B?UmU6IGhp?=\n\nbody'), 'encoded subject Re:');
assert(G.rawReplyReason('To: a@b.example\r\nSubject: =?x-unknown?Q?Hello?=\r\n\r\nb'), 'undecodable subject fails closed');
assert(G.rawReplyReason('this is not a message'), 'unparseable headers fail closed');
assert(G.rawReplyReason(''), 'empty source fails closed');
assert(G.rawReplyReason('To: a@b.example\r\nSubject: A\r\nSubject: Re: B\r\n\r\nx'), 'duplicate subject fails closed');
assert.strictEqual(G.rawReplyReason('To: a@b.example\r\nSubject: Hello there\r\n\r\nbody'), null, 'normal new email allowed');
assert(G.messageReplyReason({ subject: 'Hi', inReplyTo: '<x@y>' }));
assert(G.messageReplyReason({ subject: 'Hi', headers: { 'In-Reply-To': '<x@y>' } }));
assert(G.messageReplyReason(null));
assert.strictEqual(G.messageReplyReason({ subject: 'Hi Ada', text: 'x' }), null);
console.log('detection ok:', yes.length, 'reply subjects blocked,', no.length, 'normal subjects allowed, header/encoding/fail-closed cases ok');

// ---------- end to end over IMAP with a counting mock SMTP ----------
const FROM = 'From: Shabd <tester@example.com>';
const mk = (h, b = 'Hello there.') => ({ raw: [FROM, ...h, 'Content-Type: text/plain; charset=utf-8'].join('\r\n') + '\r\n\r\n' + b, flags: ['\\Draft'], internaldate: new Date() });
const drafts = [
  mk(['To: new@ok.example', 'Subject: Question about your decoder paper', 'Message-ID: <new-1@x>']),               // 1 normal
  mk(['To: hdr@reply.example', 'Subject: Following up', 'in-reply-to:', ' <orig@lab.example>', 'Message-ID: <hdr-1@x>']), // 2 header-only reply
  mk(['To: subj@reply.example', 'Subject: RE: your paper', 'Message-ID: <subj-1@x>']),                            // 3 subject-only reply
  mk(['To: later@edit.example', 'Subject: Intro', 'Message-ID: <edit-1@x>']),                                    // 4 edited into a reply later
];
const storage = { INBOX: { messages: [] }, '': { separator: '/', folders: { '[Gmail]': { flags: ['\\Noselect'], folders: { Drafts: { 'special-use': '\\Drafts', messages: drafts }, 'Sent Mail': { 'special-use': '\\Sent', messages: [] } } } } } };
const port = 1190;
const server = hoodiecrow({ plugins: ['ID', 'ENABLE', 'NAMESPACE', 'UNSELECT', 'UIDPLUS', 'SPECIAL-USE', 'LITERALPLUS', 'MOVE'], storage, users: { 'tester@example.com': { password: 'abcdabcdabcdabcd' } } });
const acct = { host: '127.0.0.1', port: 2599, security: 'none', user: 'tester@example.com', pass: 'abcdabcdabcdabcd', fromEmail: 'tester@example.com', imapHost: '127.0.0.1', imapPort: port, imapSecurity: 'none' };
const sent = [];
const factory = () => ({ sendMail: async m => { sent.push(m); return { messageId: '<m' + sent.length + '@t>' }; }, close() {} });
const mem = () => { let n = 0; return { count: () => n, record: () => n++ }; };
const done = c => new Promise(r => { const f = u => { if (['done', 'cancelled'].includes(u.state) && !u.item) { c.off('update', f); r(u); } }; c.on('update', f); });
const rcptOf = m => String(m.raw || '').match(/^To: (.*)$/m)?.[1] || m.to;

(async () => {
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const L = await D.listDrafts(acct);
  const by = s => L.drafts.find(d => d.subject === s);
  assert.strictEqual(by('Question about your decoder paper').replyBlocked, null, 'normal draft importable');
  assert(by('Following up').replyBlocked, 'header-only reply flagged on import');
  assert(by('RE: your paper').replyBlocked, 'subject-only reply flagged on import');
  assert.strictEqual(by('Intro').replyBlocked, null);
  console.log('import ok: header-only and subject-only replies flagged, normal drafts not');

  // the batch is queued *as if* made by an older version: no replyBlocked flags carried in.
  const items = L.drafts.map(d => ({ email: d.recipients[0], fields: {}, meta: { uid: d.uid, messageId: d.messageId, subject: d.subject, recipients: d.recipients } }));
  items.push({ email: 'legacy@x.example', fields: {}, meta: null });                                       // legacy item, no metadata
  items.push({ email: 'gone@x.example', fields: {}, meta: { uid: 9999, recipients: ['gone@x.example'] } }); // fetch failure

  // after queueing, draft 4 is edited into a reply (mail apps save edits as a new message, new UID)
  const cl = new ImapFlow({ ...D.imapOptions(acct) }); await cl.connect();
  const edit = by('Intro');
  await cl.append('[Gmail]/Drafts', [FROM, 'To: later@edit.example', 'Subject: Intro', 'Message-ID: <edit-1@x>', 'References: <thread@lab.example>', '', 'now a reply'].join('\r\n'), ['\\Draft']);
  let lock = await cl.getMailboxLock('[Gmail]/Drafts'); await cl.messageDelete(String(edit.uid), { uid: true }); lock.release();

  const c = new E.Campaign({ account: acct, mode: 'burst', usage: mem(), dailyCap: 0, recipients: items, transportFactory: factory,
    ...D.campaignHooks(acct, { folder: L.folder, sentFolder: L.sentFolder, gmail: true, deleteDraft: true, saveSent: true }) });
  c.start(); let u = await done(c);
  console.log('  first run stats', JSON.stringify(u.stats));
  for (const it of c.items) console.log(`   ${it.status.padEnd(7)} ${it.email} ${it.error || it.note || ''}`);
  assert.strictEqual(sent.length, 1, 'exactly one SMTP send');
  assert.strictEqual(rcptOf(sent[0]), 'new@ok.example', 'only the normal new email was sent');
  assert.strictEqual(u.stats.sent, 1); assert.strictEqual(u.stats.blocked, 4); assert.strictEqual(u.stats.failed, 1);
  const st = e => c.items.find(i => i.email === e).status;
  assert.strictEqual(st('hdr@reply.example'), 'blocked'); assert.strictEqual(st('subj@reply.example'), 'blocked');
  assert.strictEqual(st('later@edit.example'), 'blocked'); assert.strictEqual(st('legacy@x.example'), 'blocked');
  assert.strictEqual(st('gone@x.example'), 'failed');

  // retry path: blocked items are re-checked and blocked again, no new SMTP
  assert(c.retryFailed() >= 5); await done(c);
  assert.strictEqual(sent.length, 1, 'retry sent nothing new'); assert.strictEqual(c.stats().blocked, 4);
  console.log('retry ok: blocked drafts re-checked, still 0 extra SMTP');

  // blocked drafts are still in Drafts, unflagged; only the sent one was removed
  await cl.logout();
  const after = await D.listDrafts(acct);
  const subs = after.drafts.map(d => d.subject).sort();
  assert.deepStrictEqual(subs, ['Following up', 'Intro', 'RE: your paper']);
  console.log('drafts preserved:', subs.join(' | '));

  // merge batches and test sends go through the same gate
  sent.length = 0;
  const tpl = { subject: '{{prefix|Hello}} {{name}}', body: 'Hi {{name}}' };
  const m = new E.Campaign({ account: acct, mode: 'burst', usage: mem(), template: tpl, transportFactory: factory,
    recipients: [{ email: 'a@ok.example', fields: { name: 'Ada' } }, { email: 'b@ok.example', fields: { prefix: 'Re:', name: 'Bo' } }] });
  m.start(); u = await done(m);
  assert.strictEqual(sent.length, 1); assert.strictEqual(u.stats.blocked, 1); assert.strictEqual(sent[0].to, 'a@ok.example');
  const t = await E.sendTest(acct, { subject: 'Fwd: {{x}}', body: 'b' }, { x: 'y' }, factory);
  assert(!t.ok && sent.length === 1, 'test send blocked');
  // a messageBuilder returning unreadable raw fails closed
  const bad = new E.Campaign({ account: acct, mode: 'burst', usage: mem(), transportFactory: factory, recipients: [{ email: 'z@x.example', meta: {} }], messageBuilder: async () => ({ envelope: { to: ['z@x.example'] }, raw: Buffer.from('garbage without headers') }) });
  bad.start(); u = await done(bad); assert.strictEqual(u.stats.blocked, 1); assert.strictEqual(sent.length, 1);
  console.log('merge / test send / unparseable raw ok');
  console.log('\nALL REPLY GUARD TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
