"""Direct NiFi REST helper used when the official MCP transport is down."""

from __future__ import annotations

import asyncio
import os
import ssl
import urllib.parse
from typing import Any

import httpx


class NiFiRestError(RuntimeError):
    pass


def _bases() -> list[str]:
    raw = [
        os.environ.get("NIFI_API_BASE", ""),
        os.environ.get("NIFI_BASE_URL", ""),
        os.environ.get("NIFI_EXTERNAL_API", ""),
    ]
    extras = os.environ.get("NIFI_API_BASES", "")
    raw.extend(p.strip() for p in extras.split(",") if p.strip())
    seen: list[str] = []
    for item in raw:
        item = (item or "").strip().rstrip("/")
        if item and item not in seen:
            seen.append(item)
    # HTTP proxy first. Direct https://<container>:8443 sends SNI=<container>
    # and IDOL NiFi returns HTTP 400 Invalid SNI.
    http_first = [b for b in seen if b.startswith("http://")]
    https = [b for b in seen if b.startswith("https://")]
    ordered = http_first + https
    return ordered or ["http://nifi-proxy:8080/nifi-api"]


def _verify() -> bool:
    return os.environ.get("NIFI_VERIFY_SSL", "false").lower() == "true"


def _tls_sni() -> str:
    return os.environ.get("NIFI_TLS_SERVER_NAME") or "localhost"


def _is_local_host(host: str) -> bool:
    return (host or "").lower() in {"localhost", "127.0.0.1", "::1", "nifi-proxy"}


async def _https_sni_request(
    tcp_host: str,
    tcp_port: int,
    sni: str,
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: float = 8.0,
) -> tuple[int, str]:
    """TLS request with SNI=localhost while TCP-connecting to a container name.

    Jetty 10 / NiFi 2 rejects SNI=<container> with HTTP 400 Invalid SNI because
    the generated cert SAN is localhost (and maybe the public host), not the
    Docker DNS name.
    """
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(tcp_host, tcp_port, ssl=ctx, server_hostname=sni),
        timeout=timeout,
    )
    try:
        hdrs = dict(headers or {})
        hdrs.setdefault("Host", f"{sni}:{tcp_port}")
        hdrs.setdefault("Connection", "close")
        if body is not None:
            hdrs.setdefault("Content-Length", str(len(body)))
        req = f"{method} {path} HTTP/1.1\r\n"
        for key, val in hdrs.items():
            req += f"{key}: {val}\r\n"
        req += "\r\n"
        writer.write(req.encode("utf-8") + (body or b""))
        await writer.drain()
        raw = await asyncio.wait_for(reader.read(2_000_000), timeout=timeout)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
    text = raw.decode("utf-8", "ignore")
    if "\r\n\r\n" in text:
        head, payload = text.split("\r\n\r\n", 1)
    else:
        head, payload = text, ""
    status = 0
    first = head.split("\r\n", 1)[0]
    parts = first.split(" ")
    if len(parts) >= 2 and parts[1].isdigit():
        status = int(parts[1])
    return status, payload


def _split_api(base: str) -> tuple[str, int, str, str]:
    parsed = urllib.parse.urlparse(base if "://" in base else "https://" + base)
    host = parsed.hostname or "localhost"
    scheme = parsed.scheme or "https"
    port = parsed.port or (443 if scheme == "https" else 80)
    path = parsed.path or "/nifi-api"
    if not path.startswith("/"):
        path = "/" + path
    return host, port, scheme, path.rstrip("/") or "/nifi-api"


def _entity_id(entity: dict[str, Any] | None) -> str:
    if not entity:
        return ""
    return str(
        entity.get("id")
        or (entity.get("component") or {}).get("id")
        or (entity.get("processGroupFlow") or {}).get("id")
        or ""
    )


