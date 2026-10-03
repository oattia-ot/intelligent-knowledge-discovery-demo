#!/usr/bin/env bash
# One-push deploy: build KD Enterprise Search and publish it to
#   https://webui.idoldemos.net/Demos/KD
# via the nginx_ssl container (bind-mounts this host's nginx/root + default.conf).
#
# Usage:
#   ./deploy.sh
#   ./deploy.sh --skip-build     # rsync last dist + reload nginx only
#   ./deploy.sh --nginx-only     # patch/reload nginx, do not copy files
#
# Each full build stamps configVersion (hash of config/*.json + templates) into
# the bundle. ConfigService / ResultUrlService request
#   assets/config/*.json?v=<hash>
# so a config-only publish cannot reuse a cached databases.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$_PKG_ROOT/scripts/require-server-runtime.sh" ]]; then
  # shellcheck disable=SC1091
  source "$_PKG_ROOT/scripts/require-server-runtime.sh"
  require_server_runtime || exit 1
fi
WEB_DIR="${SCRIPT_DIR}/apps/web"
NGINX_DIR="${NGINX_DIR:-/home/vinay/projects/ssl_nifi/nginx}"
CONTAINER="${NGINX_CONTAINER:-nginx_ssl}"
REDACTION_CERT_DIR="${REDACTION_CERT_DIR:-/home/vinay/projects/ssl_nifi/nifi2/certificates/dynamic_redaction_mtls}"
NIFI_CA_CERT="${NIFI_CA_CERT:-/home/vinay/projects/ssl_nifi/nifi2/certificates/nifi/ca.crt}"
BASE_HREF="${BASE_HREF:-/Demos/KD/}"
DEST_DIR="${NGINX_DIR}/root/Demos/KD"
DIST_DIR="${WEB_DIR}/dist/web/browser"
PUBLIC_URL="https://webui.idoldemos.net${BASE_HREF}"

SKIP_BUILD=0
NGINX_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --nginx-only) NGINX_ONLY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ -d "$WEB_DIR" ]] || die "Angular app not found: $WEB_DIR"
[[ -d "$NGINX_DIR" ]] || die "Nginx dir not found: $NGINX_DIR"
command -v docker >/dev/null || die "docker is required"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "container '$CONTAINER' is not running"

use_node22() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm use 22 >/dev/null
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [[ "$major" -eq 21 || "$major" -lt 20 ]]; then
    die "Node $(node -v 2>/dev/null || echo unknown) cannot build Angular 21. Use nvm use 22."
  fi
  log "Node $(node -v)"
}

CONFIG_VERSION_FILE="${WEB_DIR}/src/environments/config-version.ts"

compute_config_version() {
  local config_dir="${SCRIPT_DIR}/config"
  [[ -d "$config_dir" ]] || die "config dir not found: $config_dir"
  if command -v sha256sum >/dev/null; then
    find "$config_dir" -type f \( -name '*.json' -o -name '*.hbs' \) \
      ! -name '* copy.json' -print0 \
      | sort -z \
      | xargs -0 sha256sum \
      | sha256sum \
      | awk '{print substr($1,1,12)}'
  else
    date -u +%Y%m%dT%H%M%SZ
  fi
}

write_config_version() {
  local version="$1"
  cat > "$CONFIG_VERSION_FILE" <<EOF
/**
 * Overwritten by deploy.sh before \`ng build\` with a hash of config/*.json and
 * config/templates/**. Restored to \`dev\` after the build so the working tree
 * stays clean. Local \`ng serve\` keeps this default.
 */
export const CONFIG_VERSION = '${version}';
EOF
}

restore_config_version() {
  write_config_version 'dev'
}

sync_config() {
  if [[ -x "${WEB_DIR}/sync-config.sh" ]]; then
    log "Sync config/ → apps/web/src/assets"
    bash "${WEB_DIR}/sync-config.sh"
  fi
}

