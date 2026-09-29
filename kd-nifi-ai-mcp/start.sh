#!/usr/bin/env bash
# Interactive / flagged deploy for kd-nifi-ai-mcp.
# Called by the package-root install.sh:
#   ./start.sh --project-name kd-nifi-ai-mcp [--create-nifi] --nifi-user … --nifi-password … -- up -d --build
#   ./start.sh --project-name kd-nifi-ai-mcp-ext --nifi-url https://HOST:8443 … -- up -d --build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/../scripts/colors.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/../scripts/colors.sh"
else
  kd_info() { printf 'ℹ  %s\n' "$*"; }
  kd_ok() { printf '✓  %s\n' "$*"; }
  kd_warn() { printf '!  %s\n' "$*"; }
  kd_err() { printf '✗  %s\n' "$*" >&2; }
  kd_step() { printf '\n▸ %s\n' "$*"; }
  kd_banner() { printf '\n== %s ==\n' "$*"; }
  kd_ask() {
    local prompt="$1" default="${2:-}" reply=""
    printf '?  %s [%s] ' "$prompt" "$default" >&2
    if [[ -t 0 ]]; then read -r reply || true; fi
    printf '%s\n' "${reply:-$default}"
  }
fi

LOCATION=""
DEPLOY=""
NIFI_URL=""
NIFI_IMAGE="${NIFI_IMAGE:-}"
NIFI_USER="${NIFI_USER:-admin}"
NIFI_PASSWORD="${NIFI_PASSWORD:-OpenText2026!}"
CREATE_NIFI=0
CREATE_OLLAMA=0
SKIP_NIFI_TEST=0
NO_WIZARD=0
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-kd-nifi-ai-mcp}"
COMPOSE_ARGS=()
MODE="up"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      COMPOSE_ARGS+=("$@")
      break
      ;;
    up|down)
      MODE="$1"
      shift
      COMPOSE_ARGS+=("$MODE")
      while [[ $# -gt 0 ]]; do
        COMPOSE_ARGS+=("$1")
        shift
      done
      break
      ;;
    --nifi-location) LOCATION="$2"; shift 2 ;;
    --nifi-deploy) DEPLOY="$2"; shift 2 ;;
    --nifi-url) NIFI_URL="$2"; LOCATION="${LOCATION:-remote}"; shift 2 ;;
    --nifi-image) NIFI_IMAGE="$2"; shift 2 ;;
    --nifi-user) NIFI_USER="$2"; shift 2 ;;
    --nifi-password) NIFI_PASSWORD="$2"; shift 2 ;;
    --create-nifi) CREATE_NIFI=1; LOCATION="${LOCATION:-local}"; shift ;;
    --create-ollama) CREATE_OLLAMA=1; shift ;;
    --skip-nifi-test) SKIP_NIFI_TEST=1; shift ;;
    --no-wizard) NO_WIZARD=1; shift ;;
    --project-name|--project) PROJECT_NAME="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      COMPOSE_ARGS+=("$1")
      shift
      ;;
  esac
done

export COMPOSE_PROJECT_NAME="$PROJECT_NAME"

if [[ "$NIFI_PASSWORD" == "changeme12345" ]]; then
  kd_warn "Replacing placeholder password changeme12345 with OpenText2026!"
  NIFI_PASSWORD="OpenText2026!"
fi

compose() {
  local files=(-f "$ROOT/docker-compose.yml")
  docker compose --project-name "$PROJECT_NAME" --env-file "$ROOT/.env" "${files[@]}" "$@"
}

if [[ "$MODE" == "down" || "${COMPOSE_ARGS[0]:-}" == "down" ]]; then
  kd_step "Undeploy $PROJECT_NAME"
  if [[ ! -f "$ROOT/.env" ]]; then
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$PROJECT_NAME" > "$ROOT/.env"
  fi
  if [[ -t 0 ]]; then
    confirm="$(kd_ask "Confirm undeploy and remove volumes?" "N")"
    case "${confirm,,}" in
      y|yes) ;;
      *) kd_warn "Cancelled"; exit 0 ;;
    esac
  elif [[ " ${COMPOSE_ARGS[*]} " == *" -v "* ]]; then
    kd_err "Non-TTY session refuses undeploy with -v"
    exit 1
  fi
  compose down --remove-orphans -v || compose down --remove-orphans || true
  kd_ok "Stopped $PROJECT_NAME"
  exit 0
fi

