"""On-disk NAR registry. Profiles are data, not code."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import NarConfig
from .errors import CompatibilityError
from .versions import Version, parse_version


@dataclass
class NarArtifact:
    filename: str
    nar_version: str
    group_id: str
    artifact_id: str
    sha256: str | None
    processors: list[str]
    controller_services: list[str]
    dependencies: list[str]
    java_compatibility: str | None
    required: bool
    availability: str
    source: str | None
    install_requirements: list[str]
    path: Path | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "narVersion": self.nar_version,
            "groupId": self.group_id,
            "artifactId": self.artifact_id,
            "sha256": self.sha256,
            "processors": list(self.processors),
            "controllerServices": list(self.controller_services),
            "dependencies": list(self.dependencies),
            "javaCompatibility": self.java_compatibility,
            "required": self.required,
            "availability": self.availability,
            "source": self.source,
            "installRequirements": list(self.install_requirements),
            "path": str(self.path) if self.path else None,
            "present": bool(self.path and self.path.is_file()),
        }


@dataclass
class CompatibilityProfile:
    id: str
    idol_version: Version
    nifi_product_version: Version
    nar_version: str
    apache_nifi_versions: list[str]
    supported_idol_versions: list[str]
    supported_nifi_versions: list[str]
    artifacts: list[NarArtifact]
    processors: list[str]
    controller_services: list[str]
    dependencies: list[str]
    java_compatibility: str | None
    docker_image: str | None
    notes: str
    raw: dict[str, Any] = field(default_factory=dict)

    def artifact_filenames(self) -> list[str]:
        return [a.filename for a in self.artifacts]

    def processor_index(self) -> set[str]:
        names = {p.lower() for p in self.processors}
        for art in self.artifacts:
            names.update(p.lower() for p in art.processors)
            names.update(s.lower() for s in art.controller_services)
        names.update(s.lower() for s in self.controller_services)
        return names

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "idolVersion": str(self.idol_version.major_minor),
            "nifiVersion": str(self.nifi_product_version.major_minor),
            "narVersion": self.nar_version,
            "apacheNifiVersions": list(self.apache_nifi_versions),
            "supportedIdolVersions": list(self.supported_idol_versions),
            "supportedNifiVersions": list(self.supported_nifi_versions),
            "artifacts": [a.as_dict() for a in self.artifacts],
            "processors": list(self.processors),
            "controllerServices": list(self.controller_services),
            "dependencies": list(self.dependencies),
            "javaCompatibility": self.java_compatibility,
            "dockerImage": self.docker_image,
            "notes": self.notes,
        }


class NarRegistry:
    def __init__(self, config: NarConfig | None = None, *, nars_root: Path | None = None):
        self.config = config or NarConfig.from_env(nars_root)
        self.root = Path(nars_root or self.config.nars_root)
        self.matrix_path = self.root / "compatibility-matrix.json"
        self._profiles: dict[str, CompatibilityProfile] = {}
        self.reload()

    def reload(self) -> None:
        self._profiles = {}
        if self.matrix_path.is_file():
            matrix = json.loads(self.matrix_path.read_text(encoding="utf-8"))
            for raw in matrix.get("profiles") or []:
                profile = self._load_profile(raw)
                self._profiles[profile.id] = profile
        if not self._profiles:
            for manifest in sorted(self.root.glob("*/manifest.json")):
                raw = json.loads(manifest.read_text(encoding="utf-8"))
                profile = self._hydrate(raw, manifest.parent)
                self._profiles[profile.id] = profile

    def profiles(self) -> list[CompatibilityProfile]:
        return [self._profiles[k] for k in sorted(self._profiles)]

    def get(self, profile_id: str) -> CompatibilityProfile:
        if profile_id not in self._profiles:
            raise CompatibilityError(
                f"Unknown NAR compatibility profile '{profile_id}'.",
                available=sorted(self._profiles),
            )
        return self._profiles[profile_id]

    def available_versions(self) -> dict[str, list[str]]:
        return {
            "profiles": [p.id for p in self.profiles()],
            "idolVersions": sorted({p.idol_version.major_minor for p in self.profiles()}),
            "nifiVersions": sorted({p.nifi_product_version.major_minor for p in self.profiles()}),
            "narVersions": sorted({p.nar_version for p in self.profiles()}),
            "apacheNifiVersions": sorted({v for p in self.profiles() for v in p.apache_nifi_versions}),
        }

    def _load_profile(self, raw: dict[str, Any]) -> CompatibilityProfile:
        folder = raw.get("directory") or raw.get("idolVersion") or raw.get("id")
        profile_dir = self.root / str(folder)
        manifest_file = profile_dir / "manifest.json"
        if manifest_file.is_file():
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            merged = {**raw, **manifest}
            merged.setdefault("id", raw.get("id") or manifest.get("id"))
            return self._hydrate(merged, profile_dir)
        return self._hydrate(raw, profile_dir if profile_dir.is_dir() else self.root)

    def _hydrate(self, raw: dict[str, Any], folder: Path) -> CompatibilityProfile:
        idol = parse_version(str(raw.get("idolVersion")), field="idolVersion")
        nifi = parse_version(str(raw.get("nifiVersion") or raw.get("nifiProductVersion") or raw["idolVersion"]), field="nifiVersion")
        artifacts: list[NarArtifact] = []
        for item in raw.get("artifacts") or []:
            filename = item["filename"]
            path = folder / filename
            present = path.is_file()
            declared_hash = item.get("sha256") or None
            if present:
                digest = _sha256(path)
                if declared_hash and declared_hash != digest:
                    availability = "hash-mismatch"
                else:
                    availability = "present"
                    declared_hash = digest
            else:
                availability = item.get("availability") or "catalogued-not-bundled"
            artifacts.append(
                NarArtifact(
                    filename=filename,
                    nar_version=item.get("narVersion") or raw.get("narVersion") or "",
                    group_id=item.get("groupId") or item.get("group") or "",
                    artifact_id=item.get("artifactId") or item.get("artifact") or "",
                    sha256=declared_hash,
                    processors=list(item.get("processors") or []),
                    controller_services=list(item.get("controllerServices") or []),
                    dependencies=list(item.get("dependencies") or []),
                    java_compatibility=item.get("javaCompatibility") or raw.get("javaCompatibility"),
                    required=bool(item.get("required", True)),
                    availability=availability,
                    source=item.get("source") or raw.get("source"),
                    install_requirements=list(item.get("installRequirements") or raw.get("installRequirements") or []),
                    path=path if present else None,
                )
            )
        profile_id = raw.get("id") or f"idol-{idol.major_minor}-nifi-{nifi.major_minor}"
        processors = list(raw.get("processors") or [])
        services = list(raw.get("controllerServices") or [])
        if not processors:
            for art in artifacts:
                processors.extend(art.processors)
        if not services:
            for art in artifacts:
                services.extend(art.controller_services)
        return CompatibilityProfile(
            id=profile_id,
            idol_version=idol,
            nifi_product_version=nifi,
            nar_version=str(raw.get("narVersion") or ""),
            apache_nifi_versions=[str(v) for v in raw.get("apacheNifiVersions") or []],
            supported_idol_versions=[str(v) for v in raw.get("supportedIdolVersions") or [idol.major_minor]],
            supported_nifi_versions=[str(v) for v in raw.get("supportedNifiVersions") or [nifi.major_minor]],
            artifacts=artifacts,
            processors=_unique(processors),
            controller_services=_unique(services),
            dependencies=list(raw.get("dependencies") or []),
            java_compatibility=raw.get("javaCompatibility"),
            docker_image=raw.get("dockerImage"),
            notes=raw.get("notes") or "",
            raw=raw,
        )


def _unique(items: list[str]) -> list[str]:
    seen: list[str] = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()