class NiFiRest:
    def __init__(self) -> None:
        self.bases = _bases()
        self.base = self.bases[0]
        self.username = os.environ.get("NIFI_USERNAME", "admin")
        self.password = os.environ.get("NIFI_PASSWORD", "OpenText2026!")
        self.verify = _verify()
        self._resolved: str | None = None
        self._token: str | None = None
        self._client_id: str | None = None
        self._sni_direct: bool = False

    def _token_ok(self, status: int, token: str) -> bool:
        return status in (200, 201) and bool(token) and "<html" not in token.lower() and "invalid sni" not in token.lower()

    async def _login_httpx(self, base: str) -> tuple[bool, str]:
        async with httpx.AsyncClient(
            base_url=base,
            verify=self.verify,
            timeout=8.0,
            follow_redirects=True,
            headers={"Accept": "text/plain, application/json"},
        ) as client:
            if self.username and self.password:
                resp = await client.post(
                    "/access/token",
                    data={"username": self.username, "password": self.password},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                token = resp.text.strip()
                if self._token_ok(resp.status_code, token):
                    self._token = token
                    return True, token
                return False, f"{base} token HTTP {resp.status_code}: {token[:160]}"
            resp = await client.get("/access/config")
            if resp.status_code < 500:
                return True, ""
            return False, f"{base} config HTTP {resp.status_code}"

    async def _login_sni(self, base: str) -> tuple[bool, str]:
        host, port, scheme, api_path = _split_api(base)
        if scheme != "https" or _is_local_host(host):
            return False, f"{base} skip SNI override"
        sni = _tls_sni()
        body = urllib.parse.urlencode(
            {"username": self.username or "", "password": self.password or ""}
        ).encode()
        status, payload = await _https_sni_request(
            host,
            port,
            sni,
            "POST",
            f"{api_path}/access/token",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "text/plain",
                "Host": f"{sni}:{port}",
            },
            body=body,
        )
        token = payload.strip()
        if self._token_ok(status, token):
            self._token = token
            self._sni_direct = True
            return True, token
        return False, f"{base} SNI={sni} token HTTP {status}: {token[:160]}"

    async def _pick(self) -> str:
        if self._resolved:
            return self._resolved
        errors: list[str] = []
        for base in self.bases:
            try:
                ok, detail = await self._login_httpx(base)
                if ok:
                    self._resolved = base
                    self.base = base
                    self._sni_direct = False
                    return base
                errors.append(detail)
                if "invalid sni" in detail.lower() or "context path not allowed" in detail.lower():
                    ok, detail = await self._login_sni(base)
                    if ok:
                        self._resolved = base
                        self.base = base
                        return base
                    errors.append(detail)
            except Exception as exc:
                errors.append(f"{base} -> {exc}")
                try:
                    ok, detail = await self._login_sni(base)
                    if ok:
                        self._resolved = base
                        self.base = base
                        return base
                    errors.append(detail)
                except Exception as exc2:
                    errors.append(f"{base} SNI -> {exc2}")
        raise NiFiRestError(
            "NiFi login failed on every target. Tried: " + " | ".join(errors[:8])
        )

    def _auth_headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
            # NiFi CSRF: mutating calls need Request-Token as well as Bearer.
            headers["Request-Token"] = self._token
        return headers

    async def _ensure_token(self, client: httpx.AsyncClient | None = None) -> None:
        if self._token:
            return
        await self._pick()

    async def _req_sni(self, method: str, path: str, **kwargs: Any) -> Any:
        host, port, _scheme, api_path = _split_api(self.base)
        sni = _tls_sni()
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.update(self._auth_headers())
        body = None
        if "json" in kwargs:
            import json as _json

            body = _json.dumps(kwargs.pop("json")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif "data" in kwargs:
            data = kwargs.pop("data")
            if isinstance(data, bytes):
                body = data
            elif isinstance(data, dict):
                body = urllib.parse.urlencode(data).encode()
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            else:
                body = str(data).encode()
        status, payload = await _https_sni_request(
            host,
            port,
            sni,
            method,
            f"{api_path}{path if path.startswith('/') else '/' + path}",
            headers=headers,
            body=body,
            timeout=30.0,
        )
        if status >= 400:
            raise NiFiRestError(f"{method} {path} -> {status}: {payload[:500]}")
        if not payload.strip():
            return {}
        try:
            import json as _json

            return _json.loads(payload)
        except Exception:
            return {"text": payload}

    async def _req(self, method: str, path: str, **kwargs: Any) -> Any:
        await self._pick()
        if self._sni_direct:
            return await self._req_sni(method, path, **kwargs)
        async with httpx.AsyncClient(
            base_url=self.base,
            verify=self.verify,
            timeout=30.0,
            follow_redirects=True,
        ) as client:
            headers = kwargs.pop("headers", {})
            headers.update(self._auth_headers())
            resp = await client.request(method, path, headers=headers, **kwargs)
            if resp.status_code >= 400:
                body = resp.text[:500]
                if resp.status_code == 403:
                    raise NiFiRestError(
                        f"{method} {path} -> 403 Forbidden. "
                        "The login works but this user cannot change the canvas. "
                        "On IDOL NiFi open the UI as admin, select the root group, "
                        "and confirm Operate/modify is allowed. "
                        "Also check nifi.web.proxy.host includes the API Host header. "
                        f"Detail: {body[:240]}"
                    )
                raise NiFiRestError(f"{method} {path} -> {resp.status_code}: {body}")
            if not resp.content:
                return {}
            try:
                return resp.json()
            except Exception:
                return {"text": resp.text}

    async def _revision(self) -> dict[str, Any]:
        if not self._client_id:
            try:
                cid = await self._req("GET", "/flow/client-id")
                self._client_id = cid if isinstance(cid, str) else str(cid)
            except Exception:
                self._client_id = "kd-ai"
        return {"clientId": self._client_id, "version": 0}

    def _payload(self, component: dict[str, Any], revision: dict[str, Any] | None = None) -> dict[str, Any]:
        return {
            "revision": revision or {"clientId": self._client_id or "kd-ai", "version": 0},
            "disconnectedNodeAcknowledged": True,
            "component": component,
        }

    async def about(self) -> dict:
        data = await self._req("GET", "/flow/about")
        about = data.get("about") or data
        return {
            "ok": True,
            "baseUrl": self.base,
            "title": about.get("title"),
            "version": about.get("version"),
            "buildTag": about.get("buildTag"),
            "uri": about.get("uri"),
        }

    async def ping(self) -> dict:
        data = await self._req("GET", "/flow/process-groups/root")
        pg = data.get("processGroupFlow") or data
        return {
            "ok": True,
            "baseUrl": self.base,
            "rootProcessGroupId": _entity_id(pg) or _entity_id(data),
            "name": ((pg.get("breadcrumb") or {}).get("breadcrumb") or {}).get("name"),
        }

    async def create_sample_flow(self, name: str = "Sample GenerateFlowFile") -> dict:
        root = await self._req("GET", "/flow/process-groups/root")
        flow = root.get("processGroupFlow") or root
        root_id = _entity_id(flow) or _entity_id(root)
        if not root_id:
            raise NiFiRestError(f"Root process group id missing from {list(root)[:8]}")

        parent = await self._req("GET", f"/process-groups/{root_id}")
        perms = ((parent.get("component") or {}).get("permissions") or parent.get("permissions") or {})
        if perms.get("canWrite") is False:
            raise NiFiRestError(
                f"User {self.username} has canWrite=false on root process group {root_id}. "
                "Grant modify/operate on the canvas in the IDOL NiFi UI, then retry."
            )

        rev = await self._revision()
        try:
            group = await self._req(
                "POST",
                f"/process-groups/{root_id}/process-groups",
                json=self._payload({"name": name, "position": {"x": 400.0, "y": 0.0}}, rev),
            )
            group_id = _entity_id(group)
        except NiFiRestError as exc:
            if "403" not in str(exc):
                raise
            # Fall back to wiring processors on the root canvas.
            group_id = root_id
            name = name + " (on root)"

        if not group_id:
            raise NiFiRestError("NiFi created a group but the response had no id")

        gen = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": "org.apache.nifi.processors.standard.GenerateFlowFile",
                    "name": "GenerateFlowFile",
                    "position": {"x": 0.0, "y": 0.0},
                },
                await self._revision(),
            ),
        )
        log = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": "org.apache.nifi.processors.standard.LogAttribute",
                    "name": "LogAttribute",
                    "position": {"x": 0.0, "y": 200.0},
                },
                await self._revision(),
            ),
        )
        gen_id = _entity_id(gen)
        log_id = _entity_id(log)
        if not gen_id or not log_id:
            raise NiFiRestError(f"Processor create returned no id (gen={list(gen)[:6]} log={list(log)[:6]})")

        await self._req(
            "PUT",
            f"/processors/{gen_id}",
            json=self._payload(
                {"id": gen_id, "config": {"properties": {"File Size": "1B", "Batch Size": "1"}}},
                gen.get("revision") or await self._revision(),
            ),
        )
        await self._req(
            "POST",
            f"/process-groups/{group_id}/connections",
            json=self._payload(
                {
                    "source": {"id": gen_id, "groupId": group_id, "type": "PROCESSOR"},
                    "destination": {"id": log_id, "groupId": group_id, "type": "PROCESSOR"},
                    "selectedRelationships": ["success"],
                },
                await self._revision(),
            ),
        )
        return {
            "name": name,
            "groupId": group_id,
            "rootId": root_id,
            "canWrite": perms.get("canWrite"),
            "baseUrl": self.base,
            "processors": {"GenerateFlowFile": gen_id, "LogAttribute": log_id},
            "nifiUi": "Open the NiFi canvas and look for: " + name,
            "controllerServices": await self.ensure_idol_controller_services(group_id, required=False),
        }

    async def inspect_root(self) -> dict:
        data = await self._req("GET", "/flow/process-groups/root")
        flow = data.get("processGroupFlow") or data
        inner = flow.get("flow") or {}
        breadcrumb = ((flow.get("breadcrumb") or {}).get("breadcrumb") or {})
        return {
            "ok": True,
            "baseUrl": self.base,
            "id": _entity_id(flow) or _entity_id(data),
            "name": breadcrumb.get("name"),
            "flowCounts": {
                "processGroups": len(inner.get("processGroups") or []),
                "processors": len(inner.get("processors") or []),
                "connections": len(inner.get("connections") or []),
            },
        }

    async def create_idol_sample_flow(
        self,
        name: str = "KD IDOL File Ingest",
        source_path: str = "/idol-ingest",
        idol_host: str | None = None,
        idol_port: str | None = None,
    ) -> dict:
        idol_host = idol_host or os.environ.get("IDOL_HOST", "idol-content")
        idol_port = idol_port or os.environ.get("IDOL_PORT", "9100")
        root = await self._req("GET", "/flow/process-groups/root")
        flow = root.get("processGroupFlow") or root
        root_id = _entity_id(flow) or _entity_id(root)
        if not root_id:
            raise NiFiRestError("Root process group id missing")
        rev = await self._revision()
        try:
            group = await self._req(
                "POST",
                f"/process-groups/{root_id}/process-groups",
                json=self._payload({"name": name, "position": {"x": 0.0, "y": 400.0}}, rev),
            )
            group_id = _entity_id(group)
        except NiFiRestError as exc:
            if "403" not in str(exc):
                raise
            group_id = root_id
            name = name + " (on root)"
        if not group_id:
            raise NiFiRestError("Could not determine process group id for IDOL sample")

        get_file = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": "org.apache.nifi.processors.standard.GetFile",
                    "name": "GetFile",
                    "position": {"x": 0.0, "y": 0.0},
                },
                await self._revision(),
            ),
        )
        get_id = _entity_id(get_file)
        await self._req(
            "PUT",
            f"/processors/{get_id}",
            json=self._payload(
                {
                    "id": get_id,
                    "config": {
                        "properties": {
                            "Input Directory": source_path,
                            "Recurse Subdirectories": "true",
                            "File Filter": r".*\.(pdf|docx?|xlsx?|txt|html?)",
                            "Keep Source File": "true",
                        }
                    },
                },
                get_file.get("revision") or await self._revision(),
            ),
        )
        meta = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": "org.apache.nifi.processors.attributes.UpdateAttribute",
                    "name": "Map KD / IDOL metadata",
                    "position": {"x": 0.0, "y": 200.0},
                },
                await self._revision(),
            ),
        )
        meta_id = _entity_id(meta)
        await self._req(
            "PUT",
            f"/processors/{meta_id}",
            json=self._payload(
                {
                    "id": meta_id,
                    "config": {
                        "properties": {
                            "kd.source": "file-share",
                            "kd.index": "documents",
                            "idol.host": idol_host,
                            "idol.port": idol_port,
                        }
                    },
                },
                meta.get("revision") or await self._revision(),
            ),
        )
        send = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": "org.apache.nifi.processors.standard.InvokeHTTP",
                    "name": "Send to IDOL Content",
                    "position": {"x": 0.0, "y": 400.0},
                },
                await self._revision(),
            ),
        )
        send_id = _entity_id(send)
        await self._req(
            "PUT",
            f"/processors/{send_id}",
            json=self._payload(
                {
                    "id": send_id,
                    "config": {
                        "properties": {
                            "HTTP Method": "POST",
                            "Remote URL": f"http://{idol_host}:{idol_port}/action=index",
                            "Content-Type": "application/octet-stream",
                        }
                    },
                },
                send.get("revision") or await self._revision(),
            ),
        )
        for src, dst in ((get_id, meta_id), (meta_id, send_id)):
            await self._req(
                "POST",
                f"/process-groups/{group_id}/connections",
                json=self._payload(
                    {
                        "source": {"id": src, "groupId": group_id, "type": "PROCESSOR"},
                        "destination": {"id": dst, "groupId": group_id, "type": "PROCESSOR"},
                        "selectedRelationships": ["success"],
                    },
                    await self._revision(),
                ),
            )
        return {
            "name": name,
            "pattern": "idol-file",
            "groupId": group_id,
            "rootId": root_id,
            "baseUrl": self.base,
            "idol": {
                "host": idol_host,
                "port": idol_port,
                "indexUrl": f"http://{idol_host}:{idol_port}/action=index",
            },
            "sourcePath": source_path,
            "processors": {
                "GetFile": get_id,
                "Map KD / IDOL metadata": meta_id,
                "Send to IDOL Content": send_id,
            },
            "nifiUi": "Open the NiFi canvas for process group: " + name,
            "controllerServices": await self.ensure_idol_controller_services(group_id, required=False),
        }

    async def _catalog_types(self, kind: str) -> list[str]:
        path = "/flow/controller-service-types" if kind == "cs" else "/flow/processor-types"
        data = await self._req("GET", path)
        rows = data.get("controllerServiceTypes") or data.get("processorTypes") or []
        return [str(row.get("type") or "") for row in rows if row.get("type")]

    async def has_type(self, kind: str, needle: str) -> bool:
        needle_l = needle.lower()
        return any(needle_l in typ.lower() for typ in await self._catalog_types(kind))

    async def is_idol_nifi(self) -> bool:
        return await self.has_type("cs", "IdolSslConfigServiceImpl") or await self.has_type(
            "cs", "IdolLicenseServiceImpl"
        )

    async def _resolve_type(self, kind: str, needle: str, fallback: str) -> str:
        needle_l = needle.lower()
        for typ in await self._catalog_types(kind):
            if needle_l in typ.lower():
                return typ
        return fallback

    async def _create_cs(self, group_id: str, type_name: str, name: str, props: dict[str, str]) -> dict:
        created = await self._req(
            "POST",
            f"/process-groups/{group_id}/controller-services",
            json=self._payload({"type": type_name, "name": name}, await self._revision()),
        )
        cs_id = _entity_id(created)
        if not cs_id:
            raise NiFiRestError(f"Controller service {name} created without id")
        if props:
            current = await self._req("GET", f"/controller-services/{cs_id}")
            await self._req(
                "PUT",
                f"/controller-services/{cs_id}",
                json=self._payload(
                    {"id": cs_id, "name": name, "properties": props},
                    current.get("revision") or await self._revision(),
                ),
            )
        return {"id": cs_id, "name": name, "type": type_name}

    async def ensure_idol_controller_services(self, group_id: str, required: bool = True) -> dict:
        """Create IdolSslConfigServiceImpl + IdolLicenseServiceImpl on the group.

        Stock apache/nifi (local compose image) does not ship these types.
        Remote IDOL NiFi (`microfocusidolserver/nifi-ver2-full`) does.
        """
        if not await self.is_idol_nifi():
            msg = (
                "This NiFi instance does not include OpenText IDOL NARs "
                "(IdolSslConfigServiceImpl). Local compose uses apache/nifi; "
                "IDOL samples need the remote IDOL image or NIFI_IMAGE="
                "microfocusidolserver/nifi-ver2-full:26.3."
            )
            if required:
                raise NiFiRestError(msg)
            return {"skipped": True, "reason": msg}
        ssl_type = await self._resolve_type(
            "cs",
            "IdolSslConfigServiceImpl",
            "idol.nifi.service.IdolSslConfigServiceImpl",
        )
        # docs sometimes spell it IdolSSLConfigServiceImpl
        if ssl_type == "idol.nifi.service.IdolSslConfigServiceImpl":
            try:
                ssl_type = await self._resolve_type("cs", "IdolSSLConfigServiceImpl", ssl_type)
            except Exception:
                pass
        lic_type = await self._resolve_type(
            "cs",
            "IdolLicenseServiceImpl",
            "idol.nifi.service.IdolLicenseServiceImpl",
        )
        ssl_props = {
            "CheckCertificate": os.environ.get("IDOL_SSL_CHECK_CERT", "false"),
            "CheckCommonName": os.environ.get("IDOL_SSL_CHECK_CN", "false"),
            "Method": os.environ.get("IDOL_SSL_METHOD", "Negotiate"),
        }
        ca = os.environ.get("IDOL_SSL_AUTHORITY_CERTS", "/ssl")
        if ca:
            ssl_props["AuthorityCertificates"] = ca
            ssl_props["Authority certificates"] = ca
        ssl = await self._create_cs(group_id, ssl_type, "IdolSslConfigServiceImpl", ssl_props)

        host = os.environ.get("IDOL_LICENSE_HOST", os.environ.get("IDOL_HOST", "idol-licenseserver"))
        port = os.environ.get("IDOL_LICENSE_PORT", "20000")
        lic_props = {
            "LicenseServerHost": host,
            "License Server Hostname": host,
            "LicenseServerPort": port,
            "License Server Port": port,
            "SSLConfigService": ssl["id"],
            "SSL Config Service": ssl["id"],
        }
        lic = await self._create_cs(group_id, lic_type, "IdolLicenseServiceImpl", lic_props)
        return {"IdolSslConfigServiceImpl": ssl, "IdolLicenseServiceImpl": lic}

    async def create_idol_nifi2_sample_flow(
        self,
        name: str = "KD 26.3.0-nifi2 GetFileSystem to PutIDOL",
        source_path: str = "/idol-ingest",
        idol_host: str | None = None,
        idol_port: str | None = None,
    ) -> dict:
        """IDOL 26.3 / NiFi 2 sample: both required controller services + GetFileSystem → PutIDOL."""
        idol_host = idol_host or os.environ.get("IDOL_HOST", "idol-content")
        idol_port = idol_port or os.environ.get("IDOL_ACI_PORT", os.environ.get("IDOL_PORT", "9000"))
        root = await self._req("GET", "/flow/process-groups/root")
        flow = root.get("processGroupFlow") or root
        root_id = _entity_id(flow) or _entity_id(root)
        if not root_id:
            raise NiFiRestError("Root process group id missing")
        try:
            group = await self._req(
                "POST",
                f"/process-groups/{root_id}/process-groups",
                json=self._payload({"name": name, "position": {"x": 400.0, "y": 400.0}}, await self._revision()),
            )
            group_id = _entity_id(group)
        except NiFiRestError as exc:
            if "403" not in str(exc):
                raise
            group_id = root_id
            name = name + " (on root)"
        if not group_id:
            raise NiFiRestError("Could not determine process group id")

        services = await self.ensure_idol_controller_services(group_id)
        lic_id = services["IdolLicenseServiceImpl"]["id"]
        ssl_id = services["IdolSslConfigServiceImpl"]["id"]

        get_type = await self._resolve_type("proc", "GetFileSystem", "idol.nifi.connector.GetFileSystem")
        put_type = await self._resolve_type("proc", "PutIDOL", "idol.nifi.processor.PutIDOL")

        get_ent = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {"type": get_type, "name": "GetFileSystem", "position": {"x": 0.0, "y": 0.0}},
                await self._revision(),
            ),
        )
        get_id = _entity_id(get_ent)
        await self._req(
            "PUT",
            f"/processors/{get_id}",
            json=self._payload(
                {
                    "id": get_id,
                    "config": {
                        "properties": {
                            "IdolLicenseService": lic_id,
                            "IDOL License Service": lic_id,
                            "DirectoryPathCSVs": source_path,
                            "Directory Recursive": "true",
                            "DirectoryRecursive": "true",
                        }
                    },
                },
                get_ent.get("revision") or await self._revision(),
            ),
        )

        put_ent = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {"type": put_type, "name": "PutIDOL", "position": {"x": 0.0, "y": 250.0}},
                await self._revision(),
            ),
        )
        put_id = _entity_id(put_ent)
        await self._req(
            "PUT",
            f"/processors/{put_id}",
            json=self._payload(
                {
                    "id": put_id,
                    "config": {
                        "properties": {
                            "IdolLicenseService": lic_id,
                            "IDOL License Service": lic_id,
                            "SSLConfigService": ssl_id,
                            "SSL Config Service": ssl_id,
                            "Host": idol_host,
                            "IDOL Host": idol_host,
                            "Port": idol_port,
                            "IDOL ACI Port": idol_port,
                        }
                    },
                },
                put_ent.get("revision") or await self._revision(),
            ),
        )

        await self._req(
            "POST",
            f"/process-groups/{group_id}/connections",
            json=self._payload(
                {
                    "source": {"id": get_id, "groupId": group_id, "type": "PROCESSOR"},
                    "destination": {"id": put_id, "groupId": group_id, "type": "PROCESSOR"},
                    "selectedRelationships": ["success"],
                },
                await self._revision(),
            ),
        )
        return {
            "name": name,
            "pattern": "idol-nifi2-26.3",
            "nifiIngest": "26.3.0-nifi2",
            "groupId": group_id,
            "rootId": root_id,
            "baseUrl": self.base,
            "controllerServices": services,
            "processors": {"GetFileSystem": get_id, "PutIDOL": put_id},
            "idol": {"host": idol_host, "aciPort": idol_port, "sourcePath": source_path},
            "nifiUi": "Open the NiFi canvas for process group: " + name,
        }

    async def create_ai_python_sample_flow(
        self,
        name: str = "AI test with Python",
        script_file: str | None = None,
    ) -> dict:
        """26.3.0-nifi2: GenerateDocumentFlowFile → ExecuteDocumentPython + both IDOL CS."""
        script_file = script_file or os.environ.get(
            "IDOL_PYTHON_SCRIPT", "/python/ai/add_two_fields.py"
        )
        root = await self._req("GET", "/flow/process-groups/root")
        flow = root.get("processGroupFlow") or root
        root_id = _entity_id(flow) or _entity_id(root)
        if not root_id:
            raise NiFiRestError("Root process group id missing")
        try:
            group = await self._req(
                "POST",
                f"/process-groups/{root_id}/process-groups",
                json=self._payload(
                    {"name": name, "position": {"x": 856.0, "y": -224.0}},
                    await self._revision(),
                ),
            )
            group_id = _entity_id(group)
        except NiFiRestError as exc:
            if "403" not in str(exc):
                raise
            group_id = root_id
            name = name + " (on root)"
        if not group_id:
            raise NiFiRestError("Could not determine process group id")

        services = await self.ensure_idol_controller_services(group_id)
        lic_id = services["IdolLicenseServiceImpl"]["id"]

        gen_type = await self._resolve_type(
            "proc", "GenerateDocumentFlowFile", "idol.nifi.processor.GenerateDocumentFlowFile"
        )
        py_type = await self._resolve_type(
            "proc", "ExecuteDocumentPython", "idol.nifi.processor.ExecuteDocumentPython"
        )

        gen = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": gen_type,
                    "name": "GenerateDocumentFlowFile",
                    "position": {"x": -408.0, "y": -128.0},
                    "config": {
                        "schedulingPeriod": "999999999 sec",
                        "schedulingStrategy": "TIMER_DRIVEN",
                        "bulletinLevel": "WARN",
                        "properties": {"OutputRelationships": "success"},
                        "annotationData": (
                            '<annotation><document target="success">'
                            '<attribute name="idol.reference" value="Ref 1"/></document></annotation>'
                        ),
                    },
                },
                await self._revision(),
            ),
        )
        gen_id = _entity_id(gen)

        exe = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": py_type,
                    "name": "ExecuteDocumentPython",
                    "position": {"x": -408.0, "y": 48.0},
                    "config": {
                        "bulletinLevel": "ERROR",
                        "properties": {
                            "PythonScriptFunction": "handler",
                            "RouteTo": "success",
                            "PythonScriptFile": script_file,
                            "IdolLicenseService": lic_id,
                        },
                    },
                },
                await self._revision(),
            ),
        )
        exe_id = _entity_id(exe)

        fun_ok = await self._req(
            "POST",
            f"/process-groups/{group_id}/funnels",
            json=self._payload({"position": {"x": -768.0, "y": 88.0}}, await self._revision()),
        )
        fun_fail = await self._req(
            "POST",
            f"/process-groups/{group_id}/funnels",
            json=self._payload({"position": {"x": -256.0, "y": 232.0}}, await self._revision()),
        )
        ok_id = _entity_id(fun_ok)
        fail_id = _entity_id(fun_fail)

        async def _wire(src: str, dst: str, rel: str, dst_type: str) -> None:
            await self._req(
                "POST",
                f"/process-groups/{group_id}/connections",
                json=self._payload(
                    {
                        "source": {"id": src, "groupId": group_id, "type": "PROCESSOR"},
                        "destination": {"id": dst, "groupId": group_id, "type": dst_type},
                        "selectedRelationships": [rel],
                    },
                    await self._revision(),
                ),
            )

        await _wire(gen_id, exe_id, "success", "PROCESSOR")
        await _wire(exe_id, ok_id, "success", "FUNNEL")
        await _wire(exe_id, fail_id, "failure", "FUNNEL")

        return {
            "name": name,
            "pattern": "idol-ai-python",
            "nifiIngest": "26.3.0-nifi2",
            "groupId": group_id,
            "rootId": root_id,
            "baseUrl": self.base,
            "scriptFile": script_file,
            "controllerServices": services,
            "processors": {
                "GenerateDocumentFlowFile": gen_id,
                "ExecuteDocumentPython": exe_id,
            },
            "funnels": {"success": ok_id, "failure": fail_id},
            "nifiUi": "Open the NiFi canvas for process group: " + name,
        }


    async def create_http_source_idol_flow(
        self,
        name: str,
        pattern: str,
        source_name: str,
        source_url: str | None,
        idol_host: str | None = None,
        idol_port: str | None = None,
        kd_source: str = "http",
        metadata_only: bool = False,
    ) -> dict:
        """SAP / Documentum / enrichment: optional HTTP source → KD metadata → IDOL index."""
        import os as _os

        idol_host = idol_host or _os.environ.get("IDOL_HOST", "idol-content")
        idol_port = idol_port or _os.environ.get("IDOL_PORT", "9100")
        root = await self._req("GET", "/flow/process-groups/root")
        flow = root.get("processGroupFlow") or root
        root_id = _entity_id(flow) or _entity_id(root)
        if not root_id:
            raise NiFiRestError("Root process group id missing")
        try:
            group = await self._req(
                "POST",
                f"/process-groups/{root_id}/process-groups",
                json=self._payload({"name": name, "position": {"x": 0.0, "y": 600.0}}, await self._revision()),
            )
            group_id = _entity_id(group)
        except NiFiRestError as exc:
            if "403" not in str(exc):
                raise
            group_id = root_id
            name = name + " (on root)"
        if not group_id:
            raise NiFiRestError("Could not determine process group id")

        processors: dict[str, str] = {}
        previous = None
        y = 0.0
        if not metadata_only:
            if not source_url:
                raise NiFiRestError("source_url is required for HTTP KD ingest")
            fetch = await self._req(
                "POST",
                f"/process-groups/{group_id}/processors",
                json=self._payload(
                    {
                        "type": "org.apache.nifi.processors.standard.InvokeHTTP",
                        "name": source_name,
                        "position": {"x": 0.0, "y": y},
                    },
                    await self._revision(),
                ),
            )
            fetch_id = _entity_id(fetch)
            await self._req(
                "PUT",
                f"/processors/{fetch_id}",
                json=self._payload(
                    {
                        "id": fetch_id,
                        "config": {"properties": {"HTTP Method": "GET", "Remote URL": source_url}},
                    },
                    fetch.get("revision") or await self._revision(),
                ),
            )
            processors[source_name] = fetch_id
            previous = fetch_id
            y += 200.0

        meta = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": "org.apache.nifi.processors.attributes.UpdateAttribute",
                    "name": "Map KD / IDOL metadata",
                    "position": {"x": 0.0, "y": y},
                },
                await self._revision(),
            ),
        )
        meta_id = _entity_id(meta)
        await self._req(
            "PUT",
            f"/processors/{meta_id}",
            json=self._payload(
                {
                    "id": meta_id,
                    "config": {
                        "properties": {
                            "kd.source": kd_source,
                            "kd.index": "documents",
                            "idol.host": idol_host,
                            "idol.port": idol_port,
                        }
                    },
                },
                meta.get("revision") or await self._revision(),
            ),
        )
        processors["Map KD / IDOL metadata"] = meta_id
        if previous:
            await self._req(
                "POST",
                f"/process-groups/{group_id}/connections",
                json=self._payload(
                    {
                        "source": {"id": previous, "groupId": group_id, "type": "PROCESSOR"},
                        "destination": {"id": meta_id, "groupId": group_id, "type": "PROCESSOR"},
                        "selectedRelationships": ["success"],
                    },
                    await self._revision(),
                ),
            )
        y += 200.0
        send = await self._req(
            "POST",
            f"/process-groups/{group_id}/processors",
            json=self._payload(
                {
                    "type": "org.apache.nifi.processors.standard.InvokeHTTP",
                    "name": "Send to IDOL Content",
                    "position": {"x": 0.0, "y": y},
                },
                await self._revision(),
            ),
        )
        send_id = _entity_id(send)
        await self._req(
            "PUT",
            f"/processors/{send_id}",
            json=self._payload(
                {
                    "id": send_id,
                    "config": {
                        "properties": {
                            "HTTP Method": "POST",
                            "Remote URL": f"http://{idol_host}:{idol_port}/action=index",
                            "Content-Type": "application/octet-stream",
                        }
                    },
                },
                send.get("revision") or await self._revision(),
            ),
        )
        processors["Send to IDOL Content"] = send_id
        await self._req(
            "POST",
            f"/process-groups/{group_id}/connections",
            json=self._payload(
                {
                    "source": {"id": meta_id, "groupId": group_id, "type": "PROCESSOR"},
                    "destination": {"id": send_id, "groupId": group_id, "type": "PROCESSOR"},
                    "selectedRelationships": ["success"],
                },
                await self._revision(),
            ),
        )
        return {
            "name": name,
            "pattern": pattern,
            "groupId": group_id,
            "rootId": root_id,
            "baseUrl": self.base,
            "idol": {
                "host": idol_host,
                "port": idol_port,
                "indexUrl": f"http://{idol_host}:{idol_port}/action=index",
            },
            "sourceUrl": source_url,
            "processors": processors,
            "nifiUi": "Open the NiFi canvas for process group: " + name,
        }
