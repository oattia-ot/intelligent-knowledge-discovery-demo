#!/usr/bin/env bash
# Preferred local start for KD Enterprise Search.
# - Checks Node 22 (Angular 21; Node 21 breaks the CLI)
# - Syncs root config/ → src/assets/config/
# - Serves on 0.0.0.0:4200 with the ACI dev proxy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PKG_ROOT="$(cd "$ROOT/../../.." && pwd)"
if [[ -f "$_PKG_ROOT/scripts/require-server-runtime.sh" ]]; then
  # shellcheck disable=SC1091
  source "$_PKG_ROOT/scripts/require-server-runtime.sh"
  require_server_runtime || exit 1
fi
NODE="$(command -v node)"
cd "$ROOT"

if [[ -f .nvmrc ]] && command -v nvm >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  nvm use >/dev/null || true
elif [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null || true
fi

NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [[ "$NODE_MAJOR" -eq 21 ]]; then
  echo "ERROR: Node 21 is not supported (Angular CLI ERR_REQUIRE_ESM)."
  echo "Use Node 22 LTS:  nvm install 22 && nvm use"
  exit 1
fi
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ERROR: Node $NODE_MAJOR is too old. Need ^20.19 || ^22.12 || >=24."
  exit 1
fi

NPM_MAJOR="$(npm -v 2>/dev/null | sed -E 's/^([0-9]+).*/\1/' || echo 0)"
echo "Node $(node -v) | npm $(npm -v)"
if [[ "$NPM_MAJOR" -lt 10 ]]; then
  echo "WARNING: package.json recommends npm >=10. Continuing with npm $NPM_MAJOR because npm 9 can still install this lockfile."
fi

# Angular CLI is a devDependency. Do not use `npx ng` here because npx can fail
# with "could not determine executable to run" when node_modules is absent,
# incomplete, or devDependencies were omitted.
NG_BIN="$ROOT/node_modules/.bin/ng"
NG_JS="$ROOT/node_modules/@angular/cli/bin/ng.js"

install_web_deps() {
  echo "Removing incomplete node_modules (avoids TAR_ENTRY_ERROR ENOENT)..."
  rm -rf "$ROOT/node_modules"
  echo "npm install --include=dev..."
  npm install --include=dev --ignore-scripts=false
  echo "npm audit fix (non-blocking)..."
  npm audit fix || echo "WARNING: npm audit fix reported issues; continuing."
}

if [[ ! -x "$NG_BIN" && ! -f "$NG_JS" ]]; then
  echo "Angular CLI is missing. Installing project dependencies including devDependencies..."
  install_web_deps
elif [[ -d "$ROOT/node_modules" && ! -f "$ROOT/node_modules/.package-lock.json" && ! -f "$ROOT/node_modules/@angular/cli/package.json" ]]; then
  echo "node_modules looks incomplete. Reinstalling..."
  install_web_deps
fi

if [[ "${KD_NPM_AUDIT_FIX:-1}" != "0" && ! -f "$ROOT/.kd-audit-done" ]]; then
  echo "npm audit fix (non-blocking)..."
  npm audit fix || echo "WARNING: npm audit fix reported issues; continuing."
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$ROOT/.kd-audit-done" || true
fi

# Some environments create the package but not the .bin shim. Prefer the shim,
# otherwise invoke Angular CLI's real entry point directly.
if [[ -x "$NG_BIN" ]]; then
  NG_CMD=("$NG_BIN")
elif [[ -f "$NG_JS" ]]; then
  NG_CMD=("$NODE" "$NG_JS")
else
  echo "ERROR: Angular CLI was not installed correctly."
  echo "Expected either: $NG_BIN"
  echo "or: $NG_JS"
  echo "Run: npm install --include=dev"
  exit 1
fi

# Sync config JSON from repo root into the SPA assets (if present)
if [[ -x "$ROOT/sync-config.sh" ]]; then
  "$ROOT/sync-config.sh"
fi

# Stamp a new build id so open browsers hard-refresh after this serve/restart.
BUILD_ID_FILE="$ROOT/src/assets/build-id.json"
BUILD_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$(dirname "$BUILD_ID_FILE")"
printf '{"id":"%s","ts":"%s"}\n' "$BUILD_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BUILD_ID_FILE"
echo "Hard-refresh build id: $BUILD_ID"

# The '/__kd-probe' proxy entry (proxy.conf.mjs) forwards to a standalone
# probe server on 127.0.0.1:$KD_PROBE_PORT (default 4300) — see
# scripts/probe-server.mjs for why this has to be a separate process.
# `npm start` launches it via scripts/dev.mjs; this script calls `ng serve`
# directly, so it has to start (and clean up) the probe server itself, or
# every Settings → Test click fails with ECONNREFUSED 127.0.0.1:4300
# instead of reaching the real upstream (e.g. http://127.0.0.1:9030/action=getstatus).
PROBE_PORT="${KD_PROBE_PORT:-4300}"
PROBE_PID=""

# The '/__kd-admin' proxy entry (proxy.conf.mjs) forwards to
# admin-server.mjs, which powers the Settings -> "Backend upstream
# host" Save button (writes config/config.json + regenerates the
# derived config files). `npm start` launches it via scripts/dev.mjs
# with restart-on-save support; this script starts it in "save only"
# mode instead (no onRestart — serve.sh has no handle on the `ng
# serve` child to respawn it). Without this running at all, Save
# requests hit ECONNREFUSED against 127.0.0.1:$KD_ADMIN_PORT and the
# Settings UI fails with no way to persist a new host.
ADMIN_PORT="${KD_ADMIN_PORT:-4301}"
ADMIN_PID=""
ADMIN_CONFIG_PORT="${ADMIN_CONFIG_PORT:-4201}"
ADMIN_CONFIG_PID=""

cleanup() {
  if [[ -n "$PROBE_PID" ]] && kill -0 "$PROBE_PID" 2>/dev/null; then
    kill "$PROBE_PID" 2>/dev/null || true
  fi
  if [[ -n "$ADMIN_PID" ]] && kill -0 "$ADMIN_PID" 2>/dev/null; then
    kill "$ADMIN_PID" 2>/dev/null || true
  fi
  if [[ -n "$ADMIN_CONFIG_PID" ]] && kill -0 "$ADMIN_CONFIG_PID" 2>/dev/null; then
    kill "$ADMIN_CONFIG_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

http_ready() {
  local port="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${port}/"
    return $?
  fi
  "$NODE" -e "fetch('http://127.0.0.1:${port}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
}

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$port"/tcp 2>/dev/null | tr -s ' ' || true
  fi
}

if http_ready "$PROBE_PORT"; then
  echo "Probe server already running on 127.0.0.1:${PROBE_PORT}, leaving it be."
elif [[ -n "$(port_pids "$PROBE_PORT")" ]]; then
  echo "Port ${PROBE_PORT} is already in use but not answering HTTP — leaving the existing listener (probe-server will reuse it)."
else
  echo "Starting probe server on 127.0.0.1:${PROBE_PORT}..."
  "$NODE" "$ROOT/scripts/probe-server.mjs" &
  PROBE_PID=$!
  # Give it a moment to bind before ng serve starts proxying to it.
  for i in $(seq 1 20); do
    http_ready "$PROBE_PORT" && break
    sleep 0.2
  done
fi

if http_ready "$ADMIN_PORT"; then
  echo "Admin server already running on 127.0.0.1:${ADMIN_PORT}, leaving it be."
elif [[ -n "$(port_pids "$ADMIN_PORT")" ]]; then
  echo "Port ${ADMIN_PORT} is already in use but not answering HTTP — leaving the existing listener (admin-server will reuse it)."
else
  echo "Starting admin server on 127.0.0.1:${ADMIN_PORT} (save-only mode, no auto-restart)..."
  "$NODE" "$ROOT/scripts/start-admin-save-only.mjs" &
  ADMIN_PID=$!
  for i in $(seq 1 20); do
    http_ready "$ADMIN_PORT" && break
    sleep 0.2
  done
fi

if http_ready "$ADMIN_CONFIG_PORT"; then
  echo "Admin-config API already running on 127.0.0.1:${ADMIN_CONFIG_PORT}, leaving it be."
elif [[ -n "$(port_pids "$ADMIN_CONFIG_PORT")" ]]; then
  echo "Port ${ADMIN_CONFIG_PORT} is already in use but not answering HTTP — leaving the existing listener."
elif [[ -f "$ROOT/admin-config-api.mjs" ]]; then
  echo "Starting admin-config API on 127.0.0.1:${ADMIN_CONFIG_PORT}..."
  ADMIN_CONFIG_PORT="$ADMIN_CONFIG_PORT" "$NODE" "$ROOT/admin-config-api.mjs" &
  ADMIN_CONFIG_PID=$!
  for i in $(seq 1 20); do
    http_ready "$ADMIN_CONFIG_PORT" && break
    sleep 0.2
  done
fi

# Check port 4200 ourselves before handing off to `ng serve`. Angular's
# own "Port 4200 is already in use. Would you like to use a different
# port?" prompt throws an unhandled exception instead of asking cleanly
# in a lot of terminals (non-TTY shells, some IDE run panels), e.g.:
#   An unhandled exception occurred: Port 4200 is already in use.
#   Use '--port' to specify a different port.
PORT=4200
if command -v lsof >/dev/null 2>&1; then
  PORT_PIDS="$(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
elif command -v fuser >/dev/null 2>&1; then
  PORT_PIDS="$(fuser "$PORT"/tcp 2>/dev/null | tr -s ' ' || true)"
else
  PORT_PIDS=""
fi

if [[ -n "${PORT_PIDS:-}" ]]; then
  echo "Port $PORT is already in use."
  for pid in $PORT_PIDS; do
    if command -v ps >/dev/null 2>&1; then
      CMD="$(ps -p "$pid" -o comm= 2>/dev/null || echo unknown)"
    else
      CMD="unknown"
    fi
    echo "  PID $pid  ($CMD)"
  done

  if [[ -t 0 ]]; then
    read -r -p "Kill the process using port $PORT? (y/N) " ANSWER
  else
    echo "Not an interactive terminal, so I can't ask. Free the port yourself (e.g. \`kill $PORT_PIDS\`) or rerun with a different port."
    exit 1
  fi

  case "${ANSWER,,}" in
    y|yes)
      # shellcheck disable=SC2086
      kill $PORT_PIDS 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      if command -v lsof >/dev/null 2>&1 && lsof -t -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        read -r -p "Port $PORT is still in use. Force kill (-9)? (y/N) " FORCE_ANSWER
        if [[ "${FORCE_ANSWER,,}" == "y" || "${FORCE_ANSWER,,}" == "yes" ]]; then
          kill -9 $PORT_PIDS 2>/dev/null || true
          sleep 1
        fi
      fi
      echo "Port $PORT is now free."
      ;;
    *)
      echo "Leaving it running. Not starting the dev server."
      exit 1
      ;;
  esac
