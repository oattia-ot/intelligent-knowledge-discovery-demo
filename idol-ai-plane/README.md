# Attach the knowledge plane to the AI gateway

`idol-docker-setup` is the data plane. It does not run agents. The demo repo consumes these DNS names on `idol-demo-network`.

Before `docker compose up` in `kd-nifi-ai-mcp`, run `./bootstrap-env.sh` there. Compose fails interpolation if `GATEWAY_API_TOKEN` or `GATEWAY_SHARED_SECRET` is missing, and an old `.env` often has neither line. The script adds them and replaces a lab `NIFI_PASSWORD`.

| Name | Port | Gateway use |
|---|---|---|
| `answerserver` | 12000 | Models path. `GET /action=Ask` |
| `idol-content` | 9100 | Index behind Answer Server and PutIDOL |
| `ollama` | 11434 | Answer Server LLM backend only. Agents must not call it. |
| `idol-licenseserver` | 20000 | License |
| NiFi from this setup | 8443 | Single iPaaS. The demo uses external NiFi mode. |

## One network

```bash
docker network create idol-demo-network 2>/dev/null || true
docker compose -f ai-plane/docker-compose.gateway-attach.yml up -d
```

Bring the IDOL stack up first so `answerserver` and `idol-content` already exist, then run the attach file. It only adds aliases and the event forwarder. It does not start a second Content engine.

## Answer Server is the models contract

Paste `ai-plane/answerserver.llm-snippet.cfg` into the Answer Server config from this repo, then restart Answer Server. The gateway sends questions there and never to MCP.

## Events into the audit trail

`ai-plane/events/provenance-to-gateway.sh` posts NiFi provenance summaries to the gateway audit inbox. Schedule it from the host that can read NiFi. The gateway writes `audit.jsonl`.

## Shared env

Copy `ai-plane/tool-plane.env.example` values into the demo repo `.env`. Tokens must match. Do not commit real tokens.