# Wizard only for a bare `./start.sh` on a TTY.
# install.sh already chose local/external and must not be asked again.
if [[ "$NO_WIZARD" -eq 0 && -z "$LOCATION" && -z "$NIFI_URL" && "$CREATE_NIFI" -eq 0 && ${#COMPOSE_ARGS[@]} -eq 0 && -t 0 ]]; then
  loc="$(kd_ask "NiFi location: local or remote" "remote")"
  case "${loc,,}" in
    l|local) LOCATION="local"; CREATE_NIFI=1 ;;
    *) LOCATION="remote" ;;
  esac
  if [[ "$LOCATION" == "remote" ]]; then
    DEPLOY="$(kd_ask "Remote NiFi deploy: linux, windows, or docker" "docker")"
    NIFI_URL="$(kd_ask "NiFi URL" "${NIFI_URL:-https://127.0.0.1:8443}")"
  else
    img_ok="$(kd_ask "Use IDOL image microfocusidolserver/nifi-ver2-full:26.3?" "Y")"
    case "${img_ok,,}" in
      n|no) NIFI_IMAGE="${NIFI_IMAGE:-apache/nifi:2.0.0}" ;;
      *) NIFI_IMAGE="${NIFI_IMAGE:-microfocusidolserver/nifi-ver2-full:26.3}" ;;
    esac
  fi
fi

if [[ -n "$NIFI_URL" ]]; then
  LOCATION="${LOCATION:-remote}"
fi
if [[ "$CREATE_NIFI" -eq 1 ]]; then
  LOCATION="local"
fi
if [[ -z "$LOCATION" ]]; then
  LOCATION="remote"
fi
DEPLOY="${DEPLOY:-docker}"
if [[ "$LOCATION" == "local" ]]; then
  NIFI_IMAGE="${NIFI_IMAGE:-microfocusidolserver/nifi-ver2-full:26.3}"
fi

kd_banner "kd-nifi-ai-mcp  ($LOCATION / $DEPLOY)"
kd_info "Compose project: $PROJECT_NAME"

mkdir -p "$ROOT/templates/custom"

alloc_args=(--write-env "$ROOT/.env" --location "$LOCATION" --deploy "$DEPLOY" --nifi-user "$NIFI_USER" --nifi-password "$NIFI_PASSWORD")
if [[ "$CREATE_NIFI" -eq 1 ]]; then
  alloc_args+=(--create-nifi)
fi
if [[ "$CREATE_OLLAMA" -eq 1 ]]; then
  alloc_args+=(--create-ollama)
fi
if [[ -n "$NIFI_URL" ]]; then
  alloc_args+=(--nifi-url "$NIFI_URL")
fi
python3 "$ROOT/scripts/allocate_ports.py" "${alloc_args[@]}"

sel_args=(--env "$ROOT/.env" --location "$LOCATION" --deploy "$DEPLOY" --image "$NIFI_IMAGE")
if [[ -n "$NIFI_URL" ]]; then
  sel_args+=(--nifi-url "$NIFI_URL")
fi
python3 "$ROOT/scripts/apply_selection.py" "${sel_args[@]}"

# Force credentials + project into .env after helpers run.
python3 - <<PY
import os
from pathlib import Path
p = Path("$ROOT/.env")
lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
upd = {
    "NIFI_USERNAME": "$NIFI_USER",
    "NIFI_PASSWORD": "$NIFI_PASSWORD",
    "COMPOSE_PROJECT_NAME": "$PROJECT_NAME",
    "NIFI_LOCATION": "$LOCATION",
    "NIFI_DEPLOY": "$DEPLOY",
}
if "$NIFI_IMAGE":
    upd["NIFI_IMAGE"] = "$NIFI_IMAGE"
if "$LOCATION" == "local":
    upd["COMPOSE_PROFILES"] = "create-nifi"
    upd["START_NIFI"] = "true"
else:
    upd["START_NIFI"] = "false"
    upd["COMPOSE_PROFILES"] = ""
    upd["NIFI_EXISTING_NAME"] = "idol-nifi"
    upd["NIFI_UPSTREAM"] = "idol-nifi:8443"
    upd["NIFI_TLS_SERVER_NAME"] = "localhost"
    upd["NIFI_DOCKER_NETWORK"] = "idol-demo-network"
    upd["NIFI_DOCKER_NETWORK_EXTERNAL"] = "true"
    upd["NIFI_API_BASE"] = "http://nifi-proxy:8080/nifi-api"
    upd["NIFI_BASE_URL"] = "http://nifi-proxy:8080/nifi-api"
    upd["NIFI_API_BASES"] = "http://nifi-proxy:8080/nifi-api,https://idol-nifi:8443/nifi-api"
    extra_ip = os.environ.get("EXTRA_IP_SANS_ENV") or os.environ.get("EXTRA_IP_SANS") or os.environ.get("IDOL_NET_HOST_IP") or ""
    extra_ip = extra_ip.split(",")[0].strip()
    host = extra_ip or "127.0.0.1"
    upd["NIFI_PUBLIC_HOST"] = host
    upd["NIFI_PUBLIC_URL"] = f"https://{host}:27111/nifi"
seen = set()
out = []
drop = {"SSL_CERT_DIR"}
for raw in lines:
    if not raw.strip() or raw.strip().startswith("#") or "=" not in raw:
        out.append(raw)
        continue
    k = raw.split("=", 1)[0].strip()
    if k in drop:
        continue
    if k in upd:
        out.append(f"{k}={upd[k]}")
        seen.add(k)
    else:
        out.append(raw)
