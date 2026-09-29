#!/usr/bin/env bash
# Clean generated / working files in kd-sandbox-ai-demo and, unless --no-peer
# is passed, the sibling kd-nifi-ai-mcp package sitting next to this folder.
#
# Usage:
#   ./clean.sh              # clean this project, then sync+clean the sibling
#   ./clean.sh --no-peer    # clean only this project
#   ./clean.sh --dry-run    # print paths, do not delete
#   ./clean.sh --sync-only  # locate sibling and refresh shared contract files
#   ./clean.sh --deep       # also drop package-lock.json
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PEER_NAME="${KD_NIFI_DIR_NAME:-kd-nifi-ai-mcp}"
DRY_RUN=0
NO_PEER=0
SYNC_ONLY=0
DEEP=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-peer) NO_PEER=1 ;;
    --sync-only) SYNC_ONLY=1 ;;
    --deep) DEEP=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --dry-run, --no-peer, --sync-only, --deep)" >&2
      exit 1
      ;;
  esac
done

remove_path() {
  local path="$1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Would remove: $path"
  else
    echo "Removing: $path"
    rm -rf -- "$path"
  fi
}

clean_self() {
  echo "Cleaning $ROOT"
  local targets=(
    "apps/web/node_modules"
    "apps/web/dist"
    "apps/web/.angular"
    "apps/web/coverage"
    "apps/web/.nx-cache"
    "apps/web/.kd-audit-done"
    "tmp"
    "work"
    ".work"
    ".compose-cache"
  )
  if [[ "$DEEP" -eq 1 ]]; then
    targets+=("apps/web/package-lock.json")
  fi

  local rel
  for rel in "${targets[@]}"; do
    remove_path "$rel"
  done

  # Logs and editor leftovers anywhere under the package
  find . -type d \( -name 'node_modules' -o -name '.angular' -o -name 'dist' -o -name 'coverage' \) -prune -o \
    -type f \( \
      -name 'npm-debug.log*' -o -name '*.log' -o -name '*~' -o -name '*.tmp' \
      -o -name '*.bak' -o -name '.DS_Store' -o -name 'Thumbs.db' \
      -o -name '.kd-audit-done' \
    \) -print 2>/dev/null | while read -r f; do
    case "$f" in
      ./docs/*|./CHANGELOG.md|./apps/web/CHANGELOG.md) continue ;;
    esac
    remove_path "$f"
  done
}

find_peer() {
  if [[ -n "${KD_NIFI_AI_MCP_HOME:-}" && -d "$KD_NIFI_AI_MCP_HOME" ]]; then
    cd "$KD_NIFI_AI_MCP_HOME" && pwd
    return 0
  fi
  local parent
  parent="$(cd "$ROOT/.." && pwd)"
  local cand
  for cand in \
      "$parent/$PEER_NAME" \
      "$parent/${PEER_NAME}-"* \
      "$parent/${PEER_NAME}"* \
      "$ROOT/../$PEER_NAME"
  do
    if [[ -d "$cand" && ( -f "$cand/clean.sh" || -f "$cand/start.sh" ) ]]; then
      cd "$cand" && pwd
      return 0
    fi
  done
  return 1
}

sync_peer() {
  local peer="$1"
  echo "Syncing contract with $peer"
  # Drop leftover custom catalog files on the NiFi AI side so both packages
  # start from the same empty custom list after a clean.
  if [[ -d "$peer/templates/custom" ]]; then
    find "$peer/templates/custom" -type f ! -name '.gitkeep' -print 2>/dev/null | while read -r f; do
      remove_path "$f"
    done
  fi
  # Generated machine state on the NiFi AI side
  remove_path "$peer/.env"
  remove_path "$peer/ports.json"
}

clean_self

if [[ "$NO_PEER" -eq 1 ]]; then
  echo "Peer sync skipped (--no-peer)."
  echo "Clean complete."
  echo "Run 'cd apps/web && npm install --include=dev' to reinstall dependencies."
  exit 0
fi

PEER=""
if PEER="$(find_peer)"; then
  echo "Peer project: $PEER"
  sync_peer "$PEER"
  if [[ "$SYNC_ONLY" -eq 1 ]]; then
    echo "Sync-only complete."
    exit 0
  fi
  if [[ -f "$PEER/clean.sh" ]]; then
    echo "Running peer clean --no-peer"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      bash "$PEER/clean.sh" --no-peer --dry-run
    else
      bash "$PEER/clean.sh" --no-peer
    fi
  fi
else
  echo "No sibling $PEER_NAME found next to $ROOT (set KD_NIFI_AI_MCP_HOME to override)."
fi

echo "Clean complete."
echo "Run 'cd apps/web && npm install --include=dev' to reinstall dependencies."
