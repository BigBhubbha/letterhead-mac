// Local IMAP server (hoodiecrow) with a full mailbox. node test/mail_server.js PORT gmail|generic
const hoodiecrow = require('hoodiecrow-imap');
const { storage } = require('./mail_fixtures');
const port = Number(process.argv[2] || 1993), flavor = process.argv[3] || 'gmail';
const plugins = ['ID', 'ENABLE', 'IDLE', 'NAMESPACE', 'UNSELECT', 'UIDPLUS', 'SPECIAL-USE', 'LITERALPLUS', 'MOVE', 'XTOYBIRD'];
if (flavor === 'gmail') plugins.push('X-GM-EXT-1');
const server = hoodiecrow({ plugins, storage: storage(flavor), users: { 'tester@example.com': { password: 'abcdabcdabcdabcd' } } });
server.listen(port, '127.0.0.1', () => console.log('mail imap listening', port, flavor));
