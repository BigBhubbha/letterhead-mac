#!/bin/sh
# Publish a new version. Bump "version" in package.json first, then:
#   NOTES="What changed" scripts/release.sh
# Builds, signs, zips, writes latest.json, and creates GitHub release v<version>.
# Installed copies of Letterhead read releases/latest/download/latest.json, see the update on
# their next check (at launch and every 4 hours), download it in the background, and ask to restart.
set -eu
cd "$(dirname "$0")/.."
REPO="${REPO:-BigBhubbha/letterhead-mac}"
VER=$(node -p "require('./package.json').version")
OUT="$PWD/release" REPO="$REPO" sh scripts/build.sh
gh release create "v$VER" --repo "$REPO" --title "Letterhead $VER" --notes "${NOTES:-Letterhead $VER}" \
  "release/Letterhead-$VER-AppleSilicon.zip" "release/Letterhead-$VER-Intel.zip" "release/Letterhead-$VER-macOS-both.zip" "release/latest.json"
echo "Published https://github.com/$REPO/releases/tag/v$VER"
