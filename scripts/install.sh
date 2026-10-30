#!/bin/sh
# Letterhead installer. Paste into Terminal:
#   curl -fsSL https://github.com/BigBhubbha/letterhead-mac/releases/latest/download/install.sh | sh
# Why a script: Letterhead is not signed with a paid Apple Developer ID. On macOS 26, a copy
# downloaded by a browser gets a quarantine flag, and Gatekeeper can hold such an app forever
# (the Dock icon bounces and nothing opens). curl does not add that flag, so this copy just opens.
# What it does: downloads the newest release for your chip, checks its SHA-256 against the
# release's latest.json, test-starts it, then puts it in /Applications (or ~/Applications if your
# account cannot write to /Applications) and opens it. Your settings and mail are not touched.
set -eu
REPO="${LETTERHEAD_REPO:-BigBhubbha/letterhead-mac}"
FEED="https://github.com/$REPO/releases/latest/download/latest.json"
say() { printf '%s\n' "$*"; }
fail() { say "Letterhead was not installed: $*"; exit 1; }
[ "$(uname)" = "Darwin" ] || fail "this installer is for macOS."
case "$(uname -m)" in arm64) ARCH=arm64; CHIP="Apple Silicon";; x86_64) ARCH=x64; CHIP="Intel";; *) fail "unknown chip $(uname -m)";; esac
TMP="$(mktemp -d /tmp/letterhead-install.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
say "Checking the newest version..."
curl -fsSL "$FEED" -o "$TMP/latest.json" || fail "could not reach GitHub."
read_feed() { /usr/bin/osascript -l JavaScript -e 'function run(a){var j=JSON.parse($.NSString.stringWithContentsOfFileEncodingError(a[0],4,null).js);var x=j.assets[a[1]];return [j.version,x.url,x.sha256].join(" ");}' "$TMP/latest.json" "$ARCH"; }
set -- $(read_feed) || fail "the update feed could not be read."
VER="$1"; URL="$2"; SUM="$3"
[ -n "$URL" ] && [ ${#SUM} -eq 64 ] || fail "the update feed has no download for $CHIP Macs."
say "Downloading Letterhead $VER for $CHIP..."
curl -fL --progress-bar "$URL" -o "$TMP/app.zip" || fail "the download did not finish."
GOT="$(shasum -a 256 "$TMP/app.zip" | cut -d' ' -f1)"
[ "$GOT" = "$SUM" ] || fail "the download did not match its checksum, so it was thrown away."
/usr/bin/ditto -x -k "$TMP/app.zip" "$TMP/x" || fail "could not unpack the download."
NEW="$TMP/x/Letterhead.app"
[ -d "$NEW" ] || fail "the download did not contain Letterhead.app."
/usr/bin/xattr -dr com.apple.quarantine "$NEW" 2>/dev/null || true
say "Test-starting the new copy..."
"$NEW/Contents/MacOS/Letterhead" --health-check="$TMP/health.json" >/dev/null 2>&1 &
HP=$!; i=0
while [ $i -lt 450 ]; do
  if [ -s "$TMP/health.json" ]; then break; fi
  kill -0 $HP 2>/dev/null || { sleep 0.5; break; }
  i=$((i+1)); sleep 0.2
done
{ kill -9 $HP; wait $HP; } 2>/dev/null || true
grep -q '"ok":true' "$TMP/health.json" 2>/dev/null || fail "the new copy did not start on this Mac within 90 seconds. Nothing was changed. Details: $(cat "$TMP/health.json" 2>/dev/null || echo none)"
if [ -w /Applications ]; then DEST=/Applications; else DEST="$HOME/Applications"; mkdir -p "$DEST"; fi
if [ -d "/Applications/Letterhead.app" ] && [ "$DEST" != /Applications ]; then
  OLDCOPY=1
fi
if pgrep -f "Letterhead.app/Contents/MacOS/Letterhead" >/dev/null 2>&1; then
  say "Quitting the running Letterhead..."
  /usr/bin/osascript -e 'tell application id "com.shabdwarar.letterhead" to quit' >/dev/null 2>&1 || true
  i=0; while pgrep -f "Letterhead.app/Contents/MacOS/Letterhead" >/dev/null 2>&1 && [ $i -lt 100 ]; do sleep 0.2; i=$((i+1)); done
  pgrep -f "Letterhead.app/Contents/MacOS/Letterhead" >/dev/null 2>&1 && fail "Letterhead is still running (maybe a send is in progress). Quit it and run this again."
fi
if [ -d "$DEST/Letterhead.app" ]; then mv "$DEST/Letterhead.app" "$TMP/old.app" || fail "could not replace $DEST/Letterhead.app."; fi
if ! /usr/bin/ditto "$NEW" "$DEST/Letterhead.app"; then
  rm -rf "$DEST/Letterhead.app"; [ -d "$TMP/old.app" ] && mv "$TMP/old.app" "$DEST/Letterhead.app"
  fail "could not copy into $DEST."
fi
/usr/bin/xattr -dr com.apple.quarantine "$DEST/Letterhead.app" 2>/dev/null || true
rm -rf "$HOME/Library/Application Support/Letterhead/updates"
say "Installed Letterhead $VER in $DEST."
if [ "${OLDCOPY:-0}" = 1 ]; then
  say "Note: an older copy is still in /Applications and your account cannot remove it. Drag /Applications/Letterhead.app to the Trash (macOS asks for an administrator password), so the Dock and Spotlight open the new one."
fi
/usr/bin/open "$DEST/Letterhead.app"
