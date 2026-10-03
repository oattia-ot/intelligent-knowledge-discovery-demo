"""HTTP ACI client for Knowledge Discovery components."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urlencode

import httpx

from .config import ComponentEndpoint, KdConfig
from .errors import AciClientError, ComponentError, ParameterError
from .versions import resolve_version


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def xml_to_obj(node: ET.Element) -> Any:
    children = list(node)
    text = (node.text or "").strip()
    if not children:
        return text
    grouped: dict[str, Any] = {}
    for child in children:
        key = _strip_ns(child.tag)
        value = xml_to_obj(child)
        if key in grouped:
            existing = grouped[key]
            if not isinstance(existing, list):
                grouped[key] = [existing, value]
            else:
                existing.append(value)
        else:
            grouped[key] = value
    if text:
        grouped["#text"] = text
    if node.attrib:
        grouped["@attr"] = dict(node.attrib)
    return grouped


class AciClient:
    def __init__(self, config: KdConfig | None = None, transport: httpx.BaseTransport | None = None):
        self.config = config or KdConfig.from_env()
        self._transport = transport

    def _client(self, endpoint: ComponentEndpoint) -> httpx.Client:
        return httpx.Client(
            timeout=endpoint.timeout_seconds,
            verify=endpoint.verify_tls,
            transport=self._transport,
        )

    def endpoint(self, component: str) -> ComponentEndpoint:
        try:
            return self.config.require(component)
        except Exception as exc:
            raise ComponentError(str(exc)) from exc

    def request(
        self,
        component: str,
        action: str,
        params: dict[str, Any] | None = None,
        *,
        method: str = "GET",
        port_role: str = "aci",
        body: str | bytes | None = None,
        response_format: str = "json",
    ) -> dict[str, Any]:
        endpoint = self.endpoint(component)
        params = {k: v for k, v in (params or {}).items() if v is not None}
        if response_format and "ResponseFormat" not in params:
            params["ResponseFormat"] = response_format
        if endpoint.aci_security and "SecurityInfo" not in params:
            params["SecurityInfo"] = endpoint.aci_security
        if port_role == "index":
            base = endpoint.index_base
            if not base:
                raise AciClientError(f"{component} has no index port configured")
        elif port_role == "service":
            base = endpoint.service_base
            if not base:
                raise AciClientError(f"{component} has no service port configured")
        else:
            base = endpoint.aci_base
        query = {"action": action, **{k: _stringify(v) for k, v in params.items()}}
        # ACI accepts either /action=Foo or /?action=Foo. Use query-string form.
        url = base.rstrip("/") + "/"
        headers: dict[str, str] = {}
        if endpoint.username and endpoint.password:
            headers["Authorization"] = "Basic " + _basic(endpoint.username, endpoint.password)
        try:
            with self._client(endpoint) as client:
                if method.upper() == "POST":
                    if body is not None:
                        resp = client.post(
                            url,
                            params=query,
                            content=body if isinstance(body, (bytes, bytearray)) else str(body).encode("utf-8"),
                            headers={**headers, "Content-Type": "application/octet-stream"},
                        )
                    else:
                        resp = client.post(
                            url,
                            content=urlencode(query).encode("utf-8"),
                            headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                        )
                else:
                    resp = client.get(url, params=query, headers=headers)
        except httpx.HTTPError as exc:
            raise AciClientError(f"{component} {action} connection failed: {exc}") from exc
        payload = _parse_response(resp)
        return {
            "ok": resp.status_code < 400 and not _aci_error(payload),
            "statusCode": resp.status_code,
            "component": component,
            "action": action,
            "portRole": port_role,
            "url": str(resp.request.url).split("?")[0],
            "response": payload,
        }

    def health(self, component: str) -> dict[str, Any]:
        result = self.request(component, "GetStatus", response_format="xml")
        result["versionProbe"] = None
        try:
            result["versionProbe"] = self.request(component, "GetVersion", response_format="xml")
        except AciClientError as exc:
            result["versionProbeError"] = str(exc)
        return result


def _stringify(value: Any) -> str:
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (list, tuple)):
        return ",".join(_stringify(v) for v in value)
    return str(value)


def _basic(user: str, password: str) -> str:
    import base64

    token = f"{user}:{password}".encode("utf-8")
    return base64.b64encode(token).decode("ascii")


def _parse_response(resp: httpx.Response) -> Any:
    text = resp.text or ""
    ctype = (resp.headers.get("content-type") or "").lower()
    if "json" in ctype:
        try:
            return resp.json()
        except Exception:
            return {"raw": text}
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            return resp.json()
        except Exception:
            pass
    if stripped.startswith("<"):
        try:
            root = ET.fromstring(stripped)
            return {_strip_ns(root.tag): xml_to_obj(root)}
        except ET.ParseError:
            return {"rawXml": text}
    return {"raw": text}


def _aci_error(payload: Any) -> bool:
    blob = str(payload).lower()
    return "<error>" in blob or "'error'" in blob or '"error"' in blob


def validate_params(required: list[str], params: dict[str, Any]) -> None:
    missing = [name for name in required if params.get(name) in (None, "")]
    if missing:
        raise ParameterError(f"Missing required parameters: {missing}")


def version_context(version: str | None) -> dict[str, Any]:
    return resolve_version(version).as_dict()
