#!/bin/sh
# Forward a provenance summary into the gateway audit trail.
# The gateway stores it. This script does not deploy flows.
set -eu
GATEWAY_URL="${GATEWAY_URL:-http://ai-gateway:8080}"
TOKEN="${GATEWAY_API_TOKEN:?Set GATEWAY_API_TOKEN}"

post_once() {
  curl -fsS -X POST "$GATEWAY_URL/v1/events" \
    -H "Authorization: Bearer $TOKEN" \
    -H "content-type: application/json" \
    -d '{"source":"nifi-provenance","summary":"provenance heartbeat","agent":"event-forwarder"}' >/dev/null || true
  echo "provenance heartbeat sent to $GATEWAY_URL"
}

if [ "${1:-}" = "--once" ]; then
  post_once
  exit 0
fi

while true; do
  post_once
  sleep "${PROVENANCE_INTERVAL_SECONDS:-300}"
done
