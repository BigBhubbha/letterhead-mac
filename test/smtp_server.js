// Local SMTP test server with AUTH (same behaviour as smtp_server.py, no Python needed).
// Writes each message to OUTDIR as .eml and appends "time rcpts... file" to OUTDIR/log.txt.
// Usage: node test/smtp_server.js PORT OUTDIR [fail_regex]
const { SMTPServer } = require('smtp-server');
const fs = require('fs'), path = require('path');
const port = Number(process.argv[2]), out = process.argv[3], fail = process.argv[4] ? new RegExp(process.argv[4]) : null;
fs.mkdirSync(out, { recursive: true });
const server = new SMTPServer({
  authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false, size: 50 * 1024 * 1024,
  onAuth(auth, session, cb) { if (auth.username === 'tester@example.com' && auth.password === 'abcdabcdabcdabcd') return cb(null, { user: auth.username }); cb(Object.assign(new Error('Authentication failed'), { responseCode: 535 })); },
  onRcptTo(addr, session, cb) { if (fail && fail.test(addr.address)) return cb(Object.assign(new Error('5.1.1 The email account that you tried to reach does not exist'), { responseCode: 550 })); cb(); },
  onData(stream, session, cb) {
    const chunks = []; stream.on('data', c => chunks.push(c));
    stream.on('end', () => {
      const rcpts = session.envelope.rcptTo.map(r => r.address); const t = (Date.now() / 1000).toFixed(3);
      const n = `${t}_${rcpts[0]}.eml`;
      fs.writeFileSync(path.join(out, n), Buffer.concat(chunks));
      fs.appendFileSync(path.join(out, 'log.txt'), `${t} ${rcpts.join(' ')} ${n}\n`);
      cb(null, 'Message accepted');
    });
  },
});
server.on('error', e => console.error('smtp error', e.message));
server.listen(port, '127.0.0.1', () => console.log('listening', port));
