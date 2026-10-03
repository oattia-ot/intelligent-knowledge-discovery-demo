#!/usr/bin/env bash
# Deploy kd-demo: sandbox is mandatory; NiFi AI stack is optional.
#
# Usage:
#   ./install.sh
#   ./install.sh --nifi none
#   ./install.sh --nifi local
#   ./install.sh --nifi external --nifi-url https://127.0.0.1:8443
#   ./install.sh --nifi-user admin --nifi-password 'OpenText2026!'
#   ./install.sh --no-start          # write config only, do not start processes
#   ./install.sh --skip-npm
#   ./install.sh --skip-nifi-test    # do not require /nifi-api/flow/about before AI app
#   ./install.sh --extra-ip-sans 20.86.52.130
#
# Guide: README.md  (section "Running install.sh")
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/colors.sh
source "$ROOT/scripts/colors.sh"
# shellcheck source=scripts/require-server-runtime.sh
source "$ROOT/scripts/require-server-runtime.sh"
require_server_runtime || exit 1
print_runtime_banner

# All interactive question prompts print in yellow.
kd_ask() {
  local prompt="$1"
  local default="${2:-}"
  local reply=""
  if [[ -n "$default" ]]; then
    printf '%s?  %s [%s]%s ' "$C_YELLOW" "$prompt" "$default" "$C_RESET" >&2
  else
    printf '%s?  %s%s ' "$C_YELLOW" "$prompt" "$C_RESET" >&2
  fi
  read -r reply || true
  if [[ -n "${reply:-}" ]]; then
    printf '%s\n' "$reply"
  else
    printf '%s\n' "$default"
  fi
}

SANDBOX_DIR="$ROOT/kd-sandbox-ai-demo"
NIFI_DIR="$ROOT/kd-nifi-ai-mcp"
RUN_DIR="$ROOT/.run"
STATE_FILE="$RUN_DIR/state"
NIFI_AI_JSON="$SANDBOX_DIR/config/nifi-ai.json"
NIFI_AI_ASSET="$SANDBOX_DIR/apps/web/src/assets/config/nifi-ai.json"

NIFI_MODE=""          # none | local | external  (empty = prompt)
NIFI_URL=""
NIFI_USER="${NIFI_USERNAME:-admin}"
NIFI_PASSWORD="${NIFI_PASSWORD:-OpenText2026!}"
NO_START=0
SKIP_NPM=0
CREATE_NIFI=0
SKIP_NIFI_TEST=0
EXTRA_IP_SANS_ENV="${EXTRA_IP_SANS:-${EXTRA_IP_SANS_ENV:-${IDOL_NET_HOST_IP:-}}}"
EXTRA_IP_SANS=()

usage() {
  sed -n '2,16p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --nifi)
      NIFI_MODE="$2"; shift 2 ;;
    --nifi-url)
      NIFI_URL="$2"; NIFI_MODE="${NIFI_MODE:-external}"; shift 2 ;;
    --nifi-user)
      NIFI_USER="$2"; shift 2 ;;
    --nifi-password)
      NIFI_PASSWORD="$2"; shift 2 ;;
    --create-nifi)
      CREATE_NIFI=1; shift ;;
    --no-start)
      NO_START=1; shift ;;
    --skip-npm)
      SKIP_NPM=1; shift ;;
    --skip-nifi-test)
      SKIP_NIFI_TEST=1; shift ;;
    --extra-ip-sans)
      EXTRA_IP_SANS_ENV="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      kd_err "Unknown argument: $1"
      usage
      exit 1 ;;
  esac
done

mkdir -p "$RUN_DIR"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { kd_err "Required command not found: $1"; exit 1; }
}

write_state() {
  local key="$1" value="$2"
  mkdir -p "$RUN_DIR"
  touch "$STATE_FILE"
  if grep -q "^${key}=" "$STATE_FILE" 2>/dev/null; then
    local tmp
    tmp="$(mktemp)"
    awk -F= -v k="$key" -v v="$value" 'BEGIN{OFS="="} $1==k{$0=k"="v} {print}' "$STATE_FILE" > "$tmp"
    mv "$tmp" "$STATE_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$STATE_FILE"
  fi
}

