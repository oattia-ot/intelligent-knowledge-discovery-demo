#!/usr/bin/env bash
# Hard restart: stop anything on :4200, then ./serve.sh
# serve.sh stamps assets/build-id.json so open browsers auto hard-refresh.
set -euo pipefail

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PKG_ROOT="$(cd "$WEB/../../.." && pwd)"
if [[ -f "$_PKG_ROOT/scripts/require-server-runtime.sh" ]]; then
  # shellcheck disable=SC1091
  source "$_PKG_ROOT/scripts/require-server-runtime.sh"
  require_server_runtime || exit 1
fi
cd "$WEB"

echo "Stopping processes on port 4200 (if any)..."
if command -v fuser >/dev/null 2>&1; then
  fuser -k 4200/tcp 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -t -iTCP:4200 -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${PIDS:-}" ]]; then
    # shellcheck disable=SC2086
    kill $PIDS 2>/dev/null || true
    sleep 1
  fi
else
  # best-effort
  pkill -f "ng serve" 2>/dev/null || true
  pkill -f "angular.*4200" 2>/dev/null || true
fi

sleep 0.5
echo "Starting..."
exec bash "$WEB/serve.sh"
