"""Facade used by MCP tools."""

from __future__ import annotations

from typing import Any

from .client import AciClient, validate_params
from .config import KdConfig
from .errors import CapabilityError, ConfirmationRequired, ParameterError
from .mapping import map_task
from .registry import get_registry
from .safety import classify, envelope, require_confirmation
from .versions import resolve_version, speech_model_note

DEFAULT_RESPONSE_FORMAT = "json"


class KnowledgeDiscoveryService:
    def __init__(self, client: AciClient | None = None, config: KdConfig | None = None):
        self.config = config or KdConfig.from_env()
        self.client = client or AciClient(self.config)
        self.registry = get_registry()

    def resolve_version(self, version: str | None = None) -> dict[str, Any]:
        return resolve_version(version).as_dict()

    def list_skills(self) -> dict[str, Any]:
        return {"version": "26.3", "skills": self.registry.skills()}

    def list_apis(self, version: str | None = "26.3") -> dict[str, Any]:
        return self.registry.for_version(version)

    def list_components(self) -> dict[str, Any]:
        return {
            "version": self.resolve_version(),
            "components": self.config.as_dict()["components"],
            "documentedComponents": sorted({c.component for c in self.registry.all()}),
        }

    def find_api(self, task: str, version: str | None = None) -> dict[str, Any]:
        return map_task(task, version)

    def describe_capability(self, capability_id: str) -> dict[str, Any]:
        return self.registry.get(capability_id).as_dict()

    def invoke(
        self,
        capability_id: str | None = None,
        *,
        component: str | None = None,
        action: str | None = None,
        params: dict[str, Any] | None = None,
        version: str | None = None,
        confirm: bool = False,
        body: str | bytes | None = None,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        cap = None
        if capability_id:
            cap = self.registry.get(capability_id)
            component = component or str(cap.component)
            action = action or str(cap.action)
        if not component or not action:
            raise ParameterError("component and action are required")
        if cap is None:
            cap = self.registry.by_action(component, action)
        resolved = resolve_version(version)
        if cap and not cap.available_in(resolved.train):
            raise CapabilityError(
                f"Capability '{cap.id}' is not listed for Knowledge Discovery {resolved.train}."
            )
        params = dict(params or {})
        if cap:
            validate_params(list(cap.required_parameters or []), params)
            allowed = set(cap.required_parameters or []) | set(cap.optional_parameters or [])
            unknown = [k for k in params if allowed and k not in allowed]
            # Keep unknown params but surface them — ACI servers ignore extras; we do not invent names.
            extra_warning = unknown
        else:
            extra_warning = []
        classification = classify(action, destructive_flag=bool(cap.destructive) if cap else None)
        if not dry_run:
            require_confirmation(action, confirm, destructive_flag=bool(cap.destructive) if cap else None)
        method = str(cap.http_method) if cap else "GET"
        port_role = str(cap.port_role) if cap else "aci"
        if port_role == "nifi":
            return envelope(
                classification,
                {
                    "ok": True,
                    "dryRun": True,
                    "note": "This capability is exposed through the NiFi NAR tools, not a direct ACI call.",
                    "capability": cap.as_dict() if cap else None,
                    "version": resolved.as_dict(),
                },
            )
        request_meta = {
            "capabilityId": cap.id if cap else None,
            "component": component,
            "action": action,
            "classification": classification,
            "version": resolved.as_dict(),
            "documentation": cap.documentation if cap else None,
            "unknownParameters": extra_warning,
        }
        if dry_run:
            return envelope(classification, {**request_meta, "ok": True, "dryRun": True, "params": params})
        result = self.client.request(
            component,
            action,
            params,
            method="POST" if method.upper() == "POST" or body is not None else "GET",
            port_role=port_role if port_role in {"aci", "index", "service"} else "aci",
            body=body,
            response_format=str(params.get("ResponseFormat") or DEFAULT_RESPONSE_FORMAT),
        )
        return envelope(classification, {**request_meta, **result})

    def speech_guard(self, version: str | None, model: str | None) -> dict[str, Any] | None:
        resolved = resolve_version(version)
        note = speech_model_note(resolved.train, model)
        if note and note.get("error"):
            raise CapabilityError(note["error"])
        return note
