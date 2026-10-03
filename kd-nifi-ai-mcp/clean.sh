#!/usr/bin/env bash
# Clean generated / working files in kd-nifi-ai-mcp and, unless --no-peer is
# passed, the sibling kd-sandbox-ai-demo package sitting next to this folder.
#
# Usage:
#   ./clean.sh              # clean this project, then sync+clean the sibling
#   ./clean.sh --no-peer    # clean only this project
#   ./clean.sh --dry-run    # print paths, do not delete
#   ./clean.sh --sync-only  # locate sibling and refresh shared contract files
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PEER_NAME="${KD_SANDBOX_DIR_NAME:-kd-sandbox-ai-demo}"
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
      sed -n '2,11p' "$0"
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
  # Generated at start.sh / allocate_ports.py — never ship a machine .env.
  remove_path ".env"
  remove_path "ports.json"
  remove_path ".nifi-wait.log"
  remove_path "install.log"

  # Python / editor / OS leftovers
  find . -type d -name '__pycache__' -prune -print 2>/dev/null | while read -r d; do
    remove_path "$d"
  done
  find . -type f \( \
      -name '*.pyc' -o -name '*.pyo' -o -name '*~' -o -name '*.tmp' \
      -o -name '*.bak' -o -name '.DS_Store' -o -name 'Thumbs.db' \
      -o -name 'npm-debug.log*' -o -name '*.log' \
    \) -print 2>/dev/null | while read -r f; do
    # Keep documentation that happens to be named *.log
    case "$f" in
      ./docs/*|./CHANGELOG.md) continue ;;
    esac
    remove_path "$f"
  done

  # Runtime custom objects (aaa.json and friends). Keep the folder + .gitkeep.
  if [[ -d templates/custom ]]; then
    find templates/custom -type f ! -name '.gitkeep' -print 2>/dev/null | while read -r f; do
      remove_path "$f"
    done
  fi

  # Compose / docker working dirs if someone ran start.sh in-tree
  remove_path ".compose-cache"
  remove_path "tmp"
  remove_path "work"
  remove_path ".work"

  if [[ "$DEEP" -eq 1 ]]; then
    remove_path "nars/.cache"
  fi
}

find_peer() {
  if [[ -n "${KD_SANDBOX_AI_DEMO_HOME:-}" && -d "$KD_SANDBOX_AI_DEMO_HOME" ]]; then
    cd "$KD_SANDBOX_AI_DEMO_HOME" && pwd
    return 0
  fi
  local parent
  parent="$(cd "$ROOT/.." && pwd)"
  local cand
  for cand in \
      "$parent/$PEER_NAME" \
      "$parent/${PEER_NAME}-nifi-align"* \
      "$parent/${PEER_NAME}"* \
      "$ROOT/../$PEER_NAME"
  do
    if [[ -d "$cand" && -f "$cand/clean.sh" ]]; then
      cd "$cand" && pwd
      return 0
    fi
  done
  return 1
}

sync_peer() {
  local peer="$1"
  echo "Syncing contract with $peer"
  mkdir -p "$peer/docs" docs
  if [[ -f docs/SANDBOX-ALIGNMENT.md && ! -f "$peer/docs/NIFI_AI_ALIGNMENT.md" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "Would copy docs/SANDBOX-ALIGNMENT.md → $peer/docs/NIFI_AI_ALIGNMENT.md"
    else
      # Peer already has its own alignment doc in current trees; only fill a gap.
      cp -f docs/SANDBOX-ALIGNMENT.md "$peer/docs/NIFI_AI_ALIGNMENT.md"
    fi
  fi
  # Mirror empty custom catalog on the peer if it vendors templates.
  if [[ -d "$peer/templates/custom" ]]; then
    find "$peer/templates/custom" -type f ! -name '.gitkeep' -print 2>/dev/null | while read -r f; do
      remove_path "$f"
    done
  fi
}

clean_self

if [[ "$NO_PEER" -eq 1 ]]; then
  echo "Peer sync skipped (--no-peer)."
  echo "Clean complete."
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
  if [[ -x "$PEER/clean.sh" || -f "$PEER/clean.sh" ]]; then
    echo "Running peer clean --no-peer"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      bash "$PEER/clean.sh" --no-peer --dry-run
    else
      bash "$PEER/clean.sh" --no-peer
    fi
  fi
else
  echo "No sibling $PEER_NAME found next to $ROOT (set KD_SANDBOX_AI_DEMO_HOME to override)."
fi

echo "Clean complete."
