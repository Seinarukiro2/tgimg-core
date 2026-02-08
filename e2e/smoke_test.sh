#!/usr/bin/env bash
# ─── tgimg E2E smoke test ──────────────────────────────────────
#
# Verifies the full pipeline: build → manifest → validate → react.
# Run: bash e2e/smoke_test.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="$ROOT/e2e/fixtures"
OUT="$ROOT/e2e/_out"
CLI="$ROOT/cli/tgimg"

echo "═══ tgimg E2E smoke test ═══"
echo

# ─── Step 0: Build CLI ────────────────────────────────────────
echo "→ Building CLI..."
(cd "$ROOT/cli" && go build -o tgimg .)
echo "  ✓ CLI built"

# ─── Step 1: Create fixture images (Go) ──────────────────────
echo "→ Creating fixture images..."
mkdir -p "$FIXTURES"
(cd "$ROOT/cli" && go run "$ROOT/e2e/gen_fixtures.go" "$FIXTURES")
echo "  ✓ Fixtures created"

# ─── Step 2: Run tgimg build ─────────────────────────────────
echo "→ Running tgimg build..."
rm -rf "$OUT"
"$CLI" build "$FIXTURES" --out "$OUT" --profile minimal --workers 2 --verbose
echo "  ✓ Build complete"

# ─── Step 3: Verify manifest exists ──────────────────────────
MANIFEST="$OUT/tgimg.manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "  ✗ FAIL: manifest not found at $MANIFEST"
  exit 1
fi
echo "  ✓ Manifest exists"

# ─── Step 4: Validate manifest ───────────────────────────────
echo "→ Validating manifest..."
"$CLI" validate "$MANIFEST"
echo "  ✓ Manifest valid"

# ─── Step 5: Check stats ─────────────────────────────────────
echo "→ Running stats..."
"$CLI" stats "$OUT"

# ─── Step 6: Verify variant files exist ──────────────────────
echo "→ Checking variant files..."
VARIANT_COUNT=$(find "$OUT" -name '*.webp' -o -name '*.jpeg' -o -name '*.jpg' -o -name '*.avif' | wc -l | tr -d ' ')
if [ "$VARIANT_COUNT" -eq 0 ]; then
  echo "  ✗ FAIL: no variant files found"
  exit 1
fi
echo "  ✓ Found $VARIANT_COUNT variant files"

# ─── Step 7: Verify manifest has thumbhash for each asset ────
echo "→ Checking thumbhash coverage..."
MISSING_TH=$(python3 -c "
import json, sys
m = json.load(open('$MANIFEST'))
missing = [k for k, a in m['assets'].items() if not a.get('thumbhash')]
if missing:
    print(', '.join(missing))
    sys.exit(1)
" 2>&1 || true)
if [ -n "$MISSING_TH" ]; then
  echo "  ✗ FAIL: missing thumbhash for: $MISSING_TH"
  exit 1
fi
echo "  ✓ All assets have thumbhash"

# ─── Step 8: Verify manifest version ─────────────────────────
echo "→ Checking manifest version..."
VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])")
if [ "$VERSION" != "1" ]; then
  echo "  ✗ FAIL: unexpected manifest version: $VERSION"
  exit 1
fi
echo "  ✓ Manifest version: $VERSION"

# ─── Step 9: Verify build_info present ────────────────────────
echo "→ Checking build_info..."
python3 -c "
import json, sys
m = json.load(open('$MANIFEST'))
bi = m.get('build_info')
if not bi:
    print('  ✗ FAIL: build_info missing')
    sys.exit(1)
print(f'  ✓ workers={bi[\"workers\"]}, pool_entry_kb={bi[\"pool_entry_kb\"]}')
"

# ─── Step 10: React tests ────────────────────────────────────
echo "→ Running React tests..."
(cd "$ROOT/packages/react" && npx vitest run --reporter=dot 2>&1 | tail -5)
echo "  ✓ React tests passed"

# ─── Cleanup ─────────────────────────────────────────────────
rm -rf "$OUT" "$FIXTURES"

echo
echo "═══ All E2E checks passed ═══"
