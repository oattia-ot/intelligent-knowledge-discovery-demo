# Deploy and test the gateway, tools, and A2A

The demo repo is the agent plane. `idol-docker-setup` is the knowledge plane. They share `idol-demo-network`. The browser talks only to the gateway on port 27100.

## 1. Knowledge plane

On the Linux host that will run IDOL:

```bash
git clone https://github.com/oattia-ot/idol-docker-setup.git
cd idol-docker-setup
# copy ai-plane/ from the overlay zip into this clone
docker network create idol-demo-network 2>/dev/null || true
```

Deploy IDOL with the Setup Manager as documented in that repo (license, Content, Answer Server, Ollama, one NiFi). Then paste `ai-plane/answerserver.llm-snippet.cfg` into `answerserver.cfg` and restart Answer Server.

```bash
docker compose restart answerserver
curl -fsS "http://localhost:12000/action=GetStatus" | head
```

Do not start a second Ollama for the demo. The gateway models path is `http://answerserver:12000/action=Ask`.

Optional event forwarder, after the gateway is up:

```bash
docker compose -f ai-plane/docker-compose.gateway-attach.yml up -d
```

## 2. Agent plane

```bash
unzip intelligent-knowledge-discovery-demo-gateway-a2a.zip
cd ikd/kd-nifi-ai-mcp
chmod +x bootstrap-env.sh up.sh
./up.sh
```

`./install.sh` calls `kd-nifi-ai-mcp/start.sh`, which rewrites `.env` and then runs Compose. That rewrite used to omit `GATEWAY_API_TOKEN` and `GATEWAY_SHARED_SECRET`, so Compose stopped with `required variable ... is missing`. `start.sh` now adds those two keys when they are absent before `docker compose up`. An existing non-empty value is kept.

Point `NIFI_API_BASE` at the existing NiFi before `./up.sh` if it is not already set. Do not enable the `create-nifi` or `create-ollama` profiles.

Health is `curl -fsS http://127.0.0.1:27100/health`. A reset in the first seconds means Uvicorn is not listening yet. `./up.sh` waits for it. `tokenConfigured` must be true.

Optional overrides in the same `.env`, if the defaults do not match the host:

```bash
NIFI_LOCATION=external
NIFI_API_BASE=https://<nifi-host>:8443/nifi-api
OLLAMA_BASE_URL=http://ollama:11434
ANSWER_SERVER_URL=http://answerserver:12000
NIFI_DOCKER_NETWORK=idol-demo-network
NIFI_DOCKER_NETWORK_EXTERNAL=true
```

Copy `GATEWAY_API_TOKEN` into `idol-docker-setup/ai-plane/tool-plane.env.example` only if you start the provenance forwarder. MCP is not published. The public port is 27100.

## 3. Test the happy path

```bash
export GATEWAY_URL=http://localhost:27100
export GATEWAY_API_TOKEN=<the token from .env>
bash ../gateway/demo_a2a.sh
```

Expect this order in `GET /v1/audit`:

1. `a2a.proposed`
2. `a2a.planned`
3. `a2a.approved`
4. `tools.executed` if NiFi is reachable, otherwise `tools.error` and the task stays `approved`

A task that stays `approved` after a 502 can be executed again. It is not completed until the orchestrator returns 2xx.

## 4. Test the guards

Replace `$T` with the token and `$ID` with a task id from the walkthrough.

```bash
# 401 missing identity
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:27100/v1/a2a/tasks \
  -H 'content-type: application/json' \
  -d '{"intent":"x","proposedTool":"create_kd_file_connector_flow","fromAgent":"search-agent"}'

# 403 flow agent cannot open a task
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:27100/v1/a2a/tasks \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"intent":"x","proposedTool":"create_kd_file_connector_flow","fromAgent":"flow-agent"}'

# 403 tool not allow-listed
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:27100/v1/a2a/tasks \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"intent":"x","proposedTool":"drop_database","fromAgent":"search-agent"}'

# 409 approve before plan
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:27100/v1/a2a/tasks/$ID/approve \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"approver":"human"}'

# 409 invoke with no approval
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:27100/v1/tools/invoke \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"name":"create_kd_file_connector_flow","arguments":{},"agent":"flow-agent"}'
```

Expected codes: `401`, `403`, `403`, `409`, `409`.

Models path, which must not create a task:

```bash
curl -sS -X POST http://localhost:27100/v1/models/ask \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"question":"What contracts mention renewal?","agent":"search-agent"}'
```

`path` is `models`. If Answer Server is down the status is still `200` and `grounded` is false.

## 5. What success looks like

- Gateway health on `:27100`, MCP not listening on the host `:27115`.
- Audit contains the four A2A events for one task id.
- NiFi has a new process group only after `tools.executed`.
- A direct call to `:27110/kd/tools/create_kd_file_connector_flow` returns `403`.
