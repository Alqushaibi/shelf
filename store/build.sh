#!/usr/bin/env bash
# Builds store-package.zip, the file that is uploaded to the Chrome Web Store.
# Usage: SUPABASE_URL=... SUPABASE_KEY=... bash store/build.sh   (run from the repository root)
set -euo pipefail

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_KEY:-}" ]; then echo "Set SUPABASE_URL and SUPABASE_KEY first." >&2; exit 1; fi
case "$SUPABASE_KEY" in sb_secret_*) echo "SUPABASE_KEY must be the publishable key, not a secret key." >&2; exit 1 ;; esac

OUT=build/store
rm -rf "$OUT" store-package.zip
mkdir -p "$OUT"
cp -r extension/. "$OUT/"

# Files that are for developers, not for the published extension.
rm -f "$OUT"/*.sql "$OUT"/config.example.js "$OUT"/README.md

printf "export const SUPABASE_URL = '%s';\nexport const SUPABASE_KEY = '%s';\n" "$SUPABASE_URL" "$SUPABASE_KEY" > "$OUT/config.js"

# The store assigns the extension's ID itself and refuses a manifest that has a "key".
# Access is limited to this project's own server instead of every Supabase address.
ORIGIN=$(printf '%s' "$SUPABASE_URL" | sed -E 's#^(https?://[^/]+).*#\1#')
jq --arg host "$ORIGIN/*" 'del(.key) | .host_permissions = [$host]' extension/manifest.json > "$OUT/manifest.json"

(cd "$OUT" && zip -qr ../../store-package.zip .)
echo "Built store-package.zip, version $(jq -r .version "$OUT/manifest.json"):"
unzip -l store-package.zip | tail -n +4 | head -n -2 | awk '{print "  " $4}'
