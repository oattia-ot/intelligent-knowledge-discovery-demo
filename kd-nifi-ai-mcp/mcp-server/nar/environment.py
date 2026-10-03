"""Diagnose a NiFi environment against a resolved NAR profile."""

from __future__ import annotations

from typing import Any, Callable, Awaitable

from .config import NarConfig
from .resolver import Resolution


Probe = Callable[[], Awaitable[dict[str, Any]]]


async def diagnose(
    resolution: Resolution,
    *,
    config: NarConfig | None = None,
    about: dict[str, Any] | None = None,
    processor_types: list[str] | None = None,
    controller_service_types: list[str] | None = None,
    java_version: str | None = None,
    installed_nars: list[str] | None = None,
) -> dict[str, Any]:
    cfg = config or NarConfig.from_env()
    problems: list[str] = []
    live_version = None
    if about:
        live_version = about.get("version") or (about.get("about") or {}).get("version")

    if resolution.profile and live_version:
        supported = set(resolution.profile.apache_nifi_versions) | {
            resolution.profile.nifi_product_version.major_minor,
            resolution.profile.nifi_product_version.dotted,
        }
        if str(live_version) not in supported and not any(str(live_version).startswith(s) for s in supported):
            problems.append(
                f"Live NiFi version {live_version} is not listed for profile {resolution.profile.id} "
                f"(supported Apache NiFi: {sorted(resolution.profile.apache_nifi_versions)})"
            )

    required = []
    if resolution.profile:
        required = list(resolution.profile.processors) + list(resolution.profile.controller_services)
    present_types = [*(processor_types or []), *(controller_service_types or [])]
    catalog = {t.lower() for t in present_types}
    missing_types = []
    for name in required:
        short = name.rsplit(".", 1)[-1].lower()
        if catalog and short not in {c.rsplit(".", 1)[-1] for c in catalog} and name.lower() not in catalog:
            missing_types.append(name)
    if missing_types:
        problems.append(f"Missing processors/services: {missing_types}")

    if installed_nars is not None and resolution.profile:
        have = {n.lower() for n in installed_nars}
        for artifact in resolution.profile.artifacts:
            if artifact.required and artifact.filename.lower() not in have:
                problems.append(f"Installed NAR list does not include {artifact.filename}")

    if resolution.profile and resolution.profile.java_compatibility and java_version:
        if not java_version.startswith(resolution.profile.java_compatibility.split(".")[0]):
            problems.append(
                f"Java {java_version} may not satisfy profile requirement {resolution.profile.java_compatibility}"
            )

    status = "PASS" if not problems and resolution.status == "PASS" else "FAIL"
    return {
        "status": status,
        "deployment": cfg.deployment_mode.upper(),
        "liveNifiVersion": live_version,
        "javaVersion": java_version,
        "resolvedProfile": resolution.profile.id if resolution.profile else None,
        "installedNars": installed_nars or [],
        "missingDependencies": missing_types,
        "processorAvailability": {
            "required": required,
            "missing": missing_types,
        },
        "compatibilityProblems": problems,
        "resolution": resolution.as_dict(),
    }
