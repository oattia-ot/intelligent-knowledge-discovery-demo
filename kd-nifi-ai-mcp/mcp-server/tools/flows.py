"""
tools/flows.py

MCP tools for process-group level flow management: creating groups,
parameter contexts, and starting/stopping/exporting/deleting a flow
as a whole.
"""

from __future__ import annotations

import json

from nifi_client import NiFiClient


def register(mcp, client: NiFiClient) -> None:
    @mcp.tool()
    async def create_process_group(parent_group_id: str, name: str) -> dict:
        """Create a new process group (a named container for a flow) under a parent group."""
        return await client.create_process_group(parent_group_id, name)

    @mcp.tool()
    async def create_parameter_context(name: str, parameters: dict[str, str]) -> dict:
        """Create a NiFi parameter context (e.g. host names, ports, index names,
        credentials) that can be assigned to a process group and referenced by
        processors as #{PARAM_NAME}."""
        return await client.create_parameter_context(name, parameters)

    @mcp.tool()
    async def assign_parameter_context(group_id: str, context_id: str) -> dict:
        """Attach a previously created parameter context to a process group."""
        return await client.assign_parameter_context(group_id, context_id)

    @mcp.tool()
    async def validate_flow(group_id: str) -> dict:
        """Check that every processor in the group is in a VALID state. Returns
        {"valid": bool, "invalidProcessors": [...]} — call this before start_flow."""
        return await client.validate_flow(group_id)

    @mcp.tool()
    async def start_flow(group_id: str) -> dict:
        """Start every component in a process group."""
        return await client.start_flow(group_id)

    @mcp.tool()
    async def stop_flow(group_id: str) -> dict:
        """Stop every component in a process group."""
        return await client.stop_flow(group_id)

    @mcp.tool()
    async def get_nifi_status(group_id: str) -> dict:
        """Get running/stopped/invalid component counts for a process group."""
        return await client.get_process_group_status(group_id)

    @mcp.tool()
    async def export_flow_json(group_id: str) -> str:
        """Export the current status of a process group as a JSON string, useful
        for showing the user a preview or for version control."""
        status = await client.get_process_group_status(group_id)
        return json.dumps(status, indent=2)

    @mcp.tool()
    async def delete_flow(group_id: str) -> dict:
        """Delete a process group and everything inside it. Irreversible — the AI
        orchestrator must get explicit user confirmation before calling this."""
        return await client.delete_process_group(group_id)
