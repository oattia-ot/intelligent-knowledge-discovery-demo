"""
flow_validator.py

Client-side (pre-NiFi) validation of a ParsedIntent + KDTemplate pairing,
plus a thin wrapper for calling the MCP server's own `validate_flow`
tool once the flow has been created in NiFi. This is the "Validate
Against NiFi" step in the recommended workflow, split into its two
halves: spec-level and NiFi-level.
"""

from __future__ import annotations

from kd_templates import missing_config_keys
from prompt_parser import ParsedIntent


class FlowValidationError(Exception):
    pass


def validate_intent(intent: ParsedIntent) -> None:
    """Raise FlowValidationError if the parsed intent is not ready to be
    turned into a flow (missing required config, unresolved questions)."""
    if intent.unresolved_questions:
        raise FlowValidationError(
            "Cannot build flow — need answers first: " + "; ".join(intent.unresolved_questions)
        )
    missing = missing_config_keys(intent.pattern, intent.config)
    if missing:
        raise FlowValidationError(
            f"Missing required configuration for pattern '{intent.pattern}': {missing}"
        )


async def validate_in_nifi(mcp_session, group_id: str) -> dict:
    """Call the MCP server's validate_flow tool against a live NiFi group.
    mcp_session is any object exposing an async `call_tool(name, args)`
    method (e.g. the MCP client session in flow_generator.py)."""
    result = await mcp_session.call_tool("validate_flow", {"group_id": group_id})
    if not result.get("valid", False):
        raise FlowValidationError(f"NiFi validation failed: {result.get('invalidProcessors')}")
    return result
