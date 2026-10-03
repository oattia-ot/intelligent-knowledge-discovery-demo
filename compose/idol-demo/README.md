# IDOL NiFi Unauthorized fix

The working `docker-compose.yml` in this folder is the IDOL demo stack file
(updated by Oren Attia) with the NiFi session-expired error corrected.

## Symptom

Opening `http://20.86.52.130:27111/nifi/#/error` shows:

> Unauthorized  
> Your session has expired. Please navigate home to log in again.

## Why it happened

NiFi 2 (IDOL `nifi-ver2-full`) rejects a request when any of these are true:

1. The browser `Host:port` is not listed in `NIFI_WEB_PROXY_HOST`.
2. The path is `/nifi` but `NIFI_WEB_PROXY_CONTEXT_PATH` is only `/idol-nifi`.
3. Port `27111` is referenced in env but never published on `idol-nifi`.

That combination is exactly the stock IDOL compose file: proxy host listed
`localhost:27111` and `${EXTRA_IP_SANS_ENV}:27111`, context path `/idol-nifi`
only, and **no** `ports:` on the `idol-nifi` service.

## What changed

- Publish `27111:8443` on `idol-nifi`.
- Add `20.86.52.130:27111` and `20.86.52.130:8443` to `NIFI_WEB_PROXY_HOST`.
- Set `NIFI_WEB_PROXY_CONTEXT_PATH: /idol-nifi,/nifi`.
- Declare the missing `idol-staging-volume`.

## Apply

```bash
export EXTRA_IP_SANS_ENV=20.86.52.130
export IDOL_NET_HOST_IP=20.86.52.130
docker compose -f docker-compose.yml up -d idol-nifi
```

Then open **HTTPS** (NiFi is TLS-only on 8443):

`https://20.86.52.130:27111/nifi`

Accept the self-signed certificate, then sign in with
`admin` / `OpenText2026!`.

`http://` on that port will not work — the container listener is HTTPS.
The reverse-proxy path `http://HOST:8330/idol-nifi` remains valid if
`httpd-reverse-proxy/httpd.conf` forwards the four `X-Proxy*` headers.
