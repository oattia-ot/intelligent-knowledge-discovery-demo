#!/bin/sh
set -eu
UPSTREAM="${NIFI_UPSTREAM:-nifi:8443}"
UPSTREAM="${UPSTREAM#https://}"
UPSTREAM="${UPSTREAM#http://}"
export NIFI_UPSTREAM="$UPSTREAM"
export NIFI_TLS_SERVER_NAME="${NIFI_TLS_SERVER_NAME:-localhost}"
export NIFI_PROXY_HOST_PORT="${NIFI_PROXY_HOST_PORT:-27111}"
export NIFI_UI_REDIRECT_PORT="${NIFI_UI_REDIRECT_PORT:-27111}"

CTX="${NIFI_PROXY_CONTEXT_PATH:-}"
if [ -n "$CTX" ]; then
  export NIFI_PROXY_CONTEXT_HEADER="proxy_set_header X-ProxyContextPath ${CTX};"
else
  export NIFI_PROXY_CONTEXT_HEADER="# no X-ProxyContextPath"
fi

mkdir -p /etc/nginx/tls
CERT=""
KEY=""
# Prefer mounted IDOL / generated certs.
for candidate in \
    /ssl/certs/server.cert.pem /ssl/certs/nifi.cert.pem /ssl/certs/idol-nifi.cert.pem \
    /ssl/server.crt /ssl/nifi.crt /ssl/fullchain.pem /ssl/cert.pem
  do
  if [ -f "$candidate" ]; then CERT="$candidate"; break; fi
done
for candidate in \
    /ssl/private/server.key.pem /ssl/private/nifi.key.pem /ssl/private/idol-nifi.key.pem \
    /ssl/server.key /ssl/nifi.key /ssl/privkey.pem /ssl/key.pem
  do
  if [ -f "$candidate" ]; then KEY="$candidate"; break; fi
done
# Last resort: first leaf cert/key under /ssl (skip CA-looking names).
if [ -z "$CERT" ] && [ -d /ssl ]; then
  CERT="$(find /ssl -type f \( -name '*.crt' -o -name '*.cert.pem' -o -name 'fullchain.pem' \) ! -name 'ca*' ! -name '*intermediate*' 2>/dev/null | head -n1 || true)"
fi
if [ -z "$KEY" ] && [ -d /ssl ]; then
  KEY="$(find /ssl -type f \( -name '*.key' -o -name '*.key.pem' -o -name 'privkey.pem' \) ! -name 'ca*' 2>/dev/null | head -n1 || true)"
fi

if [ -n "$CERT" ] && [ -n "$KEY" ]; then
  export NIFI_PROXY_CERT="$CERT"
  export NIFI_PROXY_KEY="$KEY"
  echo "nifi-proxy TLS using mounted cert $CERT"
else
  export NIFI_PROXY_CERT=/etc/nginx/tls/proxy.crt
  export NIFI_PROXY_KEY=/etc/nginx/tls/proxy.key
  if [ ! -f "$NIFI_PROXY_CERT" ] || [ ! -f "$NIFI_PROXY_KEY" ]; then
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 825 \
      -keyout "$NIFI_PROXY_KEY" -out "$NIFI_PROXY_CERT" \
      -subj "/CN=nifi-proxy" \
      -addext "subjectAltName=${NIFI_PROXY_TLS_SAN:-DNS:localhost,DNS:nifi-proxy,IP:127.0.0.1,IP:20.86.52.130}" \
      >/tmp/proxy-tls.log 2>&1 || {
        echo "failed to generate self-signed proxy cert" >&2
        cat /tmp/proxy-tls.log >&2 || true
        exit 1
      }
    echo "nifi-proxy TLS using generated self-signed cert"
  fi
fi

SUBST='${NIFI_UPSTREAM} ${NIFI_TLS_SERVER_NAME} ${NIFI_PROXY_CONTEXT_HEADER} ${NIFI_PROXY_HOST_PORT} ${NIFI_UI_REDIRECT_PORT} ${NIFI_PROXY_CERT} ${NIFI_PROXY_KEY}'

render() {
  src="$1"; dest="$2"
  if command -v envsubst >/dev/null 2>&1; then
    envsubst "$SUBST" < "$src" > "$dest"
  else
    sed -e "s#\${NIFI_UPSTREAM}#${UPSTREAM}#g" \
        -e "s#\${NIFI_TLS_SERVER_NAME}#${NIFI_TLS_SERVER_NAME}#g" \
        -e "s#\${NIFI_PROXY_CONTEXT_HEADER}#${NIFI_PROXY_CONTEXT_HEADER}#g" \
        -e "s#\${NIFI_PROXY_HOST_PORT}#${NIFI_PROXY_HOST_PORT}#g" \
        -e "s#\${NIFI_UI_REDIRECT_PORT}#${NIFI_UI_REDIRECT_PORT}#g" \
        -e "s#\${NIFI_PROXY_CERT}#${NIFI_PROXY_CERT}#g" \
        -e "s#\${NIFI_PROXY_KEY}#${NIFI_PROXY_KEY}#g" \
        "$src" > "$dest"
  fi
}

render /tmp/nifi-proxy-locations.conf.template /etc/nginx/nifi-proxy-locations.conf
render /tmp/nginx.conf.template /etc/nginx/conf.d/default.conf
if command -v envsubst >/dev/null 2>&1; then
  envsubst '$NIFI_UPSTREAM $NIFI_PROXY_HOST_PORT' \
    < /tmp/nifi-unreach.html.template > /usr/share/nginx/html/nifi-unreach.html
else
  sed -e "s#\${NIFI_UPSTREAM}#${UPSTREAM}#g" \
      -e "s#\${NIFI_PROXY_HOST_PORT}#${NIFI_PROXY_HOST_PORT}#g" \
      /tmp/nifi-unreach.html.template > /usr/share/nginx/html/nifi-unreach.html
fi

echo "nifi-proxy upstream=https://${UPSTREAM} sni=${NIFI_TLS_SERVER_NAME} public_https=:${NIFI_PROXY_HOST_PORT} ctx=${CTX:-<omit>} cert=${NIFI_PROXY_CERT}"
exec nginx -g "daemon off;"
