# User questions that exposed NiFi misconfiguration

Collected while bringing up the Intelligent Knowledge Discovery Demo. The
scripts in this package now encode these answers so `install.sh` / `start.sh`
do not write the same broken `.env` again.

## Where is `host.docker.internal` configured?

In `kd-nifi-ai-mcp/docker-compose.yml` on `nifi-proxy`, `mcp-server`, and
`ai-orchestrator`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

That is a Docker keyword. Do **not** replace it with an `ipconfig` address
(`172.25.112.1`, `10.100.102.8`, …). Those change.

## What should `extra_hosts` be on Windows / WSL?

Keep `host.docker.internal:host-gateway`. Only pin an IP if `getent hosts`
inside the container fails.

`host.docker.internal:8443` can still return **400 Invalid SNI**. NiFi’s
certificate expects `localhost` (or the container name). The HTTP proxy
(`nifi-proxy`, `proxy_ssl_name localhost`) exists to hide that.

## Why can the assistant not read `/nifi-api/flow/about`?

Typical `NIFI_API_BASES` from an old `.env`:

| Target | What it meant |
|--------|----------------|
| `https://172.25.125.123:8443` | Stale example IP. Not this host. |
| `https://host.docker.internal:8443` | Port may be open; TLS SNI is wrong. |
| `http://nifi-proxy:8080` | Proxy is up; `NIFI_UPSTREAM` still pointed at the dead IP → HTTP 502. |

The Connection dialog cannot change the URL at runtime. Recreate containers
after editing `kd-nifi-ai-mcp/.env`.

## Why did editing `.env` change nothing?

1. The file Compose reads is `kd-nifi-ai-mcp/.env`, not a repo-root `.env`.
2. `docker compose` must be run **in** `kd-nifi-ai-mcp/` (that folder has
   `docker-compose.yml`). From the package root you get `no configuration file provided`.
3. Running containers keep the old environment until `--force-recreate`.
4. `./start.sh` always runs `allocate_ports.py --write-env .env` and can
   put the stale URL back.

## Why do local and external NiFi UIs both fail?

They are not two URLs in the chat page. Both modes consume `NIFI_UPSTREAM`
/ `NIFI_API_BASE` baked into the orchestrator.

- External IDOL NiFi UI: `https://localhost:8443/nifi`
- Local demo proxy UI: `http://localhost:27111/nifi`
- Assistant: `http://localhost:27120`

Older builds also used hardcoded `container_name` values (`nifi-proxy`,
`kd-ai-orchestrator`, …). Local project `kd-nifi-ai-mcp` and external
project `kd-nifi-ai-mcp-ext` then reused the same containers and the old
env. Those names are removed in this build.

## What is the live IDOL container on this kind of host?

```
idol-demo-idol-nifi-1   0.0.0.0:8443->8443   idol-demo-network
```

Correct settings:

```
NIFI_UPSTREAM=idol-demo-idol-nifi-1:8443
NIFI_API_BASE=https://idol-demo-idol-nifi-1:8443/nifi-api
NIFI_API_BASES=https://idol-demo-idol-nifi-1:8443/nifi-api,http://nifi-proxy:8080/nifi-api
NIFI_DOCKER_NETWORK=idol-demo-network
NIFI_DOCKER_NETWORK_EXTERNAL=true
```

`idol-nifi` is only a compose **service** name. Docker DNS that always
works on `idol-demo-network` is the container name
`idol-demo-idol-nifi-1`.

## What does this package do about it now?

- `scripts/probe_nifi.py` logs in and calls `/flow/about` **before** the
  NiFi AI compose stack is started.
- Stale example host `172.25.125.123` is ignored.
- Discovery prefers the running Docker NiFi name + its network.
- `NIFI_API_BASES` no longer puts `host.docker.internal` first (SNI).
- `install.sh --nifi external` refuses to deploy if the probe fails
  (`--skip-nifi-test` to override).
- Local `--create-nifi` starts the NiFi container first, waits for the
  probe, then starts the AI app.

## Why do I see `Error 400 Invalid SNI` on `/nifi-api/flow/about`?

IDOL NiFi (`idol-demo-idol-nifi-1:8443`) presents a certificate for
**localhost**. A TLS client that uses SNI `idol-demo-idol-nifi-1` is
rejected before login:

```
https://idol-demo-idol-nifi-1:8443/nifi-api  →  400 Invalid SNI
http://nifi-proxy:8080/nifi-api              →  same, if the proxy
   forwarded SNI = container name
```

Fix (already in this package):

1. `nifi-proxy` sets `proxy_ssl_name localhost` / `Host: localhost`.
2. Orchestrator and MCP try `http://nifi-proxy:8080/nifi-api` **first**.

Apply on a running host:

```bash
# in kd-nifi-ai-mcp/.env
NIFI_UPSTREAM=idol-demo-idol-nifi-1:8443
NIFI_TLS_SERVER_NAME=localhost
NIFI_API_BASE=http://nifi-proxy:8080/nifi-api
NIFI_BASE_URL=http://nifi-proxy:8080/nifi-api
NIFI_API_BASES=http://nifi-proxy:8080/nifi-api,https://idol-demo-idol-nifi-1:8443/nifi-api
NIFI_DOCKER_NETWORK=idol-demo-network
NIFI_DOCKER_NETWORK_EXTERNAL=true

cd kd-nifi-ai-mcp
docker compose --env-file .env up -d --build --force-recreate nifi-proxy mcp-server ai-orchestrator ui
```

Then in NiFi AI ask again: *What is the connected NiFi version?*

## Context path not allowed + Invalid SNI + /nifi/#/error Unauthorized

These three are the same reverse-proxy allowlist problem.

| Call | Error | Meaning |
|------|-------|---------|
| `http://nifi-proxy:8080/nifi-api` | `Request Header Context Path not allowed based on properties [nifi.web.proxy.context.path]` | Proxy sent `X-ProxyContextPath: /nifi` but IDOL NiFi only allows `/idol-nifi`. |
| `https://idol-demo-idol-nifi-1:8443/nifi-api` | `400 Invalid SNI` | TLS SNI was the container name; the cert is `localhost`. |
| `http://20.86.52.130:27111/nifi/#/error` Unauthorized | Session / proxy host | Browser host `:27111` is not in `nifi.web.proxy.host`, or context path still wrong. |

This package no longer sends `X-ProxyContextPath` unless you set
`NIFI_PROXY_CONTEXT_PATH` in `.env`. Rebuild `nifi-proxy`.

Then patch the **IDOL** NiFi properties (persisted under
`idol-docker-setup/persistent-data/nifi-data/conf`) and restart that
container:

```bash
./kd-nifi-ai-mcp/scripts/patch_idol_nifi_proxy.sh   /home/azureuser/idol-docker-setup/persistent-data/nifi-data/conf/nifi.properties   20.86.52.130

docker restart idol-demo-idol-nifi-1

cd kd-nifi-ai-mcp
docker compose --env-file .env up -d --build --force-recreate nifi-proxy mcp-server ai-orchestrator
```

Use the UI at `http://20.86.52.130:27111/nifi` (HTTP, through the AI
proxy) or `https://20.86.52.130:8443/nifi` (direct TLS).