write_nifi_ai_json() {
  local enabled="$1" mode="$2" ui_port="${3:-27120}" orch_port="${4:-27110}"
  python3 - "$NIFI_AI_JSON" "$NIFI_AI_ASSET" "$enabled" "$mode" "$ui_port" "$orch_port" <<'PY'
import json, sys, pathlib
dests = [pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])]
enabled = sys.argv[3].lower() in ("1", "true", "yes")
mode = sys.argv[4]
ui_port = sys.argv[5]
orch_port = sys.argv[6]
doc = {
    "enabled": enabled,
    "mode": mode,
    "uiUrl": "/nifi-ai/?theme=fta",
    "directUiUrl": f"http://localhost:{ui_port}/?theme=fta",
    "orchestratorUrl": f"http://localhost:{orch_port}",
}
for dest in dests:
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(doc, indent=2) + "\n")
PY
}

prompt_nifi_mode() {
  if [[ -n "$NIFI_MODE" ]]; then
    return
  fi
  kd_step "Optional component: kd-nifi-ai-mcp"
  printf '  %s1)  Use existing IDOL NiFi (idol-nifi on :8443)%s\n' "$C_YELLOW" "$C_RESET"
  printf '  %s2)  Create a new local NiFi container%s\n' "$C_YELLOW" "$C_RESET"
  printf '  %s3)  Skip NiFi AI  — hide the "NiFi AI" button%s\n' "$C_YELLOW" "$C_RESET"
  local choice
  choice="$(kd_ask "Choose 1 / 2 / 3" "1")"
  case "$choice" in
    2|local) NIFI_MODE="local" ;;
    3|none|skip|no) NIFI_MODE="none" ;;
    *) NIFI_MODE="external"; NIFI_URL="${NIFI_URL:-https://127.0.0.1:8443}" ;;
  esac
}

deploy_sandbox() {
  kd_step "Deploying kd-sandbox-ai-demo (mandatory)"
  [[ -d "$SANDBOX_DIR/apps/web" ]] || { kd_err "Sandbox app missing: $SANDBOX_DIR/apps/web"; exit 1; }
  need_cmd node
  need_cmd npm

  if [[ "$SKIP_NPM" -eq 0 ]]; then
    if [[ ! -d "$SANDBOX_DIR/apps/web/node_modules" ]]; then
      kd_info "npm install --include=dev  (apps/web)"
      (cd "$SANDBOX_DIR/apps/web" && npm install --include=dev)
    else
      kd_ok "node_modules already present"
    fi
  else
    kd_warn "Skipping npm install"
  fi

  if [[ -x "$SANDBOX_DIR/apps/web/sync-config.sh" ]]; then
    bash "$SANDBOX_DIR/apps/web/sync-config.sh" || true
  fi

  write_state SANDBOX_DEPLOYED 1
  write_state SANDBOX_DIR "$SANDBOX_DIR"
  kd_ok "Sandbox ready"
}

start_sandbox() {
  if [[ "$NO_START" -eq 1 ]]; then
    kd_warn "Not starting the Angular dev server (--no-start)"
    return
  fi

  if command -v lsof >/dev/null 2>&1 && lsof -t -iTCP:4200 -sTCP:LISTEN >/dev/null 2>&1; then
    kd_warn "Port 4200 already in use — leaving the existing listener"
    write_state SANDBOX_PID existing
    return
  fi

  if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
    export FTA_UPSTREAM_HOST="${EXTRA_IP_SANS[0]}"
    export EXTRA_IP_SANS_ENV="${EXTRA_IP_SANS[0]}"
    export IDOL_NET_HOST_IP="${EXTRA_IP_SANS[0]}"
  fi

  kd_info "Starting Angular dev server (serve.sh) on http://${EXTRA_IP_SANS[0]:-localhost}:4200 (upstreamHost=${FTA_UPSTREAM_HOST:-from config.json})"
  nohup bash "$SANDBOX_DIR/apps/web/serve.sh" > "$RUN_DIR/sandbox.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$RUN_DIR/sandbox.pid"
  write_state SANDBOX_PID "$pid"
  kd_ok "Sandbox PID $pid  — log: .run/sandbox.log"
}

