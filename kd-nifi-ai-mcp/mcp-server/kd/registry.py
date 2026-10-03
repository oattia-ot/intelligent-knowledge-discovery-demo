"""Machine-readable capability registry."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .catalog import SKILLS, WORKFLOWS, build_capabilities
from .errors import CapabilityError
from .versions import resolve_version

DATA_DIR = Path(__file__).resolve().parent / "data"


@dataclass
class Capability:
    raw: dict[str, Any]

    def __getattr__(self, item: str) -> Any:
        return self.raw.get(item)

    @property
    def id(self) -> str:
        return str(self.raw["id"])

    def as_dict(self) -> dict[str, Any]:
        return dict(self.raw)

    def available_in(self, train: str) -> bool:
        versions = self.raw.get("supported_versions") or []
        return train in versions


class CapabilityRegistry:
    def __init__(self, capabilities: list[dict[str, Any]] | None = None):
        self._items = [Capability(c) for c in (capabilities or build_capabilities())]
        self._by_id = {c.id: c for c in self._items}

    def all(self) -> list[Capability]:
        return list(self._items)

    def get(self, capability_id: str) -> Capability:
        cap = self._by_id.get(capability_id)
        if cap is None:
            raise CapabilityError(f"Unknown capability '{capability_id}'")
        return cap

    def by_component(self, component: str) -> list[Capability]:
        name = component.lower()
        return [c for c in self._items if str(c.component).lower() == name]

    def by_action(self, component: str, action: str) -> Capability | None:
        for cap in self.by_component(component):
            if str(cap.action).lower() == action.lower():
                return cap
        return None

    def by_tool(self, tool: str) -> list[Capability]:
        return [c for c in self._items if c.mcp_tool == tool]

    def by_skill(self, skill: str) -> list[Capability]:
        return [c for c in self._items if c.mcp_skill == skill]

    def search(self, text: str) -> list[Capability]:
        needle = text.lower()
        scored: list[tuple[int, Capability]] = []
        for cap in self._items:
            blob = " ".join(
                str(cap.raw.get(k) or "")
                for k in ("id", "display_name", "category", "component", "action", "mcp_tool", "mcp_skill")
            ).lower()
            extra = " ".join(cap.raw.get("optional_parameters") or []).lower()
            hay = blob + " " + extra
            score = 0
            if needle == cap.id or needle == str(cap.action).lower():
                score += 10
            if needle in hay:
                score += 3
            for token in needle.split():
                if token in hay:
                    score += 1
            if score:
                scored.append((score, cap))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [c for _, c in scored]

    def for_version(self, version: str | None = None) -> dict[str, Any]:
        resolved = resolve_version(version)
        available = [c.as_dict() for c in self._items if c.available_in(resolved.train)]
        missing = [c.as_dict() for c in self._items if not c.available_in(resolved.train)]
        return {
            "version": resolved.as_dict(),
            "count": len(available),
            "unavailableCount": len(missing),
            "capabilities": available,
            "unavailable": missing,
        }

    def skills(self) -> list[dict[str, Any]]:
        return list(SKILLS)

    def workflows(self) -> list[dict[str, Any]]:
        return list(WORKFLOWS)

    def export_json(self) -> dict[str, Any]:
        return {
            "schemaVersion": "1.0",
            "product": "OpenText Knowledge Discovery",
            "targetVersion": "26.3",
            "documentationPortal": "https://www.microfocus.com/documentation/idol/knowledge-discovery-26.3",
            "capabilities": [c.as_dict() for c in self._items],
            "skills": SKILLS,
            "workflows": WORKFLOWS,
        }

    def write_json(self, path: Path | None = None) -> Path:
        target = path or (DATA_DIR / "capabilities.json")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.export_json(), indent=2), encoding="utf-8")
        return target

    def stats(self) -> dict[str, Any]:
        implemented = [c for c in self._items if c.implementation_status == "implemented"]
        components = sorted({str(c.component) for c in self._items})
        categories = sorted({str(c.category) for c in self._items})
        return {
            "total": len(self._items),
            "implemented": len(implemented),
            "partial": len([c for c in self._items if c.implementation_status == "partial"]),
            "documented_only": len([c for c in self._items if c.implementation_status == "documented"]),
            "components": components,
            "categories": categories,
            "skills": len(SKILLS),
            "workflows": len(WORKFLOWS),
        }


_REGISTRY: CapabilityRegistry | None = None


def get_registry() -> CapabilityRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = CapabilityRegistry()
    return _REGISTRY
