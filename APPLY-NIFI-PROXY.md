# Apply NiFi HTTPS proxy + connection-color fixes

Public canvas URL is now **HTTPS on 27111**:

- `https://20.86.52.130:27111/nifi`
- Direct IDOL TLS remains `https://20.86.52.130:8443/nifi`
- Orchestrator / MCP still use internal `http://nifi-proxy:8080/nifi-api`

`nifi-proxy` listens:

- `:8443` TLS inside the container, published as host `27111`
- `:8080` HTTP on the Docker network only (not published)

## On the IDOL host

```bash
./kd-nifi-ai-mcp/scripts/patch_idol_nifi_proxy.sh \
  /home/azureuser/idol-docker-setup/persistent-data/nifi-data/conf/nifi.properties \
  20.86.52.130

docker restart idol-demo-idol-nifi-1
```

Copy `compose/idol-docker-setup/docker-compose.yml` over the IDOL stack compose
if you have not already (`NIFI_WEB_PROXY_CONTEXT_PATH=/idol-nifi,/nifi` and
`20.86.52.130:27111` on `NIFI_WEB_PROXY_HOST`).

## On the NiFi AI stack

In `kd-nifi-ai-mcp/.env`:

```
NIFI_UPSTREAM=idol-nifi:8443
NIFI_TLS_SERVER_NAME=localhost
NIFI_DOCKER_NETWORK=idol-demo-network
NIFI_DOCKER_NETWORK_EXTERNAL=true
NIFI_API_BASE=http://nifi-proxy:8080/nifi-api
NIFI_API_BASES=http://nifi-proxy:8080/nifi-api,https://idol-nifi:8443/nifi-api
NIFI_PUBLIC_URL=https://20.86.52.130:27111/nifi
```

```bash
cd kd-nifi-ai-mcp
docker compose --env-file .env up -d --build --force-recreate nifi-proxy ui
```

The first visit to `https://20.86.52.130:27111/nifi` may warn about a
self-signed certificate unless `SSL_CERT_DIR` points at the IDOL
`generate-ssl-certs/ssl` folder.

Chat UI: `http://20.86.52.130:27120/` → Connection (green = OK, red = down).
