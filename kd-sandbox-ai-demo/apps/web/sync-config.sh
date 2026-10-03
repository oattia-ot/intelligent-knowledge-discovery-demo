#!/usr/bin/env bash
# Copy TAX_GOV_AE/config/*.json (and templates) into apps/web/src/assets/config/
# so the SPA serves the latest defaults without a full rebuild of sources.
set -euo pipefail

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# apps/web → TAX_GOV_AE
REPO="$(cd "$WEB/../.." && pwd)"
SRC="$REPO/config"
DEST="$WEB/src/assets/config"

if [[ ! -d "$SRC" ]]; then
  echo "sync-config: source not found: $SRC (skip)"
  exit 0
fi

# Regenerate host-derived fields in config.json / endpoint-health.json.
# Host resolution: KD_UPSTREAM_HOST env var > "upstreamHost" in
# config/config.json > hardcoded fallback — see upstream.config.mjs.
if [[ -f "$WEB/scripts/generate-config.mjs" ]]; then
  echo "sync-config: regenerating host-derived config..."
  node "$WEB/scripts/generate-config.mjs"
fi

mkdir -p "$DEST" "$DEST/templates/result-url"

echo "sync-config: $SRC → $DEST"
# JSON configs
shopt -s nullglob
for f in "$SRC"/*.json; do
  if [[ "$(basename "$f")" == "answer.json" ]]; then
    # assets/ is served to browsers: strip the external LLM apiKey.
    node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(j.externalLlm)delete j.externalLlm.apiKey;fs.writeFileSync(process.argv[2],JSON.stringify(j,null,2)+"\n")' "$f" "$DEST/answer.json"
  else
    cp -f "$f" "$DEST/$(basename "$f")"
  fi
  echo "  $(basename "$f")"
done

# Handlebars templates used by result-url service
if [[ -d "$SRC/templates/result-url" ]]; then
  mkdir -p "$DEST/templates/result-url"
  for f in "$SRC/templates/result-url"/*; do
    [[ -f "$f" ]] || continue
    cp -f "$f" "$DEST/templates/result-url/$(basename "$f")"
    echo "  templates/result-url/$(basename "$f")"
  done
fi

echo "sync-config: done"