deploy_nifi_none() {
  write_nifi_ai_json false none
  write_state NIFI_MODE none
  write_state NIFI_COMPOSE_PROJECT ""
  kd_ok "NiFi AI disabled — header button will be hidden"
}

read_nifi_ports() {
  local envf="$NIFI_DIR/.env"
  local ui=27120 orch=27110
  if [[ -f "$envf" ]]; then
    ui="$(awk -F= '/^UI_HOST_PORT=/{print $2}' "$envf" | tail -1)"
    orch="$(awk -F= '/^ORCHESTRATOR_HOST_PORT=/{print $2}' "$envf" | tail -1)"
  fi
  UI_PORT="${ui:-27120}"
  ORCH_PORT="${orch:-27110}"
}

deploy_nifi_local() {
  if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
    export EXTRA_IP_SANS_ENV="${EXTRA_IP_SANS[0]}"
    export IDOL_NET_HOST_IP="${EXTRA_IP_SANS[0]}"
  fi
  kd_step "Deploying kd-nifi-ai-mcp locally  (compose project kd-nifi-ai-mcp)"
  need_cmd docker
  need_cmd python3
  chmod +x "$NIFI_DIR/start.sh" "$NIFI_DIR/ui/docker-entrypoint.sh" "$NIFI_DIR/scripts/configure_orchestrator_public_url.sh" 2>/dev/null || true

  local extra=()
  if [[ "$SKIP_NIFI_TEST" -eq 1 ]]; then
    extra+=(--skip-nifi-test)
  fi
  if [[ "$CREATE_NIFI" -eq 1 ]]; then
    (cd "$NIFI_DIR" && ./start.sh --no-wizard --nifi-location local --project-name kd-nifi-ai-mcp --create-nifi --nifi-user "$NIFI_USER" --nifi-password "$NIFI_PASSWORD" "${extra[@]}" -- up -d --build)
  else
    (cd "$NIFI_DIR" && ./start.sh --no-wizard --nifi-location local --project-name kd-nifi-ai-mcp --nifi-user "$NIFI_USER" --nifi-password "$NIFI_PASSWORD" "${extra[@]}" -- up -d --build)
  fi

  read_nifi_ports
  write_nifi_ai_json true local "$UI_PORT" "$ORCH_PORT"
  write_state NIFI_MODE local
  write_state NIFI_COMPOSE_PROJECT kd-nifi-ai-mcp
  write_state NIFI_UI_PORT "$UI_PORT"
  kd_ok "Local NiFi AI stack is up  (project kd-nifi-ai-mcp)"
}

