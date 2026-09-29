"""Controlled NAR distribution. Local may copy files; external never pushes NARs."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .config import NarConfig
from .resolver import Resolution


class NarInstaller:
    def __init__(self, config: NarConfig | None = None):
        self.config = config or NarConfig.from_env()

    def plan(self, resolution: Resolution) -> dict[str, Any]:
        mode = self.config.deployment_mode
        if resolution.status != "PASS" and resolution.missing_nars:
            return {
                "deployment": mode.upper(),
                "status": "BLOCKED",
                "reason": resolution.reason,
                "requiredAction": resolution.required_action,
                "artifacts": [a.as_dict() for a in (resolution.profile.artifacts if resolution.profile else [])],
            }
        artifacts = [a.as_dict() for a in resolution.selected_nars]
        if mode == "local":
            target = str(self.config.nifi_extensions_dir or "/opt/nifi/nifi-current/extensions")
            return {
                "deployment": "LOCAL",
                "status": "READY" if resolution.status == "PASS" else "BLOCKED",
                "installSupported": True,
                "targetDirectory": target,
                "artifacts": artifacts,
                "notes": [
                    "Install API NAR first (idol-nifi-framework-api-nar-*) and wait for NiFi to unpack it.",
                    "Do not mix 26.2 and 26.3 NAR files in the same extensions directory.",
                    "Restart or wait for NAR autoload after copy.",
                ],
            }
        return {
            "deployment": "EXTERNAL",
            "status": "READY" if resolution.status == "PASS" else "BLOCKED",
            "installSupported": False,
            "artifacts": artifacts,
            "notes": [
                "External NiFi is treated as an environment prerequisite.",
                "This server will not attempt remote NAR installation.",
                "Copy the listed artifacts into the remote NiFi extensions directory, API NAR first.",
            ],
        }

    def install(self, resolution: Resolution, *, target_dir: str | Path | None = None) -> dict[str, Any]:
        plan = self.plan(resolution)
        if self.config.deployment_mode != "local":
            plan["status"] = "BLOCKED"
            plan["reason"] = "NAR installation is not attempted against an external NiFi."
            plan["requiredAction"] = "Install the listed NAR artifacts on the remote instance, then re-validate."
            return plan
        if resolution.status != "PASS":
            return plan
        dest = Path(target_dir or self.config.nifi_extensions_dir or "/tmp/nifi-extensions")
        dest.mkdir(parents=True, exist_ok=True)
        copied: list[str] = []
        skipped: list[str] = []
        api_first = sorted(
            resolution.selected_nars,
            key=lambda a: (0 if "framework-api" in a.filename else 1, a.filename),
        )
        for artifact in api_first:
            if not artifact.path or not artifact.path.is_file():
                skipped.append(artifact.filename)
                continue
            target = dest / artifact.filename
            shutil.copy2(artifact.path, target)
            copied.append(str(target))
        plan["copied"] = copied
        plan["skipped"] = skipped
        plan["status"] = "INSTALLED" if copied and not skipped else ("PARTIAL" if copied else "BLOCKED")
        return plan
