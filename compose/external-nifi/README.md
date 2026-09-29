# External NiFi compose project

This directory is a **separate Docker Compose project** (`kd-nifi-ai-mcp-ext`)
used when you already have a NiFi instance and do not want
`kd-nifi-ai-mcp` to create one.

| Mode | Compose project | Creates NiFi container? |
|------|-----------------|-------------------------|
| Local stack | `kd-nifi-ai-mcp` | Optional (`create-nifi` profile) |
| External URL | `kd-nifi-ai-mcp-ext` | Never |

`install.sh` writes `kd-nifi-ai-mcp/.env` with `NIFI_EXTERNAL_URL` / `NIFI_API_BASE`
and then starts this project:

```bash
docker compose -p kd-nifi-ai-mcp-ext \
  --env-file ../../kd-nifi-ai-mcp/.env \
  -f ../../kd-nifi-ai-mcp/docker-compose.yml \
  up -d --build
```

Stop only this project (leave the search UI and a local stack alone):

```bash
../../undeploy.sh --nifi-external
```