deploy_nifi_external() {
  if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
    export EXTRA_IP_SANS_ENV="${EXTRA_IP_SANS[0]}"
    export IDOL_NET_HOST_IP="${EXTRA_IP_SANS[0]}"
  fi
  kd_step "Deploying NiFi AI against an external NiFi  (compose project kd-nifi-ai-mcp-ext)"
  need_cmd docker
  need_cmd python3

  local nifi_default="https://127.0.0.1:8443"
  if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
    nifi_default="https://${EXTRA_IP_SANS[0]}:8443"
  elif [[ -n "${IDOL_NET_HOST_IP:-}" && "${IDOL_NET_HOST_IP}" != "127.0.0.1" ]]; then
    nifi_default="https://${IDOL_NET_HOST_IP}:8443"
  fi
  if [[ -z "$NIFI_URL" ]]; then
    NIFI_URL="$(kd_ask "External NiFi URL" "$nifi_default")"
  fi
  if [[ -z "$NIFI_URL" ]]; then
    kd_err "An external NiFi URL is required"
    exit 1
  fi
  # If the operator left the localhost default but Extra IP SANs is set,
  # prefer the SAN host — 127.0.0.1:8443 is almost never listening here.
  if [[ "$NIFI_URL" == "https://127.0.0.1:8443" || "$NIFI_URL" == "https://localhost:8443" ]]; then
    if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
      kd_warn "Replacing $NIFI_URL with https://${EXTRA_IP_SANS[0]}:8443 (Extra IP SANs)"
      NIFI_URL="https://${EXTRA_IP_SANS[0]}:8443"
    fi
  fi
  NIFI_USER="$(kd_ask "NiFi username" "$NIFI_USER")"
  NIFI_PASSWORD="$(kd_ask "NiFi password" "${NIFI_PASSWORD:-OpenText2026!}")"

  chmod +x "$NIFI_DIR/start.sh" "$NIFI_DIR/ui/docker-entrypoint.sh" "$NIFI_DIR/scripts/probe_nifi.py" "$NIFI_DIR/scripts/configure_orchestrator_public_url.sh" 2>/dev/null || true

  kd_step "Testing NiFi at $NIFI_URL before deploying the AI app"
  if [[ "$SKIP_NIFI_TEST" -eq 1 ]]; then
    kd_warn "Skipping NiFi probe (--skip-nifi-test)"
  else
    if ! python3 "$NIFI_DIR/scripts/probe_nifi.py" \
        --url "$NIFI_URL" \
        --nifi-user "$NIFI_USER" \
        --nifi-password "$NIFI_PASSWORD" \
        --wait 20 \
        --recommend; then
      kd_err "NiFi probe failed — not deploying kd-nifi-ai-mcp. See USER_QUESTIONS.md"
      exit 1
    fi
  fi

  local extra=()
  if [[ "$SKIP_NIFI_TEST" -eq 1 ]]; then
    extra+=(--skip-nifi-test)
  fi
  # Distinct project name so this never collides with a local stack.
  (cd "$NIFI_DIR" && ./start.sh \
      --no-wizard --nifi-location remote --nifi-deploy docker \
      --project-name kd-nifi-ai-mcp-ext \
      --nifi-url "$NIFI_URL" \
      --nifi-user "$NIFI_USER" \
      --nifi-password "$NIFI_PASSWORD" \
      "${extra[@]}" \
      -- up -d --build)

  read_nifi_ports
  write_nifi_ai_json true external "$UI_PORT" "$ORCH_PORT"
  write_state NIFI_MODE external
  write_state NIFI_COMPOSE_PROJECT kd-nifi-ai-mcp-ext
  write_state NIFI_URL "$NIFI_URL"
  write_state NIFI_UI_PORT "$UI_PORT"
  kd_ok "External NiFi AI stack is up  (project kd-nifi-ai-mcp-ext → $NIFI_URL)"
}

# --- main ----------------------------------------------------------------

kd_banner "kd-demo  init"
kd_info "Sandbox is always deployed. NiFi AI is optional."

# IPv4 of the NIC that has the default route to the external network
# (the "internal" address used as src when talking to the internet).
detect_egress_ipv4() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -1)"
    if [[ -z "$ip" ]]; then
      ip="$(ip -4 route show default 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -1)"
    fi
  fi
  if [[ -z "$ip" ]] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  case "$ip" in
    ''|127.*|0.*|::* ) return 1 ;;
  esac
  printf '%s\n' "$ip"
}

prompt_extra_ip_sans() {
  # Default: EXTRA_IP_SANS / IDOL_NET_HOST_IP, else the egress NIC IPv4.
  local _ip_default="${EXTRA_IP_SANS_ENV:-}"
  if [[ -z "$_ip_default" ]]; then
    _ip_default="$(detect_egress_ipv4 || true)"
  fi
  echo
  printf '  %sAdditional IP SANs (comma-separated, or Enter to skip).%s\n' "$C_CYAN" "$C_RESET"
  printf '  %sWARNING: If using a remote hyperscaler (e.g. Azure) Linux environment, please enter the remote hyperscaler IP address here.%s\n' "$C_RED" "$C_YELLOW"
  local _ip_input=""
  printf '  Extra IP SANs [%s]: ' "${_ip_default:-none}" >&2
  read -r _ip_input || true
  _ip_input="${_ip_input:-${_ip_default}}"
  printf '%s' "$C_RESET"

  EXTRA_IP_SANS=()
  if [[ -n "${_ip_input}" && "${_ip_input}" != "none" ]]; then
    local _raw_ips _ip
    IFS=',' read -ra _raw_ips <<< "${_ip_input}"
    for _ip in "${_raw_ips[@]}"; do
      _ip="${_ip//[[:space:]]/}"
      [[ -n "${_ip}" ]] && EXTRA_IP_SANS+=("${_ip}")
    done
  fi
  if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
    kd_ok "Extra IP SANs: ${EXTRA_IP_SANS[*]}"
  else
    kd_info "No extra IP SANs"
  fi
}

