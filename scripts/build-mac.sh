#!/bin/bash
# Build, sign and check Letterhead on a real Mac (used by .github/workflows/release.yml).
#   SIGN_ID   codesign identity (SHA-1 hash or name); "-" for ad hoc
#   KEYCHAIN  keychain holding the identity (optional)
#   OUT       where zips and latest.json go (default ./release)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-$PWD/release}"; SIGN_ID="${SIGN_ID:--}"
VER=$(node -p "require('./package.json').version")
REPO="${REPO:-BigBhubbha/letterhead-mac}"
node package-mac.js
mkdir -p "$OUT"; rm -f "$OUT"/Letterhead-* "$OUT"/latest.json
KC=(); [ -n "${KEYCHAIN:-}" ] && KC=(--keychain "$KEYCHAIN")
for ARCH in arm64 x64; do
  APP="dist/Letterhead-darwin-$ARCH/Letterhead.app"
  xattr -cr "$APP"
  # --deep signs every nested helper, framework and dylib with the same identity
  codesign --force --deep --sign "$SIGN_ID" "${KC[@]}" --timestamp=none "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
  echo "designated requirement ($ARCH): $(codesign -d -r- "$APP" 2>&1 | grep designated || true)"
  lipo -info "$APP/Contents/MacOS/Letterhead"
done
ditto -c -k --keepParent dist/Letterhead-darwin-arm64/Letterhead.app "$OUT/Letterhead-$VER-AppleSilicon.zip"
ditto -c -k --keepParent dist/Letterhead-darwin-x64/Letterhead.app "$OUT/Letterhead-$VER-Intel.zip"
BOTH="$(mktemp -d)"; mkdir -p "$BOTH/Letterhead for Apple Silicon" "$BOTH/Letterhead for Intel"
ditto dist/Letterhead-darwin-arm64/Letterhead.app "$BOTH/Letterhead for Apple Silicon/Letterhead.app"
ditto dist/Letterhead-darwin-x64/Letterhead.app "$BOTH/Letterhead for Intel/Letterhead.app"
cp README.md "$BOTH/"; (cd "$BOTH" && ditto -c -k . "$OUT/Letterhead-$VER-macOS-both.zip"); rm -rf "$BOTH"
cp scripts/install.sh "$OUT/install.sh"
NOTES="${NOTES:-Letterhead $VER}" VER="$VER" OUT="$OUT" REPO="$REPO" python3 - <<'PY'
import hashlib, json, os
v, out, repo = os.environ['VER'], os.environ['OUT'], os.environ['REPO']
def a(name):
    p = os.path.join(out, name)
    return {'url': f'https://github.com/{repo}/releases/download/v{v}/{name}', 'sha256': hashlib.sha256(open(p, 'rb').read()).hexdigest(), 'size': os.path.getsize(p)}
m = {'version': v, 'notes': os.environ['NOTES'], 'assets': {'arm64': a(f'Letterhead-{v}-AppleSilicon.zip'), 'x64': a(f'Letterhead-{v}-Intel.zip')}}
json.dump(m, open(os.path.join(out, 'latest.json'), 'w'), indent=1)
print(json.dumps(m, indent=1))
PY
ls -la "$OUT"
