// Perf IMAP server (hoodiecrow, Gmail flavor): N drafts plus a large inbox, like a real account.
// node test/perf/imap_perf_server.js PORT DRAFTS INBOX
const hoodiecrow = require('hoodiecrow-imap');
const port = Number(process.argv[2] || 1995), N = Number(process.argv[3] || 500), INBOX = Number(process.argv[4] || 1500);
const now = Date.now();
const para = 'I read your recent paper and was struck by how it approached the problem. I am a high school junior and would love to help in your lab this summer, even in a small way. '.repeat(6);
const mk = (i, hdr, flags) => ({ raw: hdr.join('\r\n') + '\r\n\r\n' + `Dear Dr. ${i},\r\n\r\n${para}\r\n\r\nBest,\r\nShabd`, flags, internaldate: new Date(now - i * 60000) });
const drafts = [], inbox = [];
for (let i = 1; i <= N; i++) drafts.push(mk(i, ['From: Shabd Warar <tester@example.com>', `To: Researcher ${i} <r${i}@lab${i % 40}.example>`, `Subject: Interested in your work on topic ${i}`, `Message-ID: <draft-${i}@example.com>`, `Date: ${new Date(now - i * 60000).toUTCString()}`, 'Content-Type: text/plain; charset=utf-8'], ['\\Draft', '\\Seen']));
for (let i = 1; i <= INBOX; i++) inbox.push(mk(i, [`From: Person ${i % 200} <p${i % 200}@site${i % 50}.example>`, 'To: Shabd Warar <tester@example.com>', `Subject: Message number ${i}`, `Message-ID: <in-${i}@example.com>`, `Date: ${new Date(now - i * 3600000).toUTCString()}`, 'Content-Type: text/plain; charset=utf-8'], i % 3 ? ['\\Seen'] : []));
const storage = { INBOX: { messages: inbox }, '': { separator: '/', folders: { '[Gmail]': { flags: ['\\Noselect'], folders: {
  Drafts: { 'special-use': '\\Drafts', messages: drafts }, 'Sent Mail': { 'special-use': '\\Sent', messages: [] }, 'All Mail': { 'special-use': '\\All', messages: inbox.slice(0, 300) } } } } } };
const server = hoodiecrow({ plugins: ['ID', 'ENABLE', 'IDLE', 'NAMESPACE', 'UNSELECT', 'UIDPLUS', 'SPECIAL-USE', 'LITERALPLUS', 'MOVE', 'XTOYBIRD', 'X-GM-EXT-1'], storage, users: { 'tester@example.com': { password: 'abcdabcdabcdabcd' } } });
server.listen(port, '127.0.0.1', () => console.log('perf imap listening', port, N, INBOX));