build_app() {
  use_node22
  sync_config
  local version
  version="$(compute_config_version)"
  [[ -n "$version" ]] || die "Could not compute configVersion"
  log "configVersion=${version}"
  write_config_version "$version"
  trap restore_config_version EXIT
  cd "$WEB_DIR"
  if [[ ! -d node_modules || ! -f node_modules/@angular/cli/package.json ]]; then
    log "clean npm install --include=dev"
    rm -rf node_modules
    npm install --include=dev
  fi
  log "npm audit fix (non-blocking)"
  npm audit fix || log "npm audit fix reported issues; continuing"
  log "ng build --configuration production --base-href ${BASE_HREF}"
  npx ng build --configuration production --base-href "$BASE_HREF"
  restore_config_version
  trap - EXIT
  [[ -f "${DIST_DIR}/index.html" ]] || die "Build produced no index.html at ${DIST_DIR}"
  if ! grep -q "base href=\"${BASE_HREF}\"" "${DIST_DIR}/index.html"; then
    die "Built index.html is missing <base href=\"${BASE_HREF}\">"
  fi
  if ! grep -qF "$version" "${DIST_DIR}"/*.js; then
    die "Built bundle is missing configVersion ${version} (cache buster not baked in)"
  fi
}

publish_static() {
  [[ -f "${DIST_DIR}/index.html" ]] || die "Nothing to publish; run without --skip-build first"
  log "Publish ${DIST_DIR} → ${DEST_DIR}"
  mkdir -p "$DEST_DIR"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${DIST_DIR}/" "${DEST_DIR}/"
  else
    find "$DEST_DIR" -mindepth 1 -delete
    cp -a "${DIST_DIR}/." "$DEST_DIR/"
  fi
  # Bind-mount is nginx/root → /usr/share/nginx/html
  [[ -f "${DEST_DIR}/index.html" ]] || die "Publish failed: ${DEST_DIR}/index.html missing"
}

install_redaction_tls() {
  local ssl_dir="${NGINX_DIR}/ssl"
  local client_cert="${REDACTION_CERT_DIR}/browser-client.crt.pem"
  local client_key="${REDACTION_CERT_DIR}/browser-client.key.pem"
  local password_file="${REDACTION_CERT_DIR}/client-password.txt"

  [[ -f "$client_cert" ]] || die "Missing redaction client certificate: ${client_cert}"
  [[ -f "$client_key" ]] || die "Missing redaction client key: ${client_key}"
  [[ -f "$password_file" ]] || die "Missing redaction key password: ${password_file}"
  [[ -f "$NIFI_CA_CERT" ]] || die "Missing NiFi CA certificate: ${NIFI_CA_CERT}"

  log "Install role-based redaction mTLS files"
  install -m 644 "$client_cert" "${ssl_dir}/dynamic-redaction-client.crt.pem"
  install -m 600 "$client_key" "${ssl_dir}/dynamic-redaction-client.key.pem"
  install -m 600 "$password_file" "${ssl_dir}/dynamic-redaction-client-password.txt"
  install -m 644 "$NIFI_CA_CERT" "${ssl_dir}/nifi-ca.crt"
}

ensure_nginx_locations() {
  local conf="${NGINX_DIR}/default.conf"
  [[ -f "$conf" ]] || die "Missing ${conf}"

  log "Reconcile /Demos/KD/ nginx locations (config Cache-Control)"
  # Write in place (same inode). `mv` over a bind-mounted file leaves the
  # container on the old inode until recreate.
  python3 - "$conf" <<'PY'
import pathlib, sys
src = pathlib.Path(sys.argv[1])
text = src.read_text()
start = "    # --- KD Enterprise Search (managed by TAX_GOV_AE/deploy.sh) ---"
end = "    # BVC static assets requested at root"
# Repeat server security headers: a location-level add_header drops inherited ones.
sec = """        add_header Strict-Transport-Security "max-age=63072000" always;
        add_header X-Frame-Options SAMEORIGIN;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Cache-Control "no-cache";"""
block = f"""{start}
    location = /Demos/KD {{
        return 301 /Demos/KD/;
    }}
    location = /Demos/KD/ {{
        root /usr/share/nginx/html;
{sec}
        try_files /Demos/KD/index.html =404;
    }}
    location = /Demos/KD/index.html {{
        root /usr/share/nginx/html;
{sec}
    }}
    # Mutable runtime JSON — always revalidate (query-string buster is the other half)
    location = /Demos/KD/assets/build-id.json {{
        root /usr/share/nginx/html;
{sec}
    }}
    location ^~ /Demos/KD/assets/config/ {{
        root /usr/share/nginx/html;
{sec}
    }}
    location ^~ /Demos/KD/assets/templates/ {{
        root /usr/share/nginx/html;
{sec}
    }}
    # ^~ so hashed JS/CSS are not stolen by the BVC root static regex
    location ^~ /Demos/KD/ {{
        root /usr/share/nginx/html;
        try_files $uri $uri/ /Demos/KD/index.html;
    }}

    # Same-origin mTLS proxy for role-based document and snippet redaction.
    location ^~ /RedactionView/ {{
        rewrite ^/RedactionView/(.*)$ /$1 break;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_connect_timeout 300;
        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_ssl_certificate /ssl/dynamic-redaction-client.crt.pem;
        proxy_ssl_certificate_key /ssl/dynamic-redaction-client.key.pem;
        proxy_ssl_password_file /ssl/dynamic-redaction-client-password.txt;
        proxy_ssl_trusted_certificate /ssl/nifi-ca.crt;
        proxy_ssl_verify on;
        proxy_ssl_server_name on;
        proxy_ssl_name nifi.idoldemos.net;
        proxy_pass https://nifi.idoldemos.net:18080;
        proxy_set_header Host nifi.idoldemos.net:18080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }}

    # Thin Node writer for /admin JSON (KDUIAdmin). Search still goes ACI.
    location ^~ /api/admin/ {{
        proxy_pass http://127.0.0.1:4201/api/admin/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 15;
        proxy_read_timeout 30;
        proxy_send_timeout 30;
    }}
"""
if start in text and end in text:
    pre, rest = text.split(start, 1)
    _, post = rest.split(end, 1)
    text = pre + block + "\n" + end + post
elif end in text:
    text = text.replace(end, block + "\n" + end, 1)
else:
    raise SystemExit("Could not find insertion point in default.conf")
src.write_text(text)
PY
}

reload_nginx() {
  log "nginx -t && reload (${CONTAINER})"
  docker exec "$CONTAINER" nginx -t
  docker exec "$CONTAINER" nginx -s reload
}

smoke() {
  local url="${PUBLIC_URL}"
  log "Smoke ${url}"
  local code
  code="$(curl -sk -o /tmp/kd-deploy-smoke.html -w '%{http_code}' \
    --resolve webui.idoldemos.net:443:127.0.0.1 \
    "$url" || true)"
  if [[ "$code" != "200" ]]; then
    # Host may resolve to this box already
    code="$(curl -sk -o /tmp/kd-deploy-smoke.html -w '%{http_code}' "$url" || true)"
  fi
  if [[ "$code" != "200" ]]; then
    die "GET ${url} returned HTTP ${code}"
  fi
  if ! grep -q 'Enterprise Search' /tmp/kd-deploy-smoke.html; then
    die "index.html does not look like Enterprise Search"
  fi
  echo "OK  ${url}  (HTTP ${code})"
}

smoke_redaction() {
  local base="https://webui.idoldemos.net/RedactionView/api/v1"
  local health_file="/tmp/kd-redaction-health.json"
  local error_file="/tmp/kd-redaction-post.json"
  local health_code post_code

  log "Smoke role-based redaction proxy"
  health_code=""
  for _ in {1..10}; do
    health_code="$(curl -sk -o "$health_file" -w '%{http_code}' \
      --resolve webui.idoldemos.net:443:127.0.0.1 \
      "${base}/health_check" || true)"
    if [[ "$health_code" == "200" ]] &&
      grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"' "$health_file"; then
      break
    fi
    sleep 1
  done
  if [[ "$health_code" != "200" ]] ||
    ! grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"' "$health_file"; then
    die "GET ${base}/health_check did not return a healthy response"
  fi

  post_code="$(curl -sk -o "$error_file" -w '%{http_code}' \
    --resolve webui.idoldemos.net:443:127.0.0.1 \
    -H 'Content-Type: application/json' -d '{}' \
    "${base}/redactions/snippet" || true)"
  [[ "$post_code" == "400" ]] ||
    die "POST ${base}/redactions/snippet smoke expected HTTP 400, got ${post_code}"
  echo "OK  ${base}  (mTLS GET 200, POST forwarded)"
}

stamp_build_id() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  local id
  id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  printf '{"id":"%s","ts":"%s"}\n' "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dest"
  log "Hard-refresh build id ${id} → ${dest}"
}

if [[ "$NGINX_ONLY" -eq 0 ]]; then
  if [[ "$SKIP_BUILD" -eq 0 ]]; then
    build_app
  fi
  publish_static
  stamp_build_id "${DIST_DIR}/assets/build-id.json"
  stamp_build_id "${DEST_DIR}/assets/build-id.json"
  stamp_build_id "${WEB_DIR}/src/assets/build-id.json"
fi
install_redaction_tls
ensure_nginx_locations
reload_nginx
smoke
smoke_redaction

log "Deployed ${PUBLIC_URL}"
