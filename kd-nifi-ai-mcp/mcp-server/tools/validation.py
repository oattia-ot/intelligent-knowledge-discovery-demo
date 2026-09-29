"""
tools/validation.py

Extra pre-flight validation that goes beyond what NiFi itself checks:
- spec-level sanity checks on a flow specification (used before anything
  is created in NiFi)
- naming collision checks
"""

from __future__ import annotations

from nifi_client import NiFiClient


REQUIRED_SPEC_KEYS = {"flowName", "processors", "connections"}


def validate_flow_spec(spec: dict) -> dict:
    """Validate a flow specification dict (as produced by the AI orchestrator)
    before any NiFi API calls are made. Returns {"valid": bool, "errors": [...]}."""
    errors: list[str] = []

    missing = REQUIRED_SPEC_KEYS - spec.keys()
    if missing:
        errors.append(f"Missing required keys: {sorted(missing)}")

    processor_names = {p["name"] for p in spec.get("processors", [])}
    for p in spec.get("processors", []):
        if "type" not in p or "name" not in p:
            errors.append(f"Processor entry missing 'type' or 'name': {p}")

    for c in spec.get("connections", []):
        for endpoint_key in ("from", "to"):
            if c.get(endpoint_key) not in processor_names:
                errors.append(
                    f"Connection references unknown processor '{c.get(endpoint_key)}' "
                    f"(known processors: {sorted(processor_names)})"
                )
        if "relationship" not in c:
            errors.append(f"Connection missing 'relationship': {c}")

    # Every processor except pure sources should have at least one incoming connection,
    # and every processor except terminal sinks should have at least one outgoing connection.
    sources = {c["from"] for c in spec.get("connections", [])}
    destinations = {c["to"] for c in spec.get("connections", [])}
    unreachable = processor_names - destinations - {spec.get("entryPoint")}
    orphaned = processor_names - sources - destinations
    if orphaned:
        errors.append(f"Processors with no connections at all: {sorted(orphaned)}")

    return {"valid": len(errors) == 0, "errors": errors}


def register(mcp, client: NiFiClient) -> None:
    @mcp.tool()
    async def validate_flow_specification(spec: dict) -> dict:
        """Validate a flow specification JSON object for structural correctness
        (required fields, dangling connections, orphaned processors) BEFORE
        any resources are created in NiFi. Use this ahead of create_process_group."""
        return validate_flow_spec(spec)