prompt_nifi_mode
prompt_extra_ip_sans
case "$NIFI_MODE" in
  none|skip|no) NIFI_MODE="none" ;;
  local) ;;
  external)
    ;;
  *)
    kd_err "Invalid --nifi value: $NIFI_MODE (use none|local|external)"
    exit 1 ;;
esac

deploy_sandbox

case "$NIFI_MODE" in
  none) deploy_nifi_none ;;
  local) deploy_nifi_local ;;
  external) deploy_nifi_external ;;
esac

# True for RFC1918 / loopback / link-local. Those must not be written
# as ORCHESTRATOR_PUBLIC_URL.
is_private_ipv4() {
  local ip="$1" a= b= c= d=
  case "$ip" in
    ''|*[!0-9.]*) return 0 ;;
  esac
  IFS=. read -r a b c d _ <<< "$ip"
  [[ -z "${a:-}" || -z "${b:-}" || -z "${c:-}" || -z "${d:-}" ]] && return 0
  [[ "$a" -eq 127 || "$a" -eq 0 || "$a" -eq 10 ]] && return 0
  [[ "$a" -eq 192 && "$b" -eq 168 ]] && return 0
  [[ "$a" -eq 172 && "$b" -ge 16 && "$b" -le 31 ]] && return 0
  [[ "$a" -eq 169 && "$b" -eq 254 ]] && return 0
  return 1
}

detect_external_ipv4() {
  local raw="" ip
  raw+=" $(hostname -I 2>/dev/null || true)"
  if command -v ip >/dev/null 2>&1; then
    raw+=" $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' ')"
    raw+=" $(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')"
  fi
  for ip in $raw; do
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

# If this host has a public/external IPv4, persist it as
# ORCHESTRATOR_PUBLIC_URL and rebuild the chat UI so the browser uses it.
apply_orchestrator_public_url() {
  if [[ "$NIFI_MODE" == "none" ]]; then
    return 0
  fi
  [[ -d "$NIFI_DIR" ]] || return 0

  local ext_ip=""
  if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
    ext_ip="${EXTRA_IP_SANS[0]}"
  elif ! ext_ip="$(detect_external_ipv4)"; then
    kd_info "No public/external IPv4 on this host — leaving ORCHESTRATOR_PUBLIC_URL unchanged."
    return 0
  fi

  kd_step "External IP detected ($ext_ip) — writing ORCHESTRATOR_PUBLIC_URL and recreating ui"
  (
    cd "$NIFI_DIR"
    touch .env
    grep -q '^ORCHESTRATOR_PUBLIC_URL=' .env \
      && sed -i "s|^ORCHESTRATOR_PUBLIC_URL=.*|ORCHESTRATOR_PUBLIC_URL=http://${ext_ip}:27110|" .env \
      || echo "ORCHESTRATOR_PUBLIC_URL=http://${ext_ip}:27110" >> .env
    grep -q '^NIFI_PUBLIC_URL=' .env \
      && sed -i "s|^NIFI_PUBLIC_URL=.*|NIFI_PUBLIC_URL=https://${ext_ip}:27111/nifi|" .env \
      || echo "NIFI_PUBLIC_URL=https://${ext_ip}:27111/nifi" >> .env
    # NiFi rejects Host headers not listed here (blank page / 400 from :27111).
    if grep -q '^NIFI_WEB_PROXY_HOST=' .env; then
      python3 - .env "$ext_ip" "${EXTRA_IP_SANS[@]+"${EXTRA_IP_SANS[@]}"}" <<'PY'
import sys
from pathlib import Path
envp = Path(sys.argv[1])
ips = [a for a in sys.argv[2:] if a]
text = envp.read_text()
extra = []
for ip in ips:
    extra.extend([
        f"{ip}:27111", f"{ip}:27113", f"{ip}:8443",
        f"{ip}:27110", f"{ip}:27120",
    ])
out = []
for line in text.splitlines(keepends=True):
    if line.startswith("NIFI_WEB_PROXY_HOST="):
        cur = line.split("=", 1)[1].strip()
        parts = [p.strip() for p in cur.split(",") if p.strip()]
        for e in extra:
            if e not in parts:
                parts.append(e)
        line = "NIFI_WEB_PROXY_HOST=" + ",".join(parts) + "\n"
    out.append(line)
envp.write_text("".join(out))
PY
    else
      echo "NIFI_WEB_PROXY_HOST=localhost:8443,localhost:27111,localhost:27113,nifi:8443,${ext_ip}:27111,${ext_ip}:27113" >> .env
    fi
    docker compose --env-file .env up -d --build --force-recreate ui nifi-proxy || true
    curl -s http://127.0.0.1:27120/ | grep -o 'http://[^"]*27110' || true
  )
  # Keep the sandbox overlay config on the same public orchestrator URL.
  if [[ -f "$NIFI_AI_JSON" ]]; then
    python3 - "$NIFI_AI_JSON" "$NIFI_AI_ASSET" "$ext_ip" <<'PY'
import json, sys, pathlib
ip = sys.argv[3]
for dest in sys.argv[1:3]:
    p = pathlib.Path(dest)
    try:
        doc = json.loads(p.read_text()) if p.exists() else {}
    except Exception:
        doc = {}
    doc["orchestratorUrl"] = f"http://{ip}:27110"
    doc["directUiUrl"] = f"http://{ip}:27120/?theme=fta"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, indent=2) + "\n")
