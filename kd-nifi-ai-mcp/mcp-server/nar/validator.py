"""Validate generated IDOL flows against the resolved NAR profile."""

from __future__ import annotations

from typing import Any

from .flows import get_reference_flow
from .registry import CompatibilityProfile
from .resolver import Resolution


IDOL_TYPE_HINTS = (
    "idol.nifi.",
    "putidol",
    "getfilesystem",
    "executedocumentpython",
    "generatedocumentflowfile",
    "keyview",
    "eduction",
    "idolssl",
    "idollicense",
)


def is_idol_component(type_name: str) -> bool:
    lowered = (type_name or "").lower()
    return any(hint in lowered for hint in IDOL_TYPE_HINTS)


def validate_generated_flow(
    flow: dict[str, Any],
    resolution: Resolution,
    *,
    installed_types: list[str] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    if resolution.status != "PASS":
        errors.append(resolution.reason or "NAR resolution did not pass")

    profile = resolution.profile
    processors = flow.get("processors") or []
    services = flow.get("controllerServices") or []

    if profile:
        missing = _unmapped(processors + services, profile)
        if missing:
            errors.append(f"IDOL components not provided by profile {profile.id}: {missing}")

    if installed_types is not None:
        catalog = {t.lower() for t in installed_types}
        for item in processors + services:
            typ = str(item.get("type") or "")
            if is_idol_component(typ) and typ.lower() not in catalog and typ.rsplit(".", 1)[-1].lower() not in {
                c.rsplit(".", 1)[-1] for c in catalog
            }:
                errors.append(f"Component '{typ}' is not installed on the target NiFi")

    names = {p.get("name") for p in processors}
    for conn in flow.get("relationships") or flow.get("connections") or []:
        if conn.get("from") not in names or conn.get("to") not in names:
            errors.append(f"Relationship references unknown processor: {conn}")

    for key in ("IDOL_PASSWORD", "password", "Password"):
        example = flow.get("exampleConfiguration") or {}
        if key in example and example[key]:
            errors.append("Example configuration must not embed IDOL passwords")

    if flow.get("supportedVersions", {}).get("nar") and resolution.nar_version:
        if flow["supportedVersions"]["nar"] != resolution.nar_version:
            errors.append("Flow NAR version does not match the resolved NAR profile")

    return {
        "valid": not errors,
        "status": "PASS" if not errors else "FAIL",
        "errors": errors,
        "warnings": warnings,
        "idolVersion": resolution.idol_version,
        "nifiVersion": resolution.nifi_version,
        "narProfile": profile.id if profile else None,
    }


def validate_request(resolution: Resolution, flow_id: str | None) -> dict[str, Any]:
    errors: list[str] = []
    if resolution.status != "PASS":
        errors.append(resolution.reason or "incompatible NAR profile")
    try:
        get_reference_flow(flow_id)
    except KeyError as exc:
        errors.append(str(exc))
    return {"valid": not errors, "errors": errors, "resolution": resolution.as_dict()}


def _unmapped(components: list[dict[str, Any]], profile: CompatibilityProfile) -> list[str]:
    index = profile.processor_index()
    missing: list[str] = []
    for item in components:
        typ = str(item.get("type") or "")
        if not is_idol_component(typ):
            continue
        short = typ.rsplit(".", 1)[-1].lower()
        if typ.lower() not in index and short not in index:
            missing.append(typ)
    return missing
