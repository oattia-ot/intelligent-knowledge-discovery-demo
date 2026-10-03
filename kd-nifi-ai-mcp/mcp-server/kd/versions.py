"""Knowledge Discovery version resolver.

Distinguishes supported / deprecated / removed / unknown / unavailable
for product trains 26.1, 26.2, and 26.3 (and documented patch forms).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

from .errors import VersionError

_VERSION_RE = re.compile(
    r"""
    ^\s*v?
    (?P<major>\d+)
    \.(?P<minor>\d+)
    (?:\.(?P<patch>\d+))?
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

SUPPORTED_TRAINS = ("26.1", "26.2", "26.3")
TARGET_TRAIN = "26.3"
KNOWN_TRAINS = {
    "26.1": {"status": "supported", "notes": "Previous train; capabilities inherited unless 26.3 superseded them."},
    "26.2": {"status": "supported", "notes": "Previous train. Speech-to-text still distinguishes medium vs large models."},
    "26.3": {
        "status": "supported",
        "notes": (
            "Current target. Speech medium/large models combined; Suggest/TermGetBest "
            "gain UseVectors; Community OTDSUserField; new OCR languages."
        ),
    },
}

# Version-specific deltas that validation must honor.
VERSION_DELTAS: dict[str, list[dict[str, Any]]] = {
    "26.3": [
        {
            "id": "media.speech.medium_large_merged",
            "component": "MediaServer",
            "summary": "Speech-to-text Medium and Large model names resolve to a single combined model.",
            "deprecated_values": {"ModelSize": ["Medium"], "ModelVersion": ["medium"]},
            "replacement": "Use the combined speech model. Previous names still resolve but are no longer distinct sizes.",
            "documentation": "https://blogs.opentext.com/whats-new-in-opentext-knowledge-discovery-idol/",
        },
        {
            "id": "content.suggest.use_vectors",
            "component": "DAH",
            "summary": "Suggest supports UseVectors; TermGetBest on Content also supports UseVectors.",
            "introduced_parameters": ["UseVectors"],
            "documentation": "https://blogs.opentext.com/whats-new-in-opentext-knowledge-discovery-idol/",
        },
        {
            "id": "community.otds_user_field",
            "component": "Community",
            "summary": "Community OTDS integration accepts username/password via OTDSUserField.",
            "introduced_config": ["OTDSUserField", "AutoCreateUsers"],
            "documentation": "https://blogs.opentext.com/whats-new-in-opentext-knowledge-discovery-idol/",
        },
        {
            "id": "media.ocr.languages_26_3",
            "component": "MediaServer",
            "summary": "OCR adds Armenian, Azerbaijani, Georgian, Indonesian, Kazakh, Malay, Mongolian, Tajik, Uzbek.",
            "documentation": "https://blogs.opentext.com/whats-new-in-opentext-knowledge-discovery-idol/",
        },
        {
            "id": "eduction.pii.saudi_arabia",
            "component": "Eduction",
            "summary": "PII grammars added for Saudi Arabia; Oman/UAE improved; ITAR munitions dictionary.",
            "documentation": "https://blogs.opentext.com/whats-new-in-opentext-knowledge-discovery-idol/",
        },
    ],
    "26.2": [
        {
            "id": "media.stt.legacy_removed",
            "component": "MediaServer",
            "summary": "Legacy speech-to-text (ModelVersion=Legacy) was removed in 26.2.",
            "removed_values": {"ModelVersion": ["Legacy", "legacy"]},
            "documentation": "https://www.microfocus.com/documentation/idol/knowledge-discovery-26.2/IDOLReleaseNotes_26.2_Documentation/idol/Content/Servers/MediaServer.htm",
        },
        {
            "id": "media.image_description",
            "component": "MediaServer",
            "summary": "ImageDescription analysis engine (LLM image/video-frame descriptions) exists from 26.2.",
            "documentation": "https://www.microfocus.com/documentation/idol/knowledge-discovery-26.2/IDOLReleaseNotes_26.2_Documentation/idol/Content/Servers/MediaServer.htm",
        },
    ],
}


