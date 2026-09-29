"""
tools/processors.py

Low-level MCP tools for discovering and configuring individual NiFi
processors. These map roughly 1:1 onto NiFi REST API calls and are the
building blocks the higher-level KD flow tools (opentext_kd.py) compose.
"""

from __future__ import annotations

from nifi_client import NiFiClient


def register(mcp, client: NiFiClient) -> None:
    @mcp.tool()
    async def get_nifi_environment() -> dict:
        """Return basic info about the connected NiFi instance (root group id, status)."""
        root_id = await client.get_root_process_group_id()
        status = await client.get_process_group_status(root_id)
        return {"rootProcessGroupId": root_id, "status": status}

    @mcp.tool()
    async def list_process_groups(group_id: str) -> list[dict]:
        """List child process groups under the given group id."""
        return await client.list_process_groups(group_id)

    @mcp.tool()
    async def list_available_processors(name_filter: str | None = None) -> list[dict]:
        """List processor types available in this NiFi instance, optionally filtered by
        a case-insensitive substring match on the type name (e.g. 'GetFile', 'InvokeHTTP')."""
        types = await client.list_processor_types()
        if name_filter:
            name_filter = name_filter.lower()
            types = [t for t in types if name_filter in t["type"].lower()]
        return types

    @mcp.tool()
    async def get_processor_definition(processor_type: str) -> dict:
        """Get full metadata (properties, relationships, description) for one processor type."""
        types = await client.list_processor_types()
        matches = [t for t in types if t["type"] == processor_type or t["type"].endswith(f".{processor_type}")]
        if not matches:
            raise ValueError(f"No processor type matching '{processor_type}' found")
        return matches[0]

    @mcp.tool()
    async def create_processor(group_id: str, processor_type: str, name: str) -> dict:
        """Create a new processor of the given type inside a process group."""
        return await client.create_processor(group_id, processor_type, name)

    @mcp.tool()
    async def configure_processor(processor_id: str, properties: dict[str, str]) -> dict:
        """Set/update one or more properties on an existing processor."""
        return await client.update_processor_properties(processor_id, properties)

    @mcp.tool()
    async def connect_processors(
        group_id: str,
        source_id: str,
        destination_id: str,
        relationships: list[str],
        source_type: str = "PROCESSOR",
        destination_type: str = "PROCESSOR",
    ) -> dict:
        """Create a connection between two processors for the given relationship names
        (e.g. ['success'], ['failure', 'retry'])."""
        return await client.create_connection(
            group_id, source_id, source_type, destination_id, destination_type, relationships
        )

    @mcp.tool()
    async def start_processor(processor_id: str) -> dict:
        """Start (run) a single processor."""
        return await client.set_processor_state(processor_id, "RUNNING")

    @mcp.tool()
    async def stop_processor(processor_id: str) -> dict:
        """Stop a single processor."""
        return await client.set_processor_state(processor_id, "STOPPED")
