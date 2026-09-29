"""
nifi_client.py

Thin async wrapper around the Apache NiFi REST API.
Handles authentication (token or basic), session reuse, and the small
set of endpoints the MCP tools need: process groups, processors,
connections, parameter contexts, and flow status/validation.

Docs: https://nifi.apache.org/docs/nifi-docs/rest-api/index.html
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential


class NiFiClientError(RuntimeError):
    """Raised when the NiFi REST API returns an error response."""


class NiFiClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        verify_ssl: bool = True,
    ) -> None:
        self.base_url = (base_url or os.environ.get("NIFI_BASE_URL", "https://localhost:8443/nifi-api")).rstrip("/")
        self.username = username or os.environ.get("NIFI_USERNAME")
        self.password = password or os.environ.get("NIFI_PASSWORD")
        self.verify_ssl = verify_ssl
        self._token: Optional[str] = None
        self._client = httpx.AsyncClient(base_url=self.base_url, verify=self.verify_ssl, timeout=30.0)

    def connection_info(self) -> dict[str, Any]:
        """Non-secret snapshot of the current NiFi target."""
        return {
            "baseUrl": self.base_url,
            "username": self.username,
            "verifySsl": self.verify_ssl,
            "hasPassword": bool(self.password),
        }

    async def reconfigure(
        self,
        base_url: str,
        username: Optional[str] = None,
        password: Optional[str] = None,
        verify_ssl: bool = False,
    ) -> dict[str, Any]:
        """Point this client at a different (already-running) NiFi instance."""
        await self.close()
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.verify_ssl = verify_ssl
        self._token = None
        self._client = httpx.AsyncClient(base_url=self.base_url, verify=self.verify_ssl, timeout=30.0)
        return self.connection_info()

    async def ping(self) -> dict[str, Any]:
        """Cheap connectivity check against the configured NiFi API."""
        root_id = await self.get_root_process_group_id()
        return {"ok": True, "baseUrl": self.base_url, "rootProcessGroupId": root_id}

    async def close(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------ #
    # Auth
    # ------------------------------------------------------------------ #
    async def _authenticate(self) -> None:
        if not self.username or not self.password:
            return  # anonymous / single-user setups without auth
        resp = await self._client.post(
            "/access/token",
            data={"username": self.username, "password": self.password},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code != 200:
            raise NiFiClientError(f"Authentication failed: {resp.status_code} {resp.text}")
        self._token = resp.text.strip()

    async def _headers(self) -> dict[str, str]:
        if self.username and self._token is None:
            await self._authenticate()
        return {"Authorization": f"Bearer {self._token}"} if self._token else {}

    # ------------------------------------------------------------------ #
    # Core request helper
    # ------------------------------------------------------------------ #
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, max=4))
    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        headers.update(await self._headers())
        resp = await self._client.request(method, path, headers=headers, **kwargs)
        if resp.status_code >= 400:
            raise NiFiClientError(f"{method} {path} -> {resp.status_code}: {resp.text}")
        if resp.content:
            return resp.json()
        return None

    # ------------------------------------------------------------------ #
    # Process groups
    # ------------------------------------------------------------------ #
    async def get_root_process_group_id(self) -> str:
        data = await self._request("GET", "/flow/process-groups/root")
        return data["processGroupFlow"]["id"]

    async def list_process_groups(self, group_id: str) -> list[dict]:
        data = await self._request("GET", f"/flow/process-groups/{group_id}")
        return data["processGroupFlow"]["flow"]["processGroups"]

    async def create_process_group(self, parent_group_id: str, name: str, position: Optional[dict] = None) -> dict:
        body = {
            "revision": {"version": 0},
            "component": {
                "name": name,
                "position": position or {"x": 0, "y": 0},
            },
        }
        return await self._request("POST", f"/process-groups/{parent_group_id}/process-groups", json=body)

    # ------------------------------------------------------------------ #
    # Processors
    # ------------------------------------------------------------------ #
    async def list_processor_types(self) -> list[dict]:
        data = await self._request("GET", "/flow/processor-types")
        return data["processorTypes"]

    async def create_processor(
        self, group_id: str, processor_type: str, name: str, position: Optional[dict] = None
    ) -> dict:
        body = {
            "revision": {"version": 0},
            "component": {
                "type": processor_type,
                "name": name,
                "position": position or {"x": 0, "y": 0},
            },
        }
        return await self._request("POST", f"/process-groups/{group_id}/processors", json=body)

    async def get_processor(self, processor_id: str) -> dict:
        return await self._request("GET", f"/processors/{processor_id}")

    async def update_processor_properties(self, processor_id: str, properties: dict[str, str]) -> dict:
        current = await self.get_processor(processor_id)
        body = {
            "revision": current["revision"],
            "component": {
                "id": processor_id,
                "config": {"properties": properties},
            },
        }
        return await self._request("PUT", f"/processors/{processor_id}", json=body)

    async def set_processor_state(self, processor_id: str, state: str) -> dict:
        """state: RUNNING | STOPPED | DISABLED"""
        current = await self.get_processor(processor_id)
        body = {"revision": current["revision"], "state": state}
        return await self._request("PUT", f"/processors/{processor_id}/run-status", json=body)

    # ------------------------------------------------------------------ #
    # Connections
    # ------------------------------------------------------------------ #
    async def create_connection(
        self,
        group_id: str,
        source_id: str,
        source_type: str,
        destination_id: str,
        destination_type: str,
        relationships: list[str],
    ) -> dict:
        body = {
            "revision": {"version": 0},
            "component": {
                "source": {"id": source_id, "groupId": group_id, "type": source_type},
                "destination": {"id": destination_id, "groupId": group_id, "type": destination_type},
                "selectedRelationships": relationships,
            },
        }
        return await self._request("POST", f"/process-groups/{group_id}/connections", json=body)

    # ------------------------------------------------------------------ #
    # Parameter contexts
    # ------------------------------------------------------------------ #
    async def create_parameter_context(self, name: str, parameters: dict[str, str]) -> dict:
        body = {
            "revision": {"version": 0},
            "component": {
                "name": name,
                "parameters": [
                    {"parameter": {"name": k, "value": v, "sensitive": False}} for k, v in parameters.items()
                ],
            },
        }
        return await self._request("POST", "/parameter-contexts", json=body)

    async def assign_parameter_context(self, group_id: str, context_id: str) -> dict:
        current = await self._request("GET", f"/process-groups/{group_id}")
        body = {
            "revision": current["revision"],
            "component": {
                "id": group_id,
                "parameterContext": {"id": context_id},
            },
        }
        return await self._request("PUT", f"/process-groups/{group_id}", json=body)

    # ------------------------------------------------------------------ #
    # Validation / status / lifecycle
    # ------------------------------------------------------------------ #
    async def get_process_group_status(self, group_id: str) -> dict:
        return await self._request("GET", f"/flow/process-groups/{group_id}/status")

    async def validate_flow(self, group_id: str) -> dict:
        flow = await self._request("GET", f"/flow/process-groups/{group_id}")
        processors = flow["processGroupFlow"]["flow"]["processors"]
        invalid = [
            {"id": p["id"], "name": p["component"]["name"], "validationErrors": p["component"].get("validationErrors", [])}
            for p in processors
            if p["component"].get("validationStatus") != "VALID"
        ]
        return {"valid": len(invalid) == 0, "invalidProcessors": invalid}

    async def start_flow(self, group_id: str) -> dict:
        body = {"id": group_id, "state": "RUNNING"}
        return await self._request("PUT", f"/flow/process-groups/{group_id}", json=body)

    async def stop_flow(self, group_id: str) -> dict:
        body = {"id": group_id, "state": "STOPPED"}
        return await self._request("PUT", f"/flow/process-groups/{group_id}", json=body)

    async def delete_process_group(self, group_id: str) -> dict:
        current = await self._request("GET", f"/process-groups/{group_id}")
        version = current["revision"]["version"]
        return await self._request(
            "DELETE", f"/process-groups/{group_id}", params={"version": version}
        )
