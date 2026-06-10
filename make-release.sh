#!/usr/bin/env bash
# make-release.sh — builds truth-or-dare-2.zip ready for a GitHub release
# Usage: ./make-release.sh [version]   e.g.  ./make-release.sh v1.0.0
set -e

VERSION="${1:-v1.0.0}"
OUTDIR="$(pwd)"
TMPDIR_BASE="$(mktemp -d)"
STAGE="$TMPDIR_BASE/truth-or-dare-2"

echo ""
echo " Building Truth or Dare 2.0 release $VERSION..."

# ── Ensure node_modules are present so they can be bundled ──────────────────
if [ ! -d "node_modules" ]; then
  echo " Installing dependencies..."
  npm install --silent
fi

# ── Stage the release files ──────────────────────────────────────────────────
mkdir -p "$STAGE"

EXCLUDE_PATTERNS=(
  '.git' '.gitignore' 'node_modules' 'test'
  'CLAUDE.md' 'BUILD_SPEC.md' 'PHASE3_GOAL.md'
  'railway.toml' 'make-release.sh' '*.zip' '.DS_Store' 'Thumbs.db'
)

# Copy everything except excluded files/dirs
find . -mindepth 1 -maxdepth 1 | while read -r item; do
  name="$(basename "$item")"
  skip=0
  for pat in "${EXCLUDE_PATTERNS[@]}"; do
    case "$name" in $pat) skip=1; break;; esac
  done
  [ "$skip" -eq 0 ] && cp -r "$item" "$STAGE/"
done

# Bundle production node_modules
npm ci --omit=dev --silent --prefix "$STAGE" > /dev/null 2>&1 || \
  cp -r node_modules "$STAGE/node_modules"

# ── Zip ──────────────────────────────────────────────────────────────────────
ZIPFILE="$OUTDIR/truth-or-dare-2.zip"
rm -f "$ZIPFILE"
(cd "$TMPDIR_BASE" && zip -qr "$ZIPFILE" truth-or-dare-2/)

rm -rf "$TMPDIR_BASE"

SIZE=$(du -sh "$ZIPFILE" | cut -f1)
echo " Done! → truth-or-dare-2.zip ($SIZE)"
echo ""
echo " To create a GitHub release:"
echo "   git tag $VERSION && git push origin $VERSION"
echo "   gh release create $VERSION truth-or-dare-2.zip \\"
echo "     --title \"Truth or Dare 2.0 $VERSION\" \\"
echo "     --notes \"See README for setup instructions.\""
echo ""
