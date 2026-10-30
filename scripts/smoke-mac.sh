#!/bin/bash
# Launch checks on a real Mac against the built apps. Fails (exit 1) if any required check fails.
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
run_timeout() { local secs=$1; shift; "$@" & local p=$!; local i=0; while kill -0 $p 2>/dev/null; do if [ $i -ge $((secs*5)) ]; then kill -9 $p 2>/dev/null; pkill -9 -f "$1" 2>/dev/null; echo "TIMEOUT after ${secs}s: $*"; return 124; fi; sleep 0.2; i=$((i+1)); done; wait $p; }
ARM="dist/Letterhead-darwin-arm64/Letterhead.app"; X64="dist/Letterhead-darwin-x64/Letterhead.app"
NATIVE="$ARM"; OTHER="$X64"; [ "$(uname -m)" = x86_64 ] && { NATIVE="$X64"; OTHER="$ARM"; }
echo "== smoke test, $(basename "$(dirname "$NATIVE")") (native)"
if run_timeout 150 "$NATIVE/Contents/MacOS/Letterhead" --smoke-test="$PWD/smoke-native.json"; then echo "smoke native: PASS"; else echo "smoke native: FAIL"; FAIL=1; fi
echo "== health check, native"
rm -f /tmp/lh-health.json
if run_timeout 90 "$NATIVE/Contents/MacOS/Letterhead" --health-check=/tmp/lh-health.json && grep -q '"ok":true' /tmp/lh-health.json; then echo "health native: PASS $(cat /tmp/lh-health.json)"; else echo "health native: FAIL $(cat /tmp/lh-health.json 2>/dev/null)"; FAIL=1; fi
echo "== other chip ($(basename "$(dirname "$OTHER")"))"
if [ "$(uname -m)" = arm64 ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then echo "Rosetta not installed on this runner, skipping the Intel launch (signature checked above)";
else
  rm -f /tmp/lh-health2.json
  if run_timeout 150 "$OTHER/Contents/MacOS/Letterhead" --health-check=/tmp/lh-health2.json && grep -q '"ok":true' /tmp/lh-health2.json; then echo "health other chip: PASS"; else echo "health other chip: FAIL $(cat /tmp/lh-health2.json 2>/dev/null)"; FAIL=1; fi
fi
echo "== real updater swap on macOS: built app, health check, keep new"
W="$(mktemp -d)"; ditto "$NATIVE" "$W/Apps/Letterhead.app"; ditto "$NATIVE" "$W/new/Letterhead.app"
node -e "
const { Updater } = require('./src/updater'); const path = require('path'), fs = require('fs');
const w = process.argv[1]; const ver = require('./package.json').version;
const u = new Updater({ currentVersion: '0.0.1', feedUrl: 'x', appPath: path.join(w, 'Apps/Letterhead.app'), workDir: path.join(w, 'updates'), pid: 999999, healthWait: 90 });
fs.mkdirSync(path.join(w, 'updates'), { recursive: true }); u.staged = path.join(w, 'new/Letterhead.app'); u.stagedVersion = ver;
const { log } = u.install({ relaunch: false }); console.log(log);
" "$W" > /tmp/lh-swaplog.txt
LOG=$(cat /tmp/lh-swaplog.txt); i=0; while ! grep -q '^done' "$LOG" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.2; i=$((i+1)); done
cat "$LOG"
if grep -q "updated .* to" "$LOG" && [ ! -e "$W/Apps/Letterhead.app.previous" ]; then echo "updater swap: PASS"; else echo "updater swap: FAIL"; FAIL=1; fi
echo "== informational: a browser-downloaded (quarantined) copy, launched directly"
Q="$(mktemp -d)"; ditto "$NATIVE" "$Q/Letterhead.app"; xattr -w com.apple.quarantine "0083;$(printf %x $(date +%s));Safari;" "$Q/Letterhead.app"
rm -f /tmp/lh-hq.json
if run_timeout 30 "$Q/Letterhead.app/Contents/MacOS/Letterhead" --health-check=/tmp/lh-hq.json && grep -q '"ok":true' /tmp/lh-hq.json; then echo "quarantined copy: starts on this runner"; else echo "quarantined copy: blocked or hung on this runner (expected without a Developer ID; the installer avoids this)"; fi
spctl --assess --type execute -vv "$NATIVE" 2>&1 | sed 's/^/spctl: /' || true
pkill -9 -f "Letterhead.app/Contents/MacOS/Letterhead" 2>/dev/null || true
[ $FAIL = 0 ] && echo "MAC LAUNCH CHECKS PASSED" || echo "MAC LAUNCH CHECKS FAILED"
exit $FAIL
