# Intelligent Knowledge Discovery Demo — full updated package

SSL folder prompt: removed
Public canvas: https://HOST:27111/nifi
New generic flows: official Cloudera NiFi MCP (`start_new_flow`)

## After unpack
```bash
cd kd-nifi-ai-mcp
sed -i '/^SSL_CERT_DIR=/d' .env
docker compose --env-file .env up -d --build --force-recreate nifi-proxy mcp-server ai-orchestrator ui
```

Ask in chat: "Create a sample flow"
The reply should mention the official NiFi MCP server. Settings → Test
should list MCP tools when the server is up.
