#!/usr/bin/env bash
# Gracefully stop running kd-demo services WITHOUT deleting build caches.
# Redeploying afterward stays fast.
#
# Usage:
#   ./undeploy.sh                 # stop everything that this package started
#   ./undeploy.sh --sandbox       # Angular dev server + helper ports only
#   ./undeploy.sh --nifi          # both local and external NiFi AI stacks
#   ./undeploy.sh --nifi-local    # compose project kd-nifi-ai-mcp
#   ./undeploy.sh --nifi-external # compose project kd-nifi-ai-mcp-ext
#   ./undeploy.sh --all           # same as default
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/colors.sh
source "$ROOT/scripts/colors.sh"
# shellcheck source=scripts/require-server-runtime.sh
source "$ROOT/scripts/require-server-runtime.sh"
require_server_runtime || exit 1

SANDBOX_DIR="$ROOT/kd-sandbox-ai-demo"
NIFI_DIR="$ROOT/kd-nifi-ai-mcp"
RUN_DIR="$ROOT/.run"
STATE_FILE="$RUN_DIR/state"

DO_SANDBOX=0
DO_NIFI_LOCAL=0
DO_NIFI_EXT=0
EXPLICIT=0

usage() { sed -n '2,14p' "$0"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sandbox) DO_SANDBOX=1; EXPLICIT=1; shift ;;
    --nifi) DO_NIFI_LOCAL=1; DO_NIFI_EXT=1; EXPLICIT=1; shift ;;
    --nifi-local) DO_NIFI_LOCAL=1; EXPLICIT=1; shift ;;
    --nifi-external) DO_NIFI_EXT=1; EXPLICIT=1; shift ;;
    --all) DO_SANDBOX=1; DO_NIFI_LOCAL=1; DO_NIFI_EXT=1; EXPLICIT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) kd_err "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

if [[ "$EXPLICIT" -eq 0 ]]; then
  DO_SANDBOX=1
  DO_NIFI_LOCAL=1
  DO_NIFI_EXT=1
fi

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$port"/tcp 2>/dev/null | tr -s ' ' || true
  fi
}

stop_ports() {
  local port
  for port in "$@"; do
    local pids
    pids="$(port_pids "$port")"
    if [[ -z "${pids// }" ]]; then
      continue
    fi
    kd_info "Stopping listeners on :$port ($pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
    pids="$(port_pids "$port")"
    if [[ -n "${pids// }" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  done
}

stop_sandbox() {
  kd_step "Stopping sandbox (dev server, keep node_modules / .angular)"
  if [[ -f "$RUN_DIR/sandbox.pid" ]]; then
    local pid
    pid="$(cat "$RUN_DIR/sandbox.pid" 2>/dev/null || true)"
    if [[ -n "$pid" && "$pid" != "existing" ]] && kill -0 "$pid" 2>/dev/null; then
      kd_info "Stopping serve.sh PID $pid"
      kill "$pid" 2>/dev/null || true
      sleep 0.5
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$RUN_DIR/sandbox.pid"
  fi
  # Angular + probe + admin helpers used by serve.sh
  stop_ports 4200 4300 4301 4201
  kd_ok "Sandbox stopped"
}

compose_down() {
  local project="$1"
  if ! command -v docker >/dev/null 2>&1; then
    kd_warn "docker not available — skip $project"
    return
  fi
  if [[ ! -f "$NIFI_DIR/docker-compose.yml" ]]; then
    return
  fi
  kd_info "docker compose -p $project stop / down (volumes kept)"
  local env_args=()
  if [[ -f "$NIFI_DIR/.env" ]]; then
    env_args+=(--env-file "$NIFI_DIR/.env")
  fi
  docker compose -p "$project" "${env_args[@]}" -f "$NIFI_DIR/docker-compose.yml" stop >/dev/null 2>&1 || true
  docker compose -p "$project" "${env_args[@]}" -f "$NIFI_DIR/docker-compose.yml" down --remove-orphans >/dev/null 2>&1 || true
  kd_ok "Compose project $project is down (caches / volumes kept)"
}

kd_banner "kd-demo  undeploy"

if [[ "$DO_SANDBOX" -eq 1 ]]; then
  stop_sandbox
fi
if [[ "$DO_NIFI_LOCAL" -eq 1 ]]; then
  kd_step "Stopping local NiFi AI stack"
  compose_down kd-nifi-ai-mcp
fi
if [[ "$DO_NIFI_EXT" -eq 1 ]]; then
  kd_step "Stopping external-NiFi AI stack"
  compose_down kd-nifi-ai-mcp-ext
fi

echo
kd_ok "Done. Caches left in place. Redeploy with ./init.sh"
echo
