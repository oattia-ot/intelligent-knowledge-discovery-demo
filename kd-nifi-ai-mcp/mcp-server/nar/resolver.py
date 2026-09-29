"""NAR resolution service. Owns version selection. Flow generators must call this."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .config import NarConfig
from .errors import CompatibilityError, NarResolutionError, VersionParseError
from .intent import VersionIntent
from .registry import CompatibilityProfile, NarArtifact, NarRegistry
from .versions import Version, looks_like_apache_nifi, parse_version


@dataclass
class Resolution:
    status: str  # PASS | BLOCKED
    profile: CompatibilityProfile | None
    idol_version: str | None
    nifi_version: str | None
    nar_version: str | None
    selected_nars: list[NarArtifact] = field(default_factory=list)
    missing_nars: list[str] = field(default_factory=list)
    unavailable_processors: list[str] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    reason: str | None = None
    required_action: str | None = None
    available: dict[str, list[str]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "idolVersion": self.idol_version,
            "nifiVersion": self.nifi_version,
            "narProfile": self.profile.id if self.profile else None,
            "narVersion": self.nar_version,
            "narValidation": self.status,
            "selectedNars": [a.as_dict() for a in self.selected_nars],
            "requiredNars": [a.filename for a in self.selected_nars] if self.selected_nars else self.missing_nars,
            "missingNars": list(self.missing_nars),
            "unavailableProcessors": list(self.unavailable_processors),
            "constraints": list(self.constraints),
            "reason": self.reason,
            "requiredAction": self.required_action,
            "available": self.available,
            "profile": self.profile.as_dict() if self.profile else None,
        }


class NarResolver:
    def __init__(self, registry: NarRegistry | None = None, config: NarConfig | None = None):
        self.config = config or NarConfig.from_env()
        self.registry = registry or NarRegistry(self.config)

    def resolve(
        self,
        *,
        idol_version: str | None = None,
        nifi_version: str | None = None,
        nar_version: str | None = None,
        requested_processors: list[str] | None = None,
        require_files: bool = False,
        intent: VersionIntent | None = None,
        allow_env_defaults: bool = True,
    ) -> Resolution:
        available = self.registry.available_versions()
        try:
            idol, nifi, nar = self._normalize(
                idol_version=idol_version or (intent.idol_version if intent else None),
                nifi_version=nifi_version or (intent.nifi_version if intent else None),
                nar_version=nar_version or (intent.nar_version if intent else None),
                allow_env_defaults=allow_env_defaults,
            )
        except VersionParseError as exc:
            return Resolution(
                status="BLOCKED",
                profile=None,
                idol_version=idol_version,
                nifi_version=nifi_version,
                nar_version=nar_version,
                reason=str(exc),
                required_action="Provide a valid version such as 26.2 or 26.3.",
                available=available,
            )

        if idol is None and nifi is None and nar is None:
            return Resolution(
                status="BLOCKED",
                profile=None,
                idol_version=None,
                nifi_version=None,
                nar_version=None,
                reason="No IDOL, NiFi, or NAR version was requested and none is configured.",
                required_action="Set IDOL_VERSION / NIFI_VERSION or include the version in the request.",
                available=available,
            )

        try:
            profile = self._select_profile(idol=idol, nifi=nifi, nar=nar)
        except CompatibilityError as exc:
            return Resolution(
                status="BLOCKED",
                profile=None,
                idol_version=idol.major_minor if idol else None,
                nifi_version=nifi.major_minor if nifi else None,
                nar_version=str(nar) if nar else None,
                reason=str(exc),
                required_action="Install/register a compatible NAR profile or request an available version.",
                available=available,
                constraints=list(exc.available),
            )

        processors = list(requested_processors or (intent.requested_processors if intent else []) or [])
        missing_types = self._missing_processors(profile, processors)
        missing_files = [
            a.filename
            for a in profile.artifacts
            if a.required and a.availability not in {"present"}
        ]
        hash_bad = [a.filename for a in profile.artifacts if a.availability == "hash-mismatch"]

        constraints = [
            f"IDOL {profile.idol_version.major_minor}",
            f"NiFi product {profile.nifi_product_version.major_minor}",
            f"NAR {profile.nar_version}",
        ]
        if profile.apache_nifi_versions:
            constraints.append("Apache NiFi " + ", ".join(profile.apache_nifi_versions))
        if profile.java_compatibility:
            constraints.append("Java " + profile.java_compatibility)

        blocked_reason = None
        action = None
        if hash_bad:
            blocked_reason = f"NAR checksum mismatch for: {hash_bad}"
            action = "Replace the NAR files so SHA-256 matches the profile manifest."
        elif missing_types:
            blocked_reason = (
                f"Requested processor(s) not published by profile {profile.id}: {missing_types}"
            )
            action = "Choose processors listed in the profile or register a NAR that provides them."
        elif require_files and missing_files:
            blocked_reason = f"Compatible profile {profile.id} is registered but NAR files are missing: {missing_files}"
            action = (
                f"Place the {profile.nar_version} NAR package in {self.registry.root / profile.idol_version.major_minor}/ "
                "and re-run resolution. Do not copy another version's NARs."
            )

        status = "BLOCKED" if blocked_reason else "PASS"
        return Resolution(
            status=status,
            profile=profile,
            idol_version=profile.idol_version.major_minor,
            nifi_version=profile.nifi_product_version.major_minor,
            nar_version=profile.nar_version,
            selected_nars=list(profile.artifacts) if status == "PASS" or not require_files else [],
            missing_nars=missing_files,
            unavailable_processors=missing_types,
            constraints=constraints,
            reason=blocked_reason,
            required_action=action,
            available=available,
        )

    def resolve_or_raise(self, **kwargs) -> Resolution:
        result = self.resolve(**kwargs)
        if result.status != "PASS":
            raise NarResolutionError(
                result.reason or "NAR resolution blocked",
                profile_id=result.profile.id if result.profile else None,
                missing=result.missing_nars,
            )
        return result

    def _normalize(
        self,
        *,
        idol_version: str | None,
        nifi_version: str | None,
        nar_version: str | None,
        allow_env_defaults: bool,
    ) -> tuple[Version | None, Version | None, Version | None]:
        if allow_env_defaults:
            idol_version = idol_version or self.config.idol_version
            nifi_version = nifi_version or self.config.nifi_version
            nar_version = nar_version or self.config.nar_version

        idol = parse_version(idol_version, field="idolVersion") if idol_version else None
        nifi_raw = parse_version(nifi_version, field="nifiVersion") if nifi_version else None
        nar = parse_version(nar_version, field="narVersion") if nar_version else None

        nifi_product: Version | None = nifi_raw
        if nifi_raw and looks_like_apache_nifi(nifi_raw):
            mapped = self._profile_for_apache_nifi(nifi_raw)
            nifi_product = mapped.nifi_product_version if mapped else nifi_raw
            if idol is None and mapped is not None:
                idol = mapped.idol_version
        if idol and nifi_product is None:
            nifi_product = idol
        if nifi_product and idol is None and not (nifi_raw and looks_like_apache_nifi(nifi_raw)):
            idol = nifi_product
        return idol, nifi_product, nar

    def _profile_for_apache_nifi(self, apache: Version) -> CompatibilityProfile | None:
        needle = {apache.major_minor, apache.dotted, str(apache)}
        for profile in self.registry.profiles():
            supported = set()
            for item in profile.apache_nifi_versions:
                try:
                    parsed = parse_version(item, field="apacheNifi")
                except VersionParseError:
                    continue
                supported.add(parsed.major_minor)
                supported.add(parsed.dotted)
            if needle & supported:
                return profile
        return None

    def _select_profile(
        self,
        *,
        idol: Version | None,
        nifi: Version | None,
        nar: Version | None,
    ) -> CompatibilityProfile:
        matches: list[CompatibilityProfile] = []
        for profile in self.registry.profiles():
            if idol and not profile.idol_version.matches(idol):
                continue
            if nifi and not profile.nifi_product_version.matches(nifi):
                continue
            if nar and not _nar_matches(profile.nar_version, nar):
                continue
            matches.append(profile)

        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            ids = [m.id for m in matches]
            raise CompatibilityError(
                "Multiple NAR profiles match the request; qualify idolVersion and nifiVersion. "
                f"Matches: {ids}",
                available=ids,
                requested={"idol": str(idol) if idol else None, "nifi": str(nifi) if nifi else None},
            )

        available = [p.id for p in self.registry.profiles()]
        requested = {
            "idolVersion": idol.major_minor if idol else None,
            "nifiVersion": nifi.major_minor if nifi else None,
            "narVersion": str(nar) if nar else None,
        }
        raise CompatibilityError(
            "No compatible IDOL NiFi NAR package is available for the requested environment "
            f"(IDOL={requested['idolVersion']}, NiFi={requested['nifiVersion']}, NAR={requested['narVersion']}). "
            f"Available profiles: {available}. No silent fallback to another major/minor version.",
            available=available,
            requested=requested,
        )

    def _missing_processors(self, profile: CompatibilityProfile, requested: list[str]) -> list[str]:
        if not requested:
            return []
        index = profile.processor_index()
        missing: list[str] = []
        for name in requested:
            key = name.lower().rsplit(".", 1)[-1]
            if name.lower() not in index and key not in index:
                missing.append(name)
        return missing


def _nar_matches(declared: str, requested: Version) -> bool:
    try:
        parsed = parse_version(declared, field="narVersion")
    except VersionParseError:
        return declared.startswith(requested.major_minor)
    return parsed.matches(requested)
