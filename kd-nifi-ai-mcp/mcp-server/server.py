"""
DEPRECATED local FastAPI tool gateway.

Docker and ./start.sh do NOT run this file. The MCP container runs
mcp-server/entrypoint.py → official Cloudera `nifi_mcp_server.server`.

Kept only as a reference for older HTTP /tools/{name} callers.
"""

from __future__ import annotations

import inspect
import os
import sys
import traceback
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

HOST = os.environ.get("MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MCP_HTTP_PORT", os.environ.get("MCP_PORT", "8000")))

app = FastAPI(title="nifi-kd-mcp", version="0.3.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BOOT_ERROR: str | None = None
TOOL_CALLABLE: dict[str, Any] = {}
NIFI_INFO: dict[str, Any] = {}


def _load_tools() -> None:
    global BOOT_ERROR, NIFI_INFO
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass

    try:
        from nifi_client import NiFiClient
        from tools import flows, idol_nars, knowledge_discovery, opentext_kd, processors, validation
        from mcp.server.fastmcp import FastMCP
    except Exception:
        BOOT_ERROR = traceback.format_exc()
        print("TOOL LOAD FAILED:\n" + BOOT_ERROR, file=sys.stderr, flush=True)
        return

    nifi = NiFiClient(
        base_url=os.environ.get("NIFI_BASE_URL"),
        username=os.environ.get("NIFI_USERNAME"),
        password=os.environ.get("NIFI_PASSWORD"),
        verify_ssl=os.environ.get("NIFI_VERIFY_SSL", "true").lower() == "true",
    )
    NIFI_INFO = nifi.connection_info()
    mcp = FastMCP("nifi-kd-mcp", host=HOST, port=PORT)
    processors.register(mcp, nifi)
    flows.register(mcp, nifi)
    validation.register(mcp, nifi)
    opentext_kd.register(mcp, nifi)
    idol_nars.register(mcp, nifi)
    knowledge_discovery.register(mcp, nifi)

    @mcp.tool()
    async def get_nifi_connection() -> dict:
        return nifi.connection_info()

    @mcp.tool()
    async def configure_nifi(
        host: str,
        port: int,
        protocol: str = "https",
        api_path: str = "/nifi-api",
        username: str | None = None,
        password: str | None = None,
        verify_ssl: bool = False,
    ) -> dict:
        path = api_path if api_path.startswith("/") else f"/{api_path}"
        base_url = f"{protocol}://{host}:{int(port)}{path}"
        await nifi.reconfigure(
            base_url=base_url,
            username=username,
            password=password,
            verify_ssl=verify_ssl,
        )
        ping = await nifi.ping()
        NIFI_INFO.clear()
        NIFI_INFO.update(nifi.connection_info())
        return {**nifi.connection_info(), **ping}

    @mcp.tool()
    async def ping_nifi() -> dict:
        return await nifi.ping()

    manager = getattr(mcp, "_tool_manager", None)
    raw = getattr(manager, "_tools", {}) if manager is not None else {}
    for name, tool in raw.items():
        fn = getattr(tool, "fn", None) or getattr(tool, "handler", None) or getattr(tool, "func", None)
        if fn is not None:
            TOOL_CALLABLE[name] = fn
    print(f"loaded tools: {sorted(TOOL_CALLABLE)}", flush=True)


_load_tools()


@app.get("/")
@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "nifi-kd-mcp",
        "tools": sorted(TOOL_CALLABLE),
        "nifi": NIFI_INFO,
        "bootError": BOOT_ERROR,
    }


@app.get("/tools")
async def list_tools() -> dict:
    return {"tools": sorted(TOOL_CALLABLE)}


@app.post("/tools/{name}")
async def call_named_tool(name: str, payload: dict[str, Any] | None = None) -> Any:
    fn = TOOL_CALLABLE.get(name)
    if fn is None:
        raise HTTPException(404, f"Unknown tool '{name}'. Known: {sorted(TOOL_CALLABLE)}")
    try:
        result = fn(**(payload or {}))
        if inspect.isawaitable(result):
            result = await result
        return result
    except TypeError as e:
        raise HTTPException(400, f"Bad arguments for {name}: {e}") from e
    except Exception as e:
        raise HTTPException(502, f"{name} failed: {e}") from e


if __name__ == "__main__":
    import uvicorn

    print(f"nifi-kd-mcp HTTP gateway listening on {HOST}:{PORT}", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