PY
  fi
}

apply_orchestrator_public_url

# Write Extra IP SANs into sandbox config.json as upstreamHost and
# compose viewUpstreamOrigin.absoluteDefault from that host + View port.
apply_sandbox_upstream_from_sans() {
  local host=""
  if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
    host="${EXTRA_IP_SANS[0]}"
  else
    host="$(detect_egress_ipv4 || true)"
  fi
  [[ -n "$host" ]] || return 0
  local cfg="$SANDBOX_DIR/config/config.json"
  local asset="$SANDBOX_DIR/apps/web/src/assets/config/config.json"
  local health="$SANDBOX_DIR/config/endpoint-health.json"
  local health_asset="$SANDBOX_DIR/apps/web/src/assets/config/endpoint-health.json"
  [[ -f "$cfg" ]] || return 0
  kd_step "Setting sandbox upstreamHost=$host (from Extra IP SANs / egress NIC)"
  python3 - "$host" "$cfg" "$asset" "$health" "$health_asset" <<'PY'
import json, re, sys
from pathlib import Path

host = sys.argv[1].strip()
for prefix in ("https://", "http://"):
    if host.startswith(prefix):
        host = host[len(prefix):]
host = host.split("/")[0].split(":")[0]

cfg_paths = [Path(sys.argv[2]), Path(sys.argv[3])]
health_paths = [Path(p) for p in sys.argv[4:] if p]

def port_of(upstream):
    m = re.search(r":(\d+)\s*$", str(upstream or ""))
    return m.group(1) if m else None

proto = "https"
for dest in cfg_paths:
    if not dest.exists() and dest != cfg_paths[0]:
        continue
    try:
        data = json.loads(dest.read_text()) if dest.exists() else {}
    except Exception:
        data = {}
    proto = data.get("protocol") if data.get("protocol") in ("http", "https") else "https"
    data["upstreamHost"] = host
    for row in data.get("components") or []:
        if row.get("key") == "viewUpstreamOrigin" or (
            row.get("kind") == "origin" and row.get("key") != "gatewayOrigin"
        ):
            port = port_of(row.get("upstream")) or "9083"
            row["absoluteDefault"] = f"{proto}://{host}:{port}"
        elif row.get("key") == "gatewayOrigin":
            row["absoluteDefault"] = ""
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, indent=2) + "\n")
    print(f"  wrote {dest} upstreamHost={host}")

