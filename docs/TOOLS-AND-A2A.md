# Tools and A2A behind the AI gateway

The browser talks only to the gateway on `:27100`. MCP SSE (`mcp-server:8000`) is not published.

| Call | Who | Gateway route | Downstream |
|---|---|---|---|
| Ask a question | search agent | `POST /v1/models/ask` | Answer Server `action=Ask` on idol-docker-setup. Never Ollama, never MCP. |
| Propose a connector | search agent | `POST /v1/a2a/tasks` | Stored as `proposed`. No NiFi write. |
| Attach a plan | flow agent | `POST /v1/a2a/tasks/{id}/plan` | Stored as `planned`. No NiFi write. |
| Approve | human | `POST /v1/a2a/tasks/{id}/approve` | Stored as `approved`. Audit row written. |
| Deploy the flow | flow agent | `POST /v1/a2a/tasks/{id}/execute` | Allow-list check, then `POST /kd/tools/{name}` with `X-Gateway-Secret` and `X-Gateway-Approval`. |

Allow-listed mutating tools live in `gateway/tool_allowlist.json`:

- `create_kd_file_connector_flow`
- `create_kd_idol_nifi2_flow`
- `create_kd_ai_python_flow`
- `create_kd_sap_flow`
- `create_kd_documentum_flow`

Direct calls to those tools on the orchestrator are rejected unless the gateway secret and an approval id are present (`gateway_guard.py`).

## Run with idol-docker-setup

1. Bring up IDOL from `idol-docker-setup` so `idol-demo-network` exists and `answerserver`, `idol-content`, and `ollama` are on it.
2. Copy `.env.example` to `.env` and set `NIFI_PASSWORD`, `GATEWAY_API_TOKEN`, and `GATEWAY_SHARED_SECRET`. Do not reuse `OpenText2026!`.
3. Point this stack at that NiFi (`NIFI_LOCATION=external`). Do not enable the `create-nifi` or `create-ollama` profiles.
4. `docker compose up -d --build` from `kd-nifi-ai-mcp`.
5. Walk the contract: `bash gateway/demo_a2a.sh`.

Audit events are appended to the `gateway-audit` volume at `/data/audit.jsonl` and readable at `GET /v1/audit`.
