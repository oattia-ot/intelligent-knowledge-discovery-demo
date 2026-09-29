"""Facade used by MCP tools and the orchestrator."""

from __future__ import annotations

from typing import Any

from .config import NarConfig
from .environment import diagnose
from .flows import list_reference_flows, materialize_flow
from .installer import NarInstaller
from .intent import extract_version_intent
from .registry import NarRegistry
from .resolver import NarResolver, Resolution
from .validator import validate_generated_flow, validate_request


class IdolNarService:
    def __init__(self, config: NarConfig | None = None, registry: NarRegistry | None = None):
        self.config = config or NarConfig.from_env()
        self.registry = registry or NarRegistry(self.config)
        self.resolver = NarResolver(self.registry, self.config)
        self.installer = NarInstaller(self.config)

    def list_versions(self) -> dict[str, Any]:
        return {
            "status": "PASS",
            "config": {
                "idolVersion": self.config.idol_version,
                "nifiVersion": self.config.nifi_version,
                "narVersion": self.config.nar_version,
                "narPath": str(self.config.nars_root),
                "deploymentMode": self.config.deployment_mode,
                "validationEnabled": self.config.validation_enabled,
            },
            **self.registry.available_versions(),
            "profiles": [p.as_dict() for p in self.registry.profiles()],
        }

    def manifest(self, profile_id: str | None = None, idol_version: str | None = None) -> dict[str, Any]:
        if profile_id:
            return self.registry.get(profile_id).as_dict()
        resolution = self.resolver.resolve(idol_version=idol_version)
        if not resolution.profile:
            return resolution.as_dict()
        return resolution.profile.as_dict()

    def resolve_nars(
        self,
        *,
        idol_version: str | None = None,
        nifi_version: str | None = None,
        requested_processors: list[str] | None = None,
        prompt: str | None = None,
        require_files: bool = False,
    ) -> dict[str, Any]:
        intent = extract_version_intent(prompt) if prompt else None
        resolution = self.resolver.resolve(
            idol_version=idol_version,
            nifi_version=nifi_version,
            requested_processors=requested_processors,
            require_files=require_files,
            intent=intent,
        )
        payload = resolution.as_dict()
        if intent:
            payload["intent"] = intent.as_dict()
        return payload

    def validate_compatibility(
        self,
        *,
        idol_version: str | None = None,
        nifi_version: str | None = None,
        nar_version: str | None = None,
        requested_processors: list[str] | None = None,
    ) -> dict[str, Any]:
        return self.resolver.resolve(
            idol_version=idol_version,
            nifi_version=nifi_version,
            nar_version=nar_version,
            requested_processors=requested_processors,
        ).as_dict()

    def generate_flow(
        self,
        *,
        prompt: str | None = None,
        flow_id: str | None = None,
        idol_version: str | None = None,
        nifi_version: str | None = None,
        requested_processors: list[str] | None = None,
        require_files: bool = False,
    ) -> dict[str, Any]:
        intent = extract_version_intent(prompt or "")
        hint = flow_id or intent.flow_hint or "content-ingestion"
        processors = requested_processors or intent.requested_processors
        resolution = self.resolver.resolve(
            idol_version=idol_version,
            nifi_version=nifi_version,
            requested_processors=processors,
            require_files=require_files,
            intent=intent,
        )
        pre = validate_request(resolution, hint)
        if not pre["valid"]:
            return self._blocked(resolution, hint, pre["errors"], intent.as_dict())
        flow = materialize_flow(hint, resolution)
        report = validate_generated_flow(flow, resolution)
        if not report["valid"]:
            return self._blocked(resolution, hint, report["errors"], intent.as_dict(), flow=flow)
        install = self.installer.plan(resolution)
        return {
            "status": "READY",
            "flow": "READY",
            "deployment": install["deployment"],
            "idolVersion": resolution.idol_version,
            "nifiVersion": resolution.nifi_version,
            "narProfile": resolution.profile.id if resolution.profile else None,
            "narVersion": resolution.nar_version,
            "narValidation": "PASS",
            "requiredNars": [a.filename for a in resolution.selected_nars],
            "processors": [p["name"] for p in flow["processors"]],
            "validation": report,
            "install": install,
            "intent": intent.as_dict(),
            "spec": flow,
            "referenceFlows": list_reference_flows(),
        }

    def validate_flow_spec(self, flow: dict[str, Any], **resolve_kwargs: Any) -> dict[str, Any]:
        resolution = self.resolver.resolve(**resolve_kwargs)
        return validate_generated_flow(flow, resolution)

    def install_nars(self, **resolve_kwargs: Any) -> dict[str, Any]:
        resolution = self.resolver.resolve(require_files=True, **resolve_kwargs)
        return self.installer.install(resolution)

    def diagnose_environment(
        self,
        *,
        idol_version: str | None = None,
        nifi_version: str | None = None,
        about: dict[str, Any] | None = None,
        processor_types: list[str] | None = None,
        controller_service_types: list[str] | None = None,
        java_version: str | None = None,
        installed_nars: list[str] | None = None,
    ) -> dict[str, Any]:
        resolution = self.resolver.resolve(idol_version=idol_version, nifi_version=nifi_version)
        return diagnose(
            resolution,
            config=self.config,
            about=about,
            processor_types=processor_types,
            controller_service_types=controller_service_types,
            java_version=java_version,
            installed_nars=installed_nars,
        )

    def _blocked(
        self,
        resolution: Resolution,
        flow_id: str,
        errors: list[str],
        intent: dict[str, Any],
        flow: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "status": "BLOCKED",
            "flow": "BLOCKED",
            "deployment": self.config.deployment_mode.upper(),
            "idolVersion": resolution.idol_version,
            "nifiVersion": resolution.nifi_version,
            "narProfile": resolution.profile.id if resolution.profile else None,
            "narVersion": resolution.nar_version,
            "narValidation": "FAIL",
            "requiredNars": resolution.missing_nars or [a.filename for a in resolution.selected_nars],
            "processors": [],
            "reason": "; ".join(errors) if errors else resolution.reason,
            "requiredAction": resolution.required_action,
            "available": resolution.available,
            "intent": intent,
            "flowId": flow_id,
            "spec": flow,
        }
