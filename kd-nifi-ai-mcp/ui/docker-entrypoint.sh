#!/bin/sh
set -eu
PORT="${ORCHESTRATOR_HOST_PORT:-27110}"
URL="${ORCHESTRATOR_PUBLIC_URL:-http://localhost:${PORT}}"
INTERNAL="${ORCHESTRATOR_INTERNAL_URL:-http://ai-orchestrator:8080}"

# Same-origin proxy: the browser on :27120 calls /chat on this server.
# Do not force window.ORCHESTRATOR_URL to localhost — that made remote
# clients fetch the *laptop* :27110.
if command -v envsubst >/dev/null 2>&1; then
  ORCHESTRATOR_INTERNAL_URL="${INTERNAL}" envsubst '${ORCHESTRATOR_INTERNAL_URL}' \
    < /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf
else
  sed "s#\${ORCHESTRATOR_INTERNAL_URL}#${INTERNAL}#g" \
    /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf
fi

sed "s#http://localhost:27110#${URL}#g" \
  /usr/share/nginx/html/index.html.template > /usr/share/nginx/html/index.html
exec nginx -g "daemon off;"