@dataclass(frozen=True, order=True)
class ProductVersion:
    major: int
    minor: int
    patch: int = 0

    @property
    def train(self) -> str:
        return f"{self.major}.{self.minor}"

    @property
    def dotted(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"

    def __str__(self) -> str:
        return self.dotted if self.patch else self.train


@dataclass
class VersionResolution:
    requested: str
    version: ProductVersion
    train: str
    status: str
    notes: str
    deltas: list[dict[str, Any]] = field(default_factory=list)
    target_is_26_3: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "requested": self.requested,
            "resolved": str(self.version),
            "train": self.train,
            "status": self.status,
            "notes": self.notes,
            "targetIs26_3": self.target_is_26_3,
            "deltas": list(self.deltas),
        }


def parse_product_version(raw: str | None, *, field: str = "version") -> ProductVersion:
    if raw is None or not str(raw).strip():
        raise VersionError(f"{field} is empty")
    match = _VERSION_RE.match(str(raw).strip())
    if not match:
        raise VersionError(
            f"Invalid {field} '{raw}'. Expected Knowledge Discovery forms like 26.3, 26.3.0, 26.2."
        )
    return ProductVersion(
        major=int(match.group("major")),
        minor=int(match.group("minor") or 0),
        patch=int(match.group("patch") or 0),
    )


def default_version() -> str:
    return os.environ.get("KD_VERSION") or os.environ.get("IDOL_VERSION") or TARGET_TRAIN


def resolve_version(raw: str | None = None) -> VersionResolution:
    text = (raw or default_version()).strip()
    version = parse_product_version(text)
    train = version.train
    meta = KNOWN_TRAINS.get(train)
    if meta is None:
        if version.major == 26 and version.minor > 3:
            status = "unknown"
            notes = f"{train} is newer than the documented target 26.3. Treat capabilities as unverified."
        elif version.major >= 23:
            status = "unsupported"
            notes = f"{train} is outside the 26.1–26.3 MCP compatibility window."
        else:
            status = "unknown"
            notes = f"{train} is not a documented Knowledge Discovery 26.x train in this registry."
        deltas: list[dict[str, Any]] = []
    else:
        status = meta["status"]
        notes = meta["notes"]
        deltas = list(VERSION_DELTAS.get(train, []))
    return VersionResolution(
        requested=text,
        version=version,
        train=train,
        status=status,
        notes=notes,
        deltas=deltas,
        target_is_26_3=train == TARGET_TRAIN,
    )


def capability_available(supported_versions: list[str], train: str) -> str:
    if train in supported_versions:
        return "supported"
    if any(sv.startswith("26.") for sv in supported_versions) and train.startswith("26."):
        return "unavailable"
    return "unavailable"


def speech_model_note(train: str, model: str | None) -> dict[str, Any] | None:
    if not model:
        return None
    value = model.strip().lower()
    if train == "26.3" and value in {"medium", "large"}:
        return {
            "warning": (
                "In Knowledge Discovery 26.3 the speech-to-text Medium and Large "
                "models are combined into a single model. The previous names still "
                "resolve but are no longer distinct size settings."
            ),
            "train": train,
            "requestedModel": model,
            "effectiveModel": "combined",
            "documentation": "https://blogs.opentext.com/whats-new-in-opentext-knowledge-discovery-idol/",
        }
    if train >= "26.2" and value == "legacy":
        return {
            "error": "Legacy speech-to-text (ModelVersion=Legacy) was removed in Media Server 26.2.",
            "train": train,
            "requestedModel": model,
            "documentation": "https://www.microfocus.com/documentation/idol/knowledge-discovery-26.2/IDOLReleaseNotes_26.2_Documentation/idol/Content/Servers/MediaServer.htm",
        }
    return None
