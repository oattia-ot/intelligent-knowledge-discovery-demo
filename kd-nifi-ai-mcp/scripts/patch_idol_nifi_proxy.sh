#!/usr/bin/env bash
# Patch a running IDOL NiFi's nifi.properties so the AI HTTP proxy and
# https://HOST:8443 / http://HOST:27111/nifi are accepted.
#
# Default file (Azure IDOL demo):
#   /home/azureuser/idol-docker-setup/persistent-data/nifi-data/conf/nifi.properties
set -euo pipefail
PROPS="${1:-/home/azureuser/idol-docker-setup/persistent-data/nifi-data/conf/nifi.properties}"
PUBLIC_HOST="${2:-20.86.52.130}"
if [[ ! -f "$PROPS" ]]; then
  echo "nifi.properties not found: $PROPS" >&2
  exit 1
fi
cp -a "$PROPS" "$PROPS.bak.$(date +%Y%m%d%H%M%S)"
python3 - "$PROPS" "$PUBLIC_HOST" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
host = sys.argv[2]
text = path.read_text(encoding="utf-8", errors="replace")
lines = text.splitlines()
wanted_hosts = [
    "localhost:8443", "127.0.0.1:8443",
    "localhost:27111", "127.0.0.1:27111",
    f"{host}:8443", f"{host}:27111", host,
    "nifi-proxy:8080", "nifi-proxy", "localhost:8080",
]
out = []
seen_ctx = seen_host = False
for raw in lines:
    if raw.startswith("nifi.web.proxy.context.path="):
        cur = raw.split("=", 1)[1]
        parts = [p.strip() for p in cur.split(",") if p.strip()]
        for extra in ("/idol-nifi", "/nifi", "/"):
            if extra not in parts:
                parts.append(extra)
        out.append("nifi.web.proxy.context.path=" + ",".join(parts))
        seen_ctx = True
    elif raw.startswith("nifi.web.proxy.host="):
        cur = raw.split("=", 1)[1]
        parts = [p.strip() for p in cur.split(",") if p.strip()]
        for extra in wanted_hosts:
            if extra not in parts:
                parts.append(extra)
        out.append("nifi.web.proxy.host=" + ",".join(parts))
        seen_host = True
    else:
        out.append(raw)
if not seen_ctx:
    out.append("nifi.web.proxy.context.path=/idol-nifi,/nifi")
if not seen_host:
    out.append("nifi.web.proxy.host=" + ",".join(wanted_hosts))
path.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"patched {path}")
PY
echo "Restart IDOL NiFi to load properties:"
echo "  docker restart idol-demo-idol-nifi-1"
