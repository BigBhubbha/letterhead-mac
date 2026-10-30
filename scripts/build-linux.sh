#!/bin/sh
# Fallback only (no Mac): build on Linux, ad-hoc sign with rcodesign, and zip into OUT (default ./release).
# Needs: node, npm deps installed, rcodesign on PATH (or ~/.local/bin), python3.
set -eu
cd "$(dirname "$0")/.."
OUT="${OUT:-$PWD/release}"
VER=$(node -p "require('./package.json').version")
RCS="$(command -v rcodesign || echo "$HOME/.local/bin/rcodesign")"
node package-mac.js
mkdir -p "$OUT"
for ARCH in arm64 x64; do
  APP="dist/Letterhead-darwin-$ARCH/Letterhead.app"
  "$RCS" sign "$APP" >/dev/null
done
rm -f "$OUT"/Letterhead-*.zip "$OUT"/latest.json
python3 scripts/mkzip.py "$OUT/Letterhead-$VER-AppleSilicon.zip" "dist/Letterhead-darwin-arm64/Letterhead.app=Letterhead.app"
python3 scripts/mkzip.py "$OUT/Letterhead-$VER-Intel.zip" "dist/Letterhead-darwin-x64/Letterhead.app=Letterhead.app"
python3 scripts/mkzip.py "$OUT/Letterhead-$VER-macOS-both.zip" \
  "dist/Letterhead-darwin-arm64/Letterhead.app=Letterhead for Apple Silicon/Letterhead.app" \
  "dist/Letterhead-darwin-x64/Letterhead.app=Letterhead for Intel/Letterhead.app" \
  "README.md=README.md"
NOTES="${NOTES:-Letterhead $VER}"
REPO="${REPO:-BigBhubbha/letterhead-mac}"
VER="$VER" OUT="$OUT" NOTES="$NOTES" REPO="$REPO" python3 - <<'PY'
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
