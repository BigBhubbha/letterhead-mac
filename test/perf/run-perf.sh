#!/bin/bash
# Runs the perf harness against fresh local servers. Usage: test/perf/run-perf.sh LABEL [DRAFTS] [INTERVAL_MS]
set -u
cd "$(dirname "$0")/../.."
LABEL=${1:-run}; N=${2:-200}; IV=${3:-1000}
PIDS=(); trap 'for p in "${PIDS[@]}"; do kill $p 2>/dev/null; done' EXIT
rm -rf /tmp/lhperf-smtp /tmp/lhperf-ud; mkdir -p /tmp/lhperf-smtp /tmp/lhperf-ud
node test/smtp_server.js 2527 /tmp/lhperf-smtp > /tmp/lhperf-smtp.log 2>&1 & PIDS+=($!)
node test/perf/imap_perf_server.js 1995 "$N" "${PERF_INBOX:-1500}" > /tmp/lhperf-imap.log 2>&1 & PIDS+=($!)
for port in 2527 1995; do for i in $(seq 1 100); do (echo > /dev/tcp/127.0.0.1/$port) 2>/dev/null && break; sleep 0.2; done; done
ELECTRON=node_modules/electron/dist/electron; [ "$(uname)" = Darwin ] && ELECTRON=node_modules/.bin/electron
RUN=(env LETTERHEAD_HARNESS="$PWD/test/perf/harness-perf.js" LETTERHEAD_USERDATA=/tmp/lhperf-ud PERF_DRAFTS=$N PERF_INTERVAL_MS=$IV PERF_HIDE=${PERF_HIDE:-} PERF_SETTLE_MS=${PERF_SETTLE_MS:-20000} "$ELECTRON" . --no-sandbox)
if [ "$(uname)" = Darwin ]; then "${RUN[@]}"; else xvfb-run -a "${RUN[@]}"; fi 2>&1 | grep -E '^\[perf\]' | sed "s/^\[perf\]/[$LABEL]/"
