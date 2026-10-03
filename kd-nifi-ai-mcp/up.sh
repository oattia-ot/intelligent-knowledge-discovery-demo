#!/usr/bin/env bash
# Create missing gateway secrets, then start the stack.
set -euo pipefail
cd "$(dirname "$0")"
chmod +x bootstrap-env.sh
./bootstrap-env.sh .env
docker compose up -d --build "$@"
echo "waiting for gateway"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:27100/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:27100/health
    echo
    exit 0
  fi
  sleep 1
done
echo "gateway did not answer on :27100 yet; check: docker compose logs ai-gateway --tail 80" >&2
exit 1