fi

# Demo/hosting default: disable live-reload/HMR so writing config JSON or a
# dropped websocket cannot full-reload the main page every few seconds.
# Developers who want hot reload: KD_LIVE_RELOAD=1 ./serve.sh
LIVE_RELOAD_ARGS=()
if [[ "${KD_LIVE_RELOAD:-0}" != "1" ]]; then
  LIVE_RELOAD_ARGS+=(--live-reload false --hmr false)
  echo "Live reload OFF (set KD_LIVE_RELOAD=1 to enable while developing)."
else
  echo "Live reload ON (KD_LIVE_RELOAD=1)."
fi

echo "Starting ng serve on 0.0.0.0:4200 (proxy: proxy.conf.mjs, host: ${KD_UPSTREAM_HOST:-127.0.0.1})..."
echo "  Local:  http://localhost:4200/"
echo "  LAN:    http://<this-host>:4200/"
echo "  Tip: export KD_UPSTREAM_HOST=<ip-or-fqdn> before running to point at a different backend."
"${NG_CMD[@]}" serve --host 0.0.0.0 --port 4200 --proxy-config proxy.conf.mjs "${LIVE_RELOAD_ARGS[@]}"
NG_EXIT=$?
cleanup
trap - EXIT
exit "$NG_EXIT"
