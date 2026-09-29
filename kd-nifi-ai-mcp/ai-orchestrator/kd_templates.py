"""
kd_templates.py

Registry of known Knowledge Discovery flow patterns, the MCP tool each
pattern maps to, and the required/optional config keys for that tool.
The flow_generator uses this to (a) validate that a ParsedIntent has
everything it needs and (b) build the kwargs for the MCP tool call.

Source of truth is templates/catalog.json (plus the spec file each
entry points at). This module is a thin adapter over template_catalog.
"""

from __future__ import annotations

from dataclasses import dataclass

from template_catalog import live_mcp_tool, load_catalog_entries, load_spec


@dataclass
class KDTemplate:
    pattern: str
    mcp_tool: str
    required_config: list[str]
    optional_config: dict[str, object]
    description: str
    file: str | None = None
    group: str = ""
    title: str = ""
    prompt: str = ""
    runtime: str = "unimplemented"
    nifi_rest: str | None = None
    official_recipe: list[str] | None = None


def _from_catalog() -> dict[str, KDTemplate]:
    registry: dict[str, KDTemplate] = {}
    for entry in load_catalog_entries():
        spec = load_spec(entry.get("file")) if entry.get("file") else None
        pattern = (spec or {}).get("pattern") or entry.get("id")
        if not pattern:
            continue
        item = KDTemplate(
            pattern=pattern,
            mcp_tool=live_mcp_tool(entry) or "",
            required_config=list(entry.get("required_config") or []),
            optional_config=dict(entry.get("optional_config") or {}),
            description=entry.get("description")
            or (spec or {}).get("description")
            or "",
            file=entry.get("file"),
            group=entry.get("group") or "",
            title=entry.get("title") or "",
            prompt=entry.get("prompt") or "",
            runtime=entry.get("runtime") or "unimplemented",
            nifi_rest=entry.get("nifi_rest"),
            official_recipe=list(entry.get("official_recipe") or []),
        )
        registry[pattern] = item
        # Catalog id may differ from spec.pattern; accept both lookups.
        if entry.get("id") and entry["id"] not in registry:
            registry[entry["id"]] = item
    return registry


TEMPLATES: dict[str, KDTemplate] = _from_catalog()


def get_template(pattern: str) -> KDTemplate:
    try:
        return TEMPLATES[pattern]
    except KeyError:
        known = ", ".join(sorted(set(TEMPLATES)))
        raise ValueError(f"No KD template for pattern '{pattern}'. Known patterns: {known}")


def missing_config_keys(pattern: str, config: dict) -> list[str]:
    template = get_template(pattern)
    return [k for k in template.required_config if k not in config]
