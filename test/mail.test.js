// Mail client against local hoodiecrow IMAP (Gmail-like on 1993, generic on 1994) and aiosmtpd on 2526.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { ImapFlow } = require('imapflow');
const { MailDB } = require('../src/maildb');
const { Mail } = require('../src/mail');
const OUT = process.env.SMTP_OUT || '/tmp/mail2526';
const acct = port => ({ host: '127.0.0.1', port: 2526, security: 'none', user: 'tester@example.com', pass: 'abcdabcdabcdabcd', fromName: 'Shabd Warar', fromEmail: 'tester@example.com', imapHost: '127.0.0.1', imapPort: port, imapSecurity: 'none' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lastEml = () => { const f = fs.readdirSync(OUT).filter(x => x.endsWith('.eml')).sort().pop(); return fs.readFileSync(path.join(OUT, f), 'utf8'); };
let used = 0; const usage = { count: () => used, record: () => used++ };
async function gmail() {
  console.log('[gmail]');
  const db = await MailDB.open(null);
  const m = new Mail({ db, getAccount: () => acct(1993), usage, prefetch: false, getDailyCap: () => 500 });
  await m.connect(); assert(m.gmail);
  const f = m.folders().map(x => `${x.name}${x.special ? '(' + x.special + ')' : ''}`); console.log('  folders:', f.join(', '));
  await m.syncFolder('INBOX'); await m.syncFolder('[Gmail]/All Mail'); await m.syncFolder('[Gmail]/Sent Mail');
  let t = m.threads('INBOX'); console.log('  inbox conversations:', t.total);
  const conv = t.items.find(i => /Summer research/.test(i.subject));
  console.log('  thread list row:', conv.subject, '| messages', conv.count, '| people', conv.people.join(', '), '| unread', conv.unread, '| attachment', conv.hasAtt);
  assert.strictEqual(conv.count, 4);
  const th = await m.thread(conv.thread); assert.strictEqual(th.length, 4); console.log('  X-GM-THRID thread:', th.map(x => x.fromAddr.split('@')[0]).join(' > '));
  const last = th[th.length - 1];
  const body = await m.body(last.folder, last.uid);
  assert(body.html.includes('data:image/png')); assert(body.attachments.find(a => a.inline && a.dataUrl)); assert(body.attachments.find(a => a.filename === 'SIMR_2027_overview.pdf'));
  console.log('  body: html + inline cid image as data URL + PDF attachment');
  const pdf = await m.attachment(last.folder, last.uid, body.attachments.findIndex(a => a.filename.endsWith('.pdf')));
  assert(pdf.content.toString().startsWith('%PDF')); console.log('  attachment download:', pdf.filename, pdf.content.length, 'bytes');
  const nl = t.items.find(i => /This week in BCI/.test(i.subject)); assert(nl.bulk); console.log('  newsletter flagged as bulk:', nl.bulk);
  // read / star
  await m.action({ op: 'read', thread: conv.thread }); await m.syncFolder('INBOX');
  assert.strictEqual(m.threads('INBOX').items.find(i => i.thread === conv.thread).unread, 0); console.log('  mark read: synced back from server, unread 0');
  await m.action({ op: 'star', thread: conv.thread }); await m.syncFolder('INBOX');
  assert(m.threads('INBOX').items.find(i => i.thread === conv.thread).flagged); console.log('  star: \\Flagged on the latest message');
  // label (Gmail X-GM-LABELS)
  const reyes = t.items.find(i => /low latency/.test(i.subject));
  await m.action({ op: 'label', thread: reyes.thread, arg: 'Research' });
  const lab = await m.withBox('INBOX', async c => { const x = await c.fetchOne(String(reyes.uid), { labels: true }, { uid: true }); return [...x.labels]; });
  assert(lab.includes('Research')); console.log('  label via X-GM-LABELS:', lab.join(', '));
  // archive, spam, trash
  const before = m.threads('INBOX').total;
  await m.action({ op: 'archive', thread: reyes.thread, folder: 'INBOX' }); await m.syncFolder('INBOX');
  assert.strictEqual(m.threads('INBOX').total, before - 1); console.log('  archive: moved to All Mail, inbox', before, '->', before - 1);
  const ps = m.threads('INBOX').items.find(i => /Robotics club update #6/.test(i.subject));
  await m.action({ op: 'spam', thread: ps.thread, folder: 'INBOX' }); await m.syncFolder('[Gmail]/Spam');
  assert(m.threads('[Gmail]/Spam').items.some(i => /#6/.test(i.subject))); console.log('  spam: now in [Gmail]/Spam');
  const tr = m.threads('INBOX').items.find(i => /Robotics club update #5/.test(i.subject));
  await m.action({ op: 'trash', thread: tr.thread, folder: 'INBOX' }); await m.syncFolder('[Gmail]/Trash');
  assert(m.threads('[Gmail]/Trash').items.some(i => /#5/.test(i.subject))); console.log('  delete: now in [Gmail]/Trash');
  const mv = m.threads('INBOX').items.find(i => /Robotics club update #4/.test(i.subject));
  await m.action({ op: 'move', thread: mv.thread, folder: 'INBOX', arg: 'School' }); await m.syncFolder('School');
  assert(m.threads('School').items.some(i => /#4/.test(i.subject))); console.log('  move to School: ok');
  // search
  const s = await m.search('from:praman@ucsd.example'); assert(s.items.some(i => /reading list/.test(i.subject))); console.log('  X-GM-RAW search "from:praman@ucsd.example":', s.items.map(i => i.subject).join(' | '));
  const s2 = await m.search('"Kalman filter"'); console.log('  search phrase in body:', s2.items.map(i => i.subject).join(' | '));
  console.log('  contacts for "ma":', m.contacts('ma').map(c => c.address).join(', '));
  // compose: reply with headers, through SMTP; Gmail saves Sent itself so no append
  const r = await m.send({ to: ['maya.okafor@stanford.example'], cc: ['labmgr@stanford.example'], subject: 'Re: Summer research assistant, inner speech decoding', html: '<p>Hi Dr. Okafor,</p><p>Thursday at 4 PM works great!</p><p>Best,<br>Shabd</p>', inReplyTo: last.msgid, references: [...last.refs, last.msgid], replyOf: last.id, attachments: [{ path: path.join(__dirname, 'Shabd_Warar_Resume.pdf') }] });
  const eml = lastEml();
  assert(eml.includes('In-Reply-To: <t1d@stanford.example>')); assert(/References: .*t1a@example.com/.test(eml)); assert(eml.includes('Shabd_Warar_Resume.pdf'));
  console.log('  reply sent:', r.recipients, 'recipients, In-Reply-To and References set, attachment included, cap counter', used);
  assert(m.rowsFor([last.id])[0].answered); console.log('  original marked \\Answered');
  // drafts: save, update (replaces old), delete
  const d1 = await m.saveDraft({ to: ['hsato@cmu.example'], subject: 'Self supervised EEG', html: '<p>Hi Dr. Sato,</p><p>First version</p>' });
  const d2 = await m.saveDraft({ to: ['hsato@cmu.example'], subject: 'Self supervised EEG', html: '<p>Hi Dr. Sato,</p><p>Second version</p>', draft: d1, messageId: d1.messageId });
  await m.syncFolder('[Gmail]/Drafts');
  const dr = m.threads('[Gmail]/Drafts').items; const mine = dr.filter(i => i.subject === 'Self supervised EEG');
  assert.strictEqual(mine.length, 1); assert.notStrictEqual(d1.uid, d2.uid);
  const db2 = await m.body(d2.folder, d2.uid); assert(db2.html.includes('Second version')); console.log('  drafts: saved to [Gmail]/Drafts, second save replaced the first (uid', d1.uid, '->', d2.uid + ')');
  await m.deleteDraft(d2); await m.syncFolder('[Gmail]/Drafts'); assert(!m.threads('[Gmail]/Drafts').items.some(i => i.subject === 'Self supervised EEG')); console.log('  draft discarded');
  // IDLE: new mail pushed from another client shows up without polling
  m._inboxPrimed = true; m.startedAt = 0;
  await m.startIdle(); await sleep(500);
  const got = new Promise(res => m.once('newmail', res));
  const other = new ImapFlow({ host: '127.0.0.1', port: 1993, secure: false, auth: { user: 'tester@example.com', pass: 'abcdabcdabcdabcd' }, logger: false }); await other.connect();
  await other.append('INBOX', `From: Daniel Reyes <dreyes@mit.example>\r\nTo: tester@example.com\r\nSubject: Code for the Kalman filter\r\nMessage-ID: <idle1@mit.example>\r\nDate: ${new Date().toUTCString()}\r\n\r\nHere you go!`, []);
  await other.logout();
  const t0 = Date.now(); const nm = await Promise.race([got, sleep(8000).then(() => null)]);
  assert(nm, 'IDLE did not deliver'); console.log('  IDLE: new mail event in', Date.now() - t0, 'ms:', nm.map(x => x.subject).join(', '));
  await m.stop();
  db.flush(); return db;
}
async function generic() {
  console.log('[generic IMAP]');
  const db = await MailDB.open(null);
  const m = new Mail({ db, getAccount: () => acct(1994), usage, prefetch: false });
  await m.connect(); assert(!m.gmail);
  await m.syncFolder('INBOX'); await m.syncFolder('Sent');
  const t = m.threads('INBOX'); const conv = t.items.find(i => /Summer research/.test(i.subject));
  const th = await m.thread(conv.thread); console.log('  References threading without Gmail:', th.length, 'messages across Inbox and Sent:', th.map(x => x.folder).join(', '));
  assert.strictEqual(th.length, 4);
  await m.action({ op: 'archive', thread: conv.thread, folder: 'INBOX' });
  assert(m.folders().some(f => f.path === 'Archive' && f.special === '\\Archive')); console.log('  archive created an Archive folder and moved the conversation there');
  const n0 = (await m.withBox('Sent', async c => c.mailbox.exists));
  await m.send({ to: ['praman@ucsd.example'], subject: 'Thanks for the list', html: '<p>Thank you!</p>' });
  const n1 = (await m.withBox('Sent', async c => c.mailbox.exists)); assert.strictEqual(n1, n0 + 1); console.log('  send appended a copy to Sent (', n0, '->', n1, ')');
  await m.stop();
}
(async () => { await gmail(); await generic(); console.log('\nALL MAIL TESTS PASSED'); process.exit(0); })().catch(e => { console.error('FAIL', e); process.exit(1); });
