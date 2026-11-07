#!/bin/bash
# Run every test suite against local test servers (SMTP via aiosmtpd, IMAP via hoodiecrow).
# Needs: node deps installed (python3 only for the zip helper). Used locally and by the release workflow.
set -u
cd "$(dirname "$0")/.."
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
rm -rf /tmp/mail1 /tmp/mail2526; mkdir -p /tmp/mail1 /tmp/mail2526
node test/smtp_server.js 2525 /tmp/mail1 'bounce@' > /tmp/lh-smtp1.log 2>&1 & PIDS+=($!)
node test/smtp_server.js 2526 /tmp/mail2526 > /tmp/lh-smtp2.log 2>&1 & PIDS+=($!)
start_imap() { node test/imap_server.js 1143 gmail > /tmp/lh-imap1.log 2>&1 & IMAPPID=$!; PIDS+=($IMAPPID); }
start_imap
node test/imap_server.js 1144 generic > /tmp/lh-imap2.log 2>&1 & PIDS+=($!)
for port in 2525 2526 1143 1144; do
  for i in $(seq 1 50); do (echo > /dev/tcp/127.0.0.1/$port) 2>/dev/null && break; sleep 0.2; done
done
wait_port() { for i in $(seq 1 50); do (echo > /dev/tcp/127.0.0.1/$1) 2>/dev/null && return; sleep 0.2; done; }
FAILED=0
# perl alarm works as a timeout on stock macOS too
run() { echo "=== $1 ($(date +%T))"; if perl -e 'alarm shift; exec @ARGV' "${TEST_TIMEOUT:-300}" node "test/$1" > "/tmp/lh-test-$1.log" 2>&1; then tail -1 "/tmp/lh-test-$1.log"; else echo "FAILED: $1"; tail -40 "/tmp/lh-test-$1.log"; for f in /tmp/lh-smtp*.log /tmp/lh-imap*.log /tmp/lh-mail*.log; do echo "--- $f"; tail -5 "$f"; done; FAILED=1; fi; }
run replyguard.test.js
run engine.test.js
run drafts.test.js
# drafts.test sends drafts out of the 1143 mailbox, the scheduler test wants a fresh one
kill $IMAPPID 2>/dev/null; sleep 0.5; start_imap; wait_port 1143
run scheduler.test.js
run updater.test.js
run power.test.js
run perf.test.js
if [ $FAILED = 0 ]; then echo "ALL SUITES PASSED"; else echo "SOME SUITES FAILED"; fi
exit $FAILED
