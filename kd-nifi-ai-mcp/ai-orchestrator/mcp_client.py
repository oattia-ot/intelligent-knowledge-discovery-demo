"""MCP client for the official Cloudera NiFi MCP server."""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager

from mcp import ClientSession


def flatten_exc(exc: BaseException) -> str:
    parts: list[str] = [str(exc)]
    sub = getattr(exc, "exceptions", None)
    if sub:
        for child in sub:
            parts.append(flatten_exc(child))
    cause = getattr(exc, "__cause__", None) or getattr(exc, "__context__", None)
    if cause and cause is not exc:
        parts.append(flatten_exc(cause))
    # unique short message
    seen: list[str] = []
    for p in parts:
        p = " ".join(p.split())
        if p and p not in seen:
            seen.append(p)
    return " | ".join(seen[:6])


class MCPToolError(RuntimeError):
    pass


class MCPSession:
    def __init__(self, server_url: str | None = None) -> None:
        raw = server_url or os.environ.get("MCP_SERVER_URL", "http://localhost:8000/sse")
        self.server_url = raw.rstrip("/")

    def _candidates(self) -> list[tuple[str, str]]:
        base = self.server_url
        for suffix in ("/sse", "/mcp"):
            if base.endswith(suffix):
                base = base[: -len(suffix)]
        return [(base + "/sse", "sse"), (base + "/mcp", "streamable-http")]

    @asynccontextmanager
    async def _session(self):
        last_err: Exception | None = None
        for url, kind in self._candidates():
            try:
                if kind == "sse":
                    from mcp.client.sse import sse_client

                    async with sse_client(url) as (read, write):
                        async with ClientSession(read, write) as session:
                            await session.initialize()
                            yield session
                            return
                else:
                    from mcp.client.streamable_http import streamablehttp_client

                    async with streamablehttp_client(url) as (read, write, _):
                        async with ClientSession(read, write) as session:
                            await session.initialize()
                            yield session
                            return
            except Exception as e:
                last_err = e
                continue
        raise MCPToolError(
            "Cannot open official NiFi MCP session: " + flatten_exc(last_err or RuntimeError("no transport"))
        )

    async def list_tools(self) -> list[dict]:
        try:
            async with self._session() as session:
                result = await session.list_tools()
                return [
                    {
                        "name": t.name,
                        "description": t.description or "",
                        "inputSchema": getattr(t, "inputSchema", None),
                    }
                    for t in result.tools
                ]
        except Exception as e:
            raise MCPToolError(flatten_exc(e)) from e

    async def call_tool(self, name: str, arguments: dict) -> dict:
        try:
            async with self._session() as session:
                result = await session.call_tool(name, arguments or {})
                if getattr(result, "isError", False):
                    raise MCPToolError(f"Tool '{name}' failed: {result.content}")
                if getattr(result, "structuredContent", None) is not None:
                    data = result.structuredContent
                    return data if isinstance(data, dict) else {"result": data}
                texts = []
                for block in result.content or []:
                    if getattr(block, "type", None) == "text":
                        texts.append(block.text)
                if not texts:
                    return {}
                raw = texts[0]
                try:
                    parsed = json.loads(raw)
                    return parsed if isinstance(parsed, dict) else {"result": parsed}
                except json.JSONDecodeError:
                    return {"text": raw}
        except MCPToolError:
            raise
        except Exception as e:
            raise MCPToolError(flatten_exc(e)) from e

    async def health(self) -> dict:
        try:
            tools = await self.list_tools()
            return {"ok": True, "toolCount": len(tools)}
        except Exception as e:
            return {"ok": False, "error": flatten_exc(e)}
