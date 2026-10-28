// Local IMAP test server (hoodiecrow) with a Drafts folder full of realistic drafts.
// Usage: node test/imap_server.js PORT gmail|generic
const hoodiecrow = require('hoodiecrow-imap');
const port = Number(process.argv[2] || 1143), flavor = process.argv[3] || 'gmail';
const pdf = Buffer.from('%PDF-1.4\n% Shabd Warar resume placeholder\n').toString('base64');
const d = (hdrs, body) => ({ raw: hdrs.join('\r\n') + '\r\n\r\n' + body, flags: ['\\Draft', '\\Seen'], internaldate: new Date() });
const FROM = 'From: Shabd Warar <tester@example.com>';
const drafts = [
  d([FROM, 'To: Maya Okafor <maya.okafor@stanford.example>', 'Cc: Lab Manager <labmgr@stanford.example>', 'Bcc: shabd.archive@example.com', 'Subject: Summer research assistant, inner speech decoding', 'Date: Mon, 26 Oct 2026 21:10:00 -0500', 'Message-ID: <draft-1@example.com>', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="MIX"'],
    ['--MIX', 'Content-Type: multipart/alternative; boundary="ALT"', '', '--ALT', 'Content-Type: text/plain; charset=utf-8', '',
     'Dear Dr. Okafor,', '', 'I read "Decoding inner speech from motor cortex" twice. I would love to help in your lab this summer.', '', 'Best,', 'Shabd',
     '--ALT', 'Content-Type: text/html; charset=utf-8', '', '<p>Dear Dr. Okafor,</p><p>I read <i>Decoding inner speech from motor cortex</i> twice. I would love to help in your lab this summer.</p><p>Best,<br>Shabd</p>', '--ALT--',
     '--MIX', 'Content-Type: application/pdf; name="Shabd_Warar_Resume.pdf"', 'Content-Disposition: attachment; filename="Shabd_Warar_Resume.pdf"', 'Content-Transfer-Encoding: base64', '', pdf, '--MIX--', ''].join('\r\n')),
  d([FROM, 'To: dreyes@mit.example', 'Subject: Question about low latency neural decoders', 'Date: Mon, 26 Oct 2026 20:02:00 -0500', 'Content-Type: text/plain; charset=utf-8'],
    'Hi Professor Reyes,\r\n\r\nI am a high school junior building a small EEG project and had a question about your decoder paper.\r\n\r\nThank you,\r\nShabd'),
  d([FROM, 'Subject: Notes for the Duke email (no recipient yet)', 'Date: Sun, 25 Oct 2026 18:40:00 -0500', 'Content-Type: text/plain; charset=utf-8'],
    'Dear Dr. Mensah, I would like to ask about cortical dynamics of reaching...'),
  d([FROM, 'To: Priya Raman <praman@ucsd.example>', 'Subject: High school researcher interested in speech prosthetics', 'Date: Sun, 25 Oct 2026 10:15:00 -0500', 'Content-Type: text/plain; charset=utf-8'],
    'Dear Dr. Raman,\r\n\r\nYour work on restoring speech after ALS is the reason I started learning signal processing.\r\n\r\nWarmly,\r\nShabd'),
  d([FROM, 'Bcc: hsato@cmu.example, tlind@uw.example', 'Subject: Self supervised EEG, a quick question', 'Date: Sat, 24 Oct 2026 16:00:00 -0500', 'Content-Type: text/plain; charset=utf-8'],
    'Hello,\r\n\r\nI am writing to both of you because your labs collaborate on EEG representations.\r\n\r\nShabd'),
];
const storage = flavor === 'gmail'
  ? { INBOX: { messages: [] }, '': { separator: '/', folders: { '[Gmail]': { flags: ['\\Noselect'], folders: {
      Drafts: { 'special-use': '\\Drafts', messages: drafts }, 'Sent Mail': { 'special-use': '\\Sent', messages: [] }, 'All Mail': { 'special-use': '\\All', messages: [] } } } } } }
  // generic server: names are not English, so detection has to use SPECIAL-USE
  : { INBOX: { messages: [] }, '': { separator: '.', folders: { Brouillons: { 'special-use': '\\Drafts', messages: drafts }, 'Envoyes': { 'special-use': '\\Sent', messages: [] }, Corbeille: { 'special-use': '\\Trash', messages: [] } } } };
const plugins = ['ID', 'ENABLE', 'IDLE', 'NAMESPACE', 'UNSELECT', 'UIDPLUS', 'SPECIAL-USE', 'LITERALPLUS', 'MOVE', 'XTOYBIRD'];
if (flavor === 'gmail') plugins.push('X-GM-EXT-1');
const server = hoodiecrow({ plugins, storage, users: { 'tester@example.com': { password: 'abcdabcdabcdabcd' }, testuser: { password: 'testpass' } } });
server.listen(port, '127.0.0.1', () => console.log('imap listening', port, flavor));
