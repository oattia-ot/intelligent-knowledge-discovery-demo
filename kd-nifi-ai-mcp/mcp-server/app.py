"""
DEPRECATED local FastAPI tool gateway.

Not used by Docker. MCP is official Cloudera nifi-mcp-server via entrypoint.py.
"""

from __future__ import annotations

import inspect
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mcp.server.fastmcp import FastMCP

from nifi_client import NiFiClient
from tools import flows, idol_nars, knowledge_discovery, opentext_kd, processors, validation

load_dotenv()

HOST = os.environ.get("MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MCP_HTTP_PORT", os.environ.get("MCP_PORT", "8000")))

mcp = FastMCP("nifi-kd-mcp", host=HOST, port=PORT)

client = NiFiClient(
    base_url=os.environ.get("NIFI_BASE_URL"),
    username=os.environ.get("NIFI_USERNAME"),
    password=os.environ.get("NIFI_PASSWORD"),
    verify_ssl=os.environ.get("NIFI_VERIFY_SSL", "true").lower() == "true",
)

processors.register(mcp, client)
flows.register(mcp, client)
validation.register(mcp, client)
opentext_kd.register(mcp, client)
idol_nars.register(mcp, client)
knowledge_discovery.register(mcp, client)


@mcp.tool()
async def get_nifi_connection() -> dict:
    return client.connection_info()


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
    await client.reconfigure(
        base_url=base_url,
        username=username,
        password=password,
        verify_ssl=verify_ssl,
    )
    ping = await client.ping()
    return {**client.connection_info(), **ping}


@mcp.tool()
async def ping_nifi() -> dict:
    return await client.ping()


def _tool_map() -> dict[str, Any]:
    manager = getattr(mcp, "_tool_manager", None)
    tools = getattr(manager, "_tools", None) if manager is not None else None
    return tools or {}


async def invoke_tool(name: str, arguments: dict[str, Any] | None = None) -> Any:
    arguments = arguments or {}
    tools = _tool_map()
    tool = tools.get(name)
    if tool is None:
        raise HTTPException(404, f"Unknown tool '{name}'. Known: {sorted(tools)}")
    fn = getattr(tool, "fn", None) or getattr(tool, "handler", None) or getattr(tool, "func", None)
    if fn is None:
        raise HTTPException(500, f"Tool '{name}' has no callable")
    result = fn(**arguments)
    if inspect.isawaitable(result):
        result = await result
    return result


app = FastAPI(title="nifi-kd-mcp", version="0.3.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "nifi-kd-mcp",
        "tools": sorted(_tool_map()),
        "nifi": client.connection_info(),
    }


@app.get("/tools")
async def list_tools() -> dict:
    return {"tools": sorted(_tool_map())}


@app.post("/tools/{name}")
async def call_named_tool(name: str, payload: dict[str, Any] | None = None) -> Any:
    try:
        return await invoke_tool(name, payload)
    except HTTPException:
        raise
    except TypeError as e:
        raise HTTPException(400, f"Bad arguments for {name}: {e}") from e
    except Exception as e:
        raise HTTPException(502, f"{name} failed: {e}") from e


@app.get("/")
async def root() -> dict:
    return {"status": "ok", "health": "/health", "invoke": "POST /tools/{name}"}