key_port = {
    "communityApiUrl": "9033",
    "contentApiUrl": "9103",
    "contentIndexApiUrl": "9104",
    "qmsApiUrl": "16000",
    "viewApiUrl": "9083",
    "viewServerUrl": "9083",
    "viewUpstreamOrigin": "9083",
    "agentstoreApiUrl": "12310",
    "categoryApiUrl": "9020",
    "answerServerApiUrl": "12000",
}
# Prefer ports already stored in config.json components[].upstream
try:
    cfg = json.loads(cfg_paths[0].read_text())
    for row in cfg.get("components") or []:
        p = port_of(row.get("upstream"))
        if row.get("key") and p:
            key_port[row["key"]] = p
except Exception:
    pass

for dest in health_paths:
    if not dest.exists():
        continue
    try:
        health = json.loads(dest.read_text())
    except Exception:
        continue
    for key, entry in (health.get("endpoints") or {}).items():
        port = key_port.get(key)
        if not port:
            continue
        status = entry.get("statusPath") or "/action=getstatus"
        entry["testBase"] = f"{proto}://{host}:{port}"
        entry["testUrl"] = f"{proto}://{host}:{port}{status}"
    dest.write_text(json.dumps(health, indent=2) + "\n")
    print(f"  wrote {dest} testBase host={host}")
PY
}

apply_sandbox_upstream_from_sans

# Re-sync so the SPA picks up nifi-ai.json + updated config.json immediately.
if [[ -x "$SANDBOX_DIR/apps/web/sync-config.sh" ]]; then
  bash "$SANDBOX_DIR/apps/web/sync-config.sh" || true
fi

# Start the UI only AFTER Extra IP SANs have been written into config.json.
# Starting earlier made the proxy bind the repo default 172.25.125.123.
start_sandbox

write_state LAST_INIT "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

PUB_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -z "$PUB_HOST" || "$PUB_HOST" == "127.0.0.1" ]]; then
  PUB_HOST="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo localhost)"
fi
if [[ ${#EXTRA_IP_SANS[@]} -gt 0 ]]; then
  PUB_HOST="${EXTRA_IP_SANS[0]}"
elif [[ -n "${EXTRA_IP_SANS_ENV:-}" && "${EXTRA_IP_SANS_ENV}" != "none" ]]; then
  PUB_HOST="${EXTRA_IP_SANS_ENV%%,*}"
  PUB_HOST="${PUB_HOST//[[:space:]]/}"
fi

echo
kd_banner "Ready"
printf '  %sSandbox UI%s     http://%s:4200/\n' "$C_BOLD" "$C_RESET" "$PUB_HOST"
if [[ "$NIFI_MODE" != "none" ]]; then
  printf '  %sNiFi AI button%s  shown — opens an in-page overlay (not a new route/tab)\n' "$C_BOLD" "$C_RESET"
  printf '  %sChat UI%s        http://%s:%s/\n' "$C_BOLD" "$C_RESET" "$PUB_HOST" "${UI_PORT:-27120}"
  printf '  %sOrchestrator%s   http://%s:%s/\n' "$C_BOLD" "$C_RESET" "$PUB_HOST" "${ORCH_PORT:-27110}"
  printf '  %sNiFi canvas%s    https://%s:27111/nifi\n' "$C_BOLD" "$C_RESET" "$PUB_HOST"
  printf '  %sNiFi direct%s    https://%s:8443/nifi\n' "$C_BOLD" "$C_RESET" "$PUB_HOST"
  printf '  %sCompose%s        %s\n' "$C_BOLD" "$C_RESET" "$(awk -F= '/^NIFI_COMPOSE_PROJECT=/{print $2}' "$STATE_FILE" 2>/dev/null)"
else
  printf '  %sNiFi AI button%s  hidden\n' "$C_BOLD" "$C_RESET"
fi
echo
kd_info "Stop running services (keep caches):  ./undeploy.sh"
kd_info "Wipe caches / volumes:               ./cleanup.sh"
echo