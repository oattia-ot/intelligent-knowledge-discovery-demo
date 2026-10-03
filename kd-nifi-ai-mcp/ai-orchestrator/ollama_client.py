"""Ollama chat client. Probes compose service, then host gateway."""

from __future__ import annotations

import os
from typing import Any

import httpx


class OllamaError(RuntimeError):
    pass


def _host_port() -> str:
    return os.environ.get("OLLAMA_HOST_PORT", "11434").strip() or "11434"


def _bases() -> list[str]:
    raw = os.environ.get("OLLAMA_BASE_URL", "").strip()
    extras = os.environ.get("OLLAMA_BASE_URLS", "").strip()
    host_port = _host_port()
    seen: list[str] = []
    for item in [raw] + [p.strip() for p in extras.split(",") if p.strip()] + [
        "http://ollama:11434",
        f"http://host.docker.internal:{host_port}",
        f"http://172.17.0.1:{host_port}",
    ]:
        if not item:
            continue
        item = item.rstrip("/")
        if item not in seen:
            seen.append(item)
    return seen


class OllamaClient:
    def __init__(self) -> None:
        self.bases = _bases()
        self.base = self.bases[0]
        self.model = os.environ.get("OLLAMA_MODEL", "llama3.2")
        self._resolved: str | None = None

    async def _pick(self) -> str:
        if self._resolved:
            return self._resolved
        errors: list[str] = []
        async with httpx.AsyncClient(timeout=3.0) as client:
            for base in self.bases:
                try:
                    resp = await client.get(f"{base}/api/tags")
                    if resp.status_code < 400:
                        self._resolved = base
                        self.base = base
                        return base
                    errors.append(f"{base} -> HTTP {resp.status_code}")
                except Exception as e:
                    errors.append(f"{base} -> {e}")
        raise OllamaError(
            "Ollama is not reachable from the orchestrator container. "
            "Start `docker compose up -d ollama ollama-pull` or bind host Ollama with "
            f"`OLLAMA_HOST=0.0.0.0:{_host_port()} ollama serve`. Tried: " + "; ".join(errors)
        )

    async def _models(self, base: str) -> list[str]:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{base}/api/tags")
            resp.raise_for_status()
            return [m.get("name") or "" for m in resp.json().get("models", [])]

    def _model_ready(self, names: list[str]) -> bool:
        want = self.model
        short = want.split(":")[0]
        for name in names:
            if name == want or name.startswith(want + ":") or name.split(":")[0] == short:
                return True
        return False

    async def _ensure_model(self, base: str) -> None:
        names = await self._models(base)
        if self._model_ready(names):
            return
        async with httpx.AsyncClient(timeout=None) as client:
            resp = await client.post(
                f"{base}/api/pull",
                json={"name": self.model, "stream": False},
            )
        if resp.status_code >= 400:
            raise OllamaError(
                f"Model {self.model} is not installed and pull failed ({resp.status_code}): {resp.text[:300]}. "
                f"Installed: {names or '(none, download still running)'}. "
                f"Wait for kd-ollama-pull or run: docker exec kd-ollama ollama pull {self.model}"
            )
        names = await self._models(base)
        if not self._model_ready(names):
            raise OllamaError(
                f"Model {self.model} is still not available after pull. Installed: {names or '(none)'}."
            )

    async def health(self) -> dict:
        try:
            base = await self._pick()
            names = await self._models(base)
            return {
                "ok": True,
                "base": base,
                "model": self.model,
                "modelReady": self._model_ready(names),
                "models": names,
            }
        except Exception as e:
            return {"ok": False, "base": self.base, "model": self.model, "tried": self.bases, "error": str(e)}

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        base = await self._pick()
        await self._ensure_model(base)
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(f"{base}/api/chat", json=payload)
        except httpx.HTTPError as e:
            raise OllamaError(f"Cannot reach Ollama at {base}: {e}") from e
        if resp.status_code == 404:
            names = await self._models(base)
            raise OllamaError(
                f"Ollama returned 404 for /api/chat — model '{self.model}' is not ready. "
                f"Installed models: {names or '(none)'}. "
                "The first pull is still running (watch docker logs kd-ollama / kd-ollama-pull)."
            )
        if resp.status_code >= 400:
            raise OllamaError(f"Ollama {resp.status_code}: {resp.text[:400]}")
        return (resp.json() or {}).get("message") or {}
