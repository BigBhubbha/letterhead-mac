#!/bin/bash
# Upgrade from 2.1: seed an old data folder (inbox cache, style profile, AI key, legacy settings),
# start the app once and check the old data is gone while batches, account and usage are kept.
set -u
cd "$(dirname "$0")/.."
D=$(mktemp -d); mkdir -p "$D/mailcache"
head -c 300000 /dev/urandom > "$D/mail.sqlite"; for i in 1 2 3; do echo '{}' > "$D/mailcache/$i.json"; done
echo '{"tone":"x"}' > "$D/style.json"; echo '{"gemini":{"plain":"k"}}' > "$D/aikeys.json"
echo '{"cap":450,"keepAwake":true,"keepAwakeLid":true,"aiEnabled":true,"indexWindow":2000,"mailEnabled":true}' > "$D/settings.json"
echo '{"preset":"custom","host":"127.0.0.1","port":2525,"user":"tester@example.com","passPlain":"x"}' > "$D/account.json"; echo '[]' > "$D/usage.json"; echo '{}' > "$D/draft.json"
node -e "const b=[1,2].map(i=>({id:'b'+i,name:'Old '+i,kind:'merge',merge:{recipients:[]},status:'done',scheduledAt:Date.now()-86400000*i,items:[{id:0,email:'a@b.c',status:'sent',fields:{}}]}));require('fs').writeFileSync(process.argv[1]+'/batches.json',JSON.stringify({v:1,batches:b}))" "$D"
RUN=(env LETTERHEAD_USERDATA="$D" LETTERHEAD_HARNESS="$PWD/test/harness-cleanup.js")
if [ "$(uname)" = Darwin ]; then OUT=$(perl -e 'alarm 90; exec @ARGV' "${RUN[@]}" node_modules/.bin/electron . 2>&1); else OUT=$(timeout 90 xvfb-run -a "${RUN[@]}" node_modules/electron/dist/electron . --no-sandbox 2>&1); fi
echo "$OUT" | grep '\[cleanup\]'
echo "$OUT" | grep -q '"ok":true' && echo "UPGRADE CLEANUP PASSED" || { echo "UPGRADE CLEANUP FAILED"; exit 1; }
