"""
flow_generator.py

Ties the whole pipeline together end to end:

  user prompt
    -> parse_llm_response()        (prompt_parser.py)
    -> validate_intent()           (flow_validator.py, spec-level)
    -> build_tool_call()           (this file)
    -> [preview shown to user, wait for approval]
    -> call MCP tool to create the flow in NiFi
    -> validate_in_nifi()          (flow_validator.py, NiFi-level)
    -> [second preview + approval]
    -> start_flow

This module is transport-agnostic: `mcp_session` is expected to expose
an async `call_tool(name: str, arguments: dict) -> dict` method, matching
the shape of an MCP client session (stdio or HTTP) connected to
mcp-server/server.py.
"""

from __future__ import annotations

from dataclasses import dataclass

from flow_validator import FlowValidationError, validate_in_nifi, validate_intent
from kd_templates import get_template
from prompt_parser import ParsedIntent


@dataclass
class FlowPlan:
    intent: ParsedIntent
    tool_name: str
    tool_args: dict
    preview: str


def build_tool_call(intent: ParsedIntent, parent_group_id: str) -> FlowPlan:
    """Validate the intent and translate it into a concrete MCP tool call."""
    validate_intent(intent)
    template = get_template(intent.pattern)

    if template.runtime == "unimplemented" or not template.mcp_tool:
        raise FlowValidationError(
            f"Pattern '{intent.pattern}' is not wired to a live official MCP tool. "
            f"runtime={template.runtime!r} nifi_rest={template.nifi_rest!r} "
            f"recipe={template.official_recipe or []}"
        )

    # Official start_new_flow schema is flow_name + parent_pg_id (not parent_group_id).
    if template.mcp_tool == "start_new_flow":
        tool_args = {
            "flow_name": intent.flow_name,
            "parent_pg_id": parent_group_id,
            **template.optional_config,
            **intent.config,
        }
        tool_args.pop("parent_group_id", None)
    else:
        tool_args = {
            "parent_group_id": parent_group_id,
            "flow_name": intent.flow_name,
            **template.optional_config,
            **intent.config,
        }

    preview_lines = [
        f"Flow: {intent.flow_name}",
        f"Pattern: {intent.pattern} — {template.description}",
        "Configuration:",
    ] + [f"  {k}: {v}" for k, v in tool_args.items() if k not in ("parent_group_id", "flow_name")]

    return FlowPlan(intent=intent, tool_name=template.mcp_tool, tool_args=tool_args, preview="\n".join(preview_lines))


async def generate_and_deploy(
    mcp_session,
    intent: ParsedIntent,
    parent_group_id: str,
    approve_creation,
    approve_start,
) -> dict:
    """Full pipeline. `approve_creation` and `approve_start` are async
    callables that take the preview/status text and return True/False —
    wire these to your chat UI's confirm buttons.

    Returns a dict describing the final state of the flow.
    """
    plan = build_tool_call(intent, parent_group_id)

    if not await approve_creation(plan.preview):
        return {"status": "cancelled", "stage": "preview"}

    creation_result = await mcp_session.call_tool(plan.tool_name, plan.tool_args)
    group_id = creation_result["groupId"]

    try:
        validation_result = await validate_in_nifi(mcp_session, group_id)
    except FlowValidationError as e:
        return {"status": "invalid", "groupId": group_id, "error": str(e)}

    status_text = f"Flow '{intent.flow_name}' created and validated. {creation_result.get('summary', '')}"
    if not await approve_start(status_text):
        return {"status": "created_not_started", "groupId": group_id, "validation": validation_result}

    await mcp_session.call_tool("start_flow", {"group_id": group_id})
    return {"status": "running", "groupId": group_id, "validation": validation_result}
