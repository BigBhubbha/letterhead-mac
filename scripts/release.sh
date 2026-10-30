#!/bin/sh
# Publish a new version. Bump "version" in package.json, commit and push, then:
#   NOTES="What changed" scripts/release.sh
# This starts the GitHub Actions workflow, which runs every test, builds and signs on a real Mac,
# launches the app there, and only publishes if all of that passes. Installed copies read
# releases/latest/download/latest.json and update on their next check.
set -eu
cd "$(dirname "$0")/.."
REPO="${REPO:-BigBhubbha/letterhead-mac}"
VER=$(node -p "require('./package.json').version")
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first."; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Push main first."; exit 1; }
gh workflow run release.yml --repo "$REPO" --ref main -f publish=true -f notes="${NOTES:-Letterhead $VER}"
sleep 5
RUN=$(gh run list --repo "$REPO" --workflow release.yml --event workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId')
echo "Workflow run: https://github.com/$REPO/actions/runs/$RUN"
gh run watch "$RUN" --repo "$REPO" --exit-status --interval 30
echo "Published https://github.com/$REPO/releases/tag/v$VER"
