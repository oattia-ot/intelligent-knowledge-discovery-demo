#!/usr/bin/env bash
# Persist ORCHESTRATOR_PUBLIC_URL from a host external/public IPv4.
#
# Safe to re-run on every startup. Private / loopback / link-local
# addresses are skipped so a laptop on RFC1918 keeps localhost.
#
# Usage:
#   configure_orchestrator_public_url.sh [--env PATH] [--update-only] [--recreate] [--verify]
#                                        [--project NAME] [--port 27110] [--ui-port 27120]
set -euo pipefail

ENV_FILE=".env"
UPDATE_ONLY=0
RECREATE=0
VERIFY=0
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
ORCH_PORT="${ORCHESTRATOR_HOST_PORT:-27110}"
UI_PORT="${UI_HOST_PORT:-27120}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --update-only) UPDATE_ONLY=1; shift ;;
    --recreate) RECREATE=1; shift ;;
    --verify) VERIFY=1; shift ;;
    --project|--project-name) PROJECT_NAME="$2"; shift 2 ;;
    --port) ORCH_PORT="$2"; shift 2 ;;
    --ui-port) UI_PORT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NIFI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$NIFI_ROOT"

if [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$NIFI_ROOT/$ENV_FILE"
fi

is_private_ipv4() {
  local ip="$1"
  local a= b= c= d=
  case "$ip" in
    ''|*[!0-9.]*) return 0 ;;
  esac
  IFS=. read -r a b c d _ <<< "$ip"
  [[ -z "${a:-}" || -z "${b:-}" || -z "${c:-}" || -z "${d:-}" ]] && return 0
  # loopback 127.0.0.0/8
  [[ "$a" -eq 127 ]] && return 0
  # this-network / unspecified
  [[ "$a" -eq 0 ]] && return 0
  # RFC1918 10.0.0.0/8
  [[ "$a" -eq 10 ]] && return 0
  # RFC1918 192.168.0.0/16
  [[ "$a" -eq 192 && "$b" -eq 168 ]] && return 0
  # RFC1918 172.16.0.0/12
  [[ "$a" -eq 172 && "$b" -ge 16 && "$b" -le 31 ]] && return 0
  # link-local 169.254.0.0/16
  [[ "$a" -eq 169 && "$b" -eq 254 ]] && return 0
  return 1
}

collect_host_ipv4s() {
  local raw=""
  if command -v hostname >/dev/null 2>&1; then
    raw+=" $(hostname -I 2>/dev/null || true)"
  fi
  if command -v ip >/dev/null 2>&1; then
    raw+=" $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' ')"
    raw+=" $(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')"
  fi
  if command -v hostnamectl >/dev/null 2>&1; then
    :
  fi
  printf '%s\n' $raw
}

first_public_ipv4() {
  local ip
  for ip in $(collect_host_ipv4s); do
    case "$ip" in
      *:*) continue ;;
    esac
    if ! is_private_ipv4 "$ip"; then
      printf '%s\n' "$ip"
      return 0
    fi
  done
  return 1
}

upsert_env_url() {
  local file="$1" url="$2"
  local tmp
  if [[ ! -f "$file" ]]; then
    printf 'ORCHESTRATOR_PUBLIC_URL=%s\n' "$url" > "$file"
    return 0
  fi
  if grep -q '^ORCHESTRATOR_PUBLIC_URL=' "$file" 2>/dev/null; then
    tmp="$(mktemp)"
    # Replace the existing assignment in place; keep the rest of the file intact.
    awk -v url="$url" '
      BEGIN { done=0 }
      /^ORCHESTRATOR_PUBLIC_URL=/ {
        if (!done) { print "ORCHESTRATOR_PUBLIC_URL=" url; done=1; next }
      }
      { print }
      END { if (!done) print "ORCHESTRATOR_PUBLIC_URL=" url }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '\nORCHESTRATOR_PUBLIC_URL=%s\n' "$url" >> "$file"
  fi
}

current_env_url() {
  if [[ -f "$ENV_FILE" ]]; then
    awk -F= '/^ORCHESTRATOR_PUBLIC_URL=/{print $2}' "$ENV_FILE" | tail -1
  fi
}

recreate_ui() {
  local compose=(docker compose --env-file "$ENV_FILE")
  if [[ -n "$PROJECT_NAME" ]]; then
    compose+=(-p "$PROJECT_NAME")
  fi
  echo "Rebuilding UI so it picks up ORCHESTRATOR_PUBLIC_URL=$1"
  "${compose[@]}" up -d --build --force-recreate ui
}

verify_ui() {
  local expected_ip="$1"
  local html picked
  local tries=0
  while [[ $tries -lt 15 ]]; do
    html="$(curl -s "http://127.0.0.1:${UI_PORT}/" || true)"
    picked="$(printf '%s' "$html" | grep -o 'http://[^"]*27110' | head -1 || true)"
    if [[ -n "$picked" ]]; then
      echo "UI orchestrator URL: $picked"
      if [[ "$picked" == *"$expected_ip"* ]]; then
        echo "Verified ORCHESTRATOR_PUBLIC_URL was picked up by the UI."
        return 0
      fi
      echo "UI still reports $picked (expected host $expected_ip) — waiting…"
    else
      echo "UI at 127.0.0.1:${UI_PORT} not ready or URL not injected — waiting…"
    fi
    tries=$((tries + 1))
    sleep 2
  done
  echo "Warning: could not confirm http://<external-ip>:27110 in UI HTML." >&2
  return 0
}

if [[ -f "$ENV_FILE" ]]; then
  set +u
  # shellcheck disable=SC1090
  ORCH_PORT="$(awk -F= '/^ORCHESTRATOR_HOST_PORT=/{print $2}' "$ENV_FILE" | tail -1)"
  UI_FROM_ENV="$(awk -F= '/^UI_HOST_PORT=/{print $2}' "$ENV_FILE" | tail -1)"
  set -u
  ORCH_PORT="${ORCH_PORT:-27110}"
  UI_PORT="${UI_FROM_ENV:-$UI_PORT}"
fi

PUBLIC_IP=""
if PUBLIC_IP="$(first_public_ipv4)"; then
  echo "Detected external host IP: $PUBLIC_IP"
else
  echo "No public/external IPv4 on this host (private/loopback/link-local only) — leaving ORCHESTRATOR_PUBLIC_URL unchanged."
  exit 0
fi

TARGET_URL="http://${PUBLIC_IP}:${ORCH_PORT}"
PREV_URL="$(current_env_url || true)"

if [[ "$PREV_URL" == "$TARGET_URL" ]]; then
  echo "ORCHESTRATOR_PUBLIC_URL already $TARGET_URL"
else
  upsert_env_url "$ENV_FILE" "$TARGET_URL"
  echo "Wrote ORCHESTRATOR_PUBLIC_URL=$TARGET_URL to $ENV_FILE"
fi

if [[ "$UPDATE_ONLY" -eq 1 ]]; then
  exit 0
fi

if [[ "$RECREATE" -eq 1 ]]; then
  if command -v docker >/dev/null 2>&1; then
    recreate_ui "$TARGET_URL"
  else
    echo "docker not available — skipped UI recreate." >&2
  fi
fi

if [[ "$VERIFY" -eq 1 ]]; then
  verify_ui "$PUBLIC_IP"
fi