for k, v in upd.items():
    if k not in seen:
        out.append(f"{k}={v}")
p.write_text("\\n".join(out).rstrip() + "\\n", encoding="utf-8")
print("Updated credentials in .env")
PY

if [[ "$SKIP_NIFI_TEST" -eq 1 ]]; then
  kd_warn "Skipping NiFi probe (--skip-nifi-test)"
elif [[ "$LOCATION" == "remote" && -n "$NIFI_URL" ]]; then
  kd_step "Probing NiFi at $NIFI_URL"
  python3 "$ROOT/scripts/probe_nifi.py" \
    --url "$NIFI_URL" \
    --nifi-user "$NIFI_USER" \
    --nifi-password "$NIFI_PASSWORD" \
    --wait 20 \
    --recommend || {
      kd_err "NiFi probe failed. Pass --skip-nifi-test to deploy anyway."
      exit 1
    }
fi

chmod +x "$ROOT/ui/docker-entrypoint.sh" "$ROOT/nifi-proxy/docker-entrypoint.sh" \
  "$ROOT/scripts/configure_orchestrator_public_url.sh" 2>/dev/null || true

if [[ -x "$ROOT/scripts/configure_orchestrator_public_url.sh" ]]; then
  "$ROOT/scripts/configure_orchestrator_public_url.sh" --env "$ROOT/.env" --update-only --project "$PROJECT_NAME" || true
fi

if [[ ${#COMPOSE_ARGS[@]} -eq 0 ]]; then
  COMPOSE_ARGS=(up -d --build)
elif [[ "${COMPOSE_ARGS[0]}" != "up" && "${COMPOSE_ARGS[0]}" != "down" ]]; then
  COMPOSE_ARGS=(up "${COMPOSE_ARGS[@]}")
fi

# Local stack must enable the create-nifi profile.
profile_args=()
if [[ "$LOCATION" == "local" || "$CREATE_NIFI" -eq 1 ]]; then
  profile_args+=(--profile create-nifi)
fi
if [[ "$CREATE_OLLAMA" -eq 1 ]]; then
  profile_args+=(--profile create-ollama)
fi

kd_step "docker compose ${COMPOSE_ARGS[*]}"
compose "${profile_args[@]}" "${COMPOSE_ARGS[@]}"

if [[ -x "$ROOT/scripts/configure_orchestrator_public_url.sh" ]]; then
  "$ROOT/scripts/configure_orchestrator_public_url.sh" \
    --env "$ROOT/.env" --recreate --verify --project "$PROJECT_NAME" || true
fi

UI_PORT="$(awk -F= '/^UI_HOST_PORT=/{print $2}' "$ROOT/.env" | tail -1)"
ORCH_PORT="$(awk -F= '/^ORCHESTRATOR_HOST_PORT=/{print $2}' "$ROOT/.env" | tail -1)"
PROXY_PORT="$(awk -F= '/^NIFI_PROXY_HOST_PORT=/{print $2}' "$ROOT/.env" | tail -1)"
MCP_PORT="$(awk -F= '/^MCP_HOST_PORT=/{print $2}' "$ROOT/.env" | tail -1)"
UI_PORT="${UI_PORT:-27120}"
ORCH_PORT="${ORCH_PORT:-27110}"
PROXY_PORT="${PROXY_PORT:-27111}"
MCP_PORT="${MCP_PORT:-27115}"

PUB_HOST="${EXTRA_IP_SANS_ENV:-${EXTRA_IP_SANS:-${IDOL_NET_HOST_IP:-}}}"
PUB_HOST="${PUB_HOST%%,*}"
PUB_HOST="${PUB_HOST//[[:space:]]/}"
if [[ -z "$PUB_HOST" || "$PUB_HOST" == "none" ]]; then
  PUB_HOST="$(awk -F= '/^NIFI_PUBLIC_HOST=/{print $2}' "$ROOT/.env" | tail -1)"
fi
if [[ -z "$PUB_HOST" ]]; then
  PUB_HOST="localhost"
fi

kd_ok "NiFi AI stack is up  (project $PROJECT_NAME)"
printf '\n'
printf '  Chat UI          http://%s:%s/\n' "$PUB_HOST" "$UI_PORT"
printf '  Orchestrator     http://%s:%s/\n' "$PUB_HOST" "$ORCH_PORT"
printf '  NiFi canvas      https://%s:%s/nifi\n' "$PUB_HOST" "$PROXY_PORT"
printf '  NiFi direct      https://%s:8443/nifi\n' "$PUB_HOST"
printf '  MCP SSE          http://%s:%s/sse\n' "$PUB_HOST" "$MCP_PORT"
if [[ "$LOCATION" == "local" ]]; then
  TLS_PORT="$(awk -F= '/^NIFI_TLS_HOST_PORT=/{print $2}' "$ROOT/.env" | tail -1)"
  printf '  Local NiFi TLS   https://%s:%s/nifi\n' "$PUB_HOST" "${TLS_PORT:-27113}"
fi
printf '\n'
