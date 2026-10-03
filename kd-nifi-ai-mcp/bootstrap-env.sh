#!/usr/bin/env bash
# Fill the compose secrets Compose refuses to interpolate when missing.
# Adds keys that are absent. Replaces an empty value or the lab password.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${1:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
  echo "created $ENV_FILE from .env.example"
fi
python3 - "$ENV_FILE" << 'PY'
from pathlib import Path
import secrets, sys
p = Path(sys.argv[1])
text = p.read_text()
repl = {
    "NIFI_PASSWORD": secrets.token_urlsafe(18),
    "GATEWAY_API_TOKEN": secrets.token_urlsafe(24),
    "GATEWAY_SHARED_SECRET": secrets.token_urlsafe(24),
}
lines, seen = [], set()
for line in text.splitlines():
    key = line.split("=", 1)[0]
    if key in repl:
        value = line.split("=", 1)[1] if "=" in line else ""
        if value.strip() in ("", "OpenText2026!"):
            line = f"{key}={repl[key]}"
            print(f"set {key}")
        else:
            print(f"kept {key}")
        seen.add(key)
    lines.append(line)
for key, value in repl.items():
    if key not in seen:
        lines.append(f"{key}={value}")
        print(f"added {key}")
p.write_text("\n".join(lines) + "\n")
PY
echo "secrets ready in $ENV_FILE"
