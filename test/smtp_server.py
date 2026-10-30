"""Local SMTP test server with AUTH. Writes each received message to OUTDIR as .eml.
Usage: python3 smtp_server.py PORT OUTDIR [fail_regex]"""
import sys, os, time, re, asyncio
from aiosmtpd.controller import Controller
from aiosmtpd.smtp import AuthResult, LoginPassword

PORT = int(sys.argv[1]); OUT = sys.argv[2]; FAIL = re.compile(sys.argv[3]) if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)

def auth(server, session, envelope, mechanism, auth_data):
    if isinstance(auth_data, LoginPassword) and auth_data.login == b'tester@example.com' and auth_data.password == b'abcdabcdabcdabcd':
        return AuthResult(success=True)
    return AuthResult(success=False, handled=False)

class H:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        if FAIL and FAIL.search(address):
            return '550 5.1.1 The email account that you tried to reach does not exist'
        envelope.rcpt_tos.append(address); return '250 OK'
    async def handle_DATA(self, server, session, envelope):
        n = f"{time.time():.3f}_{envelope.rcpt_tos[0]}.eml"
        with open(os.path.join(OUT, n), 'wb') as f: f.write(envelope.content)
        with open(os.path.join(OUT, 'log.txt'), 'a') as f: f.write(f"{time.time():.3f} {' '.join(envelope.rcpt_tos)} {n}\n")
        return '250 Message accepted'

c = Controller(H(), hostname='127.0.0.1', port=PORT, authenticator=auth, auth_required=True, auth_require_tls=False, ready_timeout=60)
c.start(); print('listening', PORT, flush=True)
try:
    while True: time.sleep(1)
except KeyboardInterrupt: c.stop()
