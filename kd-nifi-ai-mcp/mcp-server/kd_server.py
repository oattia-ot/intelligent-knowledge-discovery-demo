"""Standalone FastMCP server for Knowledge Discovery + existing NAR/NiFi tools.

Docker still defaults to official Cloudera nifi-mcp-server via entrypoint.py.
Use this process when you need the KD ACI tool catalog on SSE/stdio:

    python kd_server.py

Environment:
    MCP_TRANSPORT=sse|http|stdio
    MCP_HOST=0.0.0.0
    MCP_PORT=8000
    KD_HOST / IDOL_HOST
    KD_CONTENT_PORT / IDOL_PORT
    KD_VERIFY_TLS
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()

HOST = os.environ.get("MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MCP_PORT", os.environ.get("MCP_HTTP_PORT", "8000")))

mcp = FastMCP("knowledge-discovery-mcp", host=HOST, port=PORT)

try:
    from nifi_client import NiFiClient
    from tools import flows, idol_nars, knowledge_discovery, opentext_kd, processors, validation

    nifi = NiFiClient(
        base_url=os.environ.get("NIFI_BASE_URL"),
        username=os.environ.get("NIFI_USERNAME"),
        password=os.environ.get("NIFI_PASSWORD"),
        verify_ssl=os.environ.get("NIFI_VERIFY_SSL", "true").lower() == "true",
    )
    processors.register(mcp, nifi)
    flows.register(mcp, nifi)
    validation.register(mcp, nifi)
    opentext_kd.register(mcp, nifi)
    idol_nars.register(mcp, nifi)
    knowledge_discovery.register(mcp, nifi)
except Exception as exc:  # pragma: no cover - startup fallback
    print(f"NiFi tool registration skipped: {exc}")
    from tools import knowledge_discovery

    knowledge_discovery.register(mcp, None)


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    print(f"knowledge-discovery-mcp transport={transport} {HOST}:{PORT}", flush=True)
    if transport in {"sse", "http"}:
        mcp.run(transport=transport)
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
