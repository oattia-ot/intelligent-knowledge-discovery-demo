"""Natural-language and structured version extraction. Never invent a version."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .errors import VersionParseError
from .versions import parse_version


_IDOL_VER = re.compile(
    r"\b(?:idol(?:\s+(?:content|find|nifi|ingest))?|knowledge\s+discovery|kd)\s*(?:version\s*)?[:=]?\s*"
    r"v?(?P<ver>\d{2}\.\d(?:\.\d+)?(?:[-.]nifi2)?)\b",
    re.IGNORECASE,
)
_NIFI_VER = re.compile(
    r"\b(?:apache\s+)?nifi\s*(?:version\s*)?[:=]?\s*v?(?P<ver>\d+(?:\.\d+){0,2}(?:[-.]nifi2)?)\b",
    re.IGNORECASE,
)
_BARE_PRODUCT = re.compile(
    r"\b(?:version|env(?:ironment)?|release|for|using|on)\s+v?(?P<ver>\d{2}\.\d(?:\.\d+)?(?:[-.]nifi2)?)\b",
    re.IGNORECASE,
)
_BARE_ONLY = re.compile(r"\b(?P<ver>\d{2}\.\d(?:\.\d+)?(?:[-.]nifi2)?)\b")
_PROCESSOR_HINTS = [
    ("PutIDOL", re.compile(r"\bputidol\b", re.I)),
    ("GetFileSystem", re.compile(r"\bgetfilesystem\b", re.I)),
    ("ExecuteDocumentPython", re.compile(r"\bexecutedocumentpython\b", re.I)),
    ("GenerateDocumentFlowFile", re.compile(r"\bgeneratedocumentflowfile\b", re.I)),
    ("QueryIDOL", re.compile(r"\bqueryidol\b", re.I)),
    ("KeyViewFilter", re.compile(r"\bkeyview\b", re.I)),
    ("Eduction", re.compile(r"\beduction\b", re.I)),
]


@dataclass
class VersionIntent:
    raw: str
    idol_version: str | None = None
    nifi_version: str | None = None
    nar_version: str | None = None
    flow_hint: str | None = None
    requested_processors: list[str] = field(default_factory=list)
    clarification_needed: bool = False
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "raw": self.raw,
            "idolVersion": self.idol_version,
            "nifiVersion": self.nifi_version,
            "narVersion": self.nar_version,
            "flowHint": self.flow_hint,
            "requestedProcessors": list(self.requested_processors),
            "clarificationNeeded": self.clarification_needed,
            "notes": list(self.notes),
        }


_FLOW_HINTS = [
    ("content-ingestion", re.compile(r"\b(content\s+ingestion|ingest(?:ion)?|hot\s*folder|file\s+share|watch(?:es)?\s+a?\s*director)", re.I)),
    ("content-indexing-metadata", re.compile(r"\b(metadata|mime|enrich(?:ment)?\s+before\s+index)", re.I)),
    ("document-processing", re.compile(r"\b(document\s+processing|normaliz|extract(?:ion)?\s+and\s+enrich)", re.I)),
    ("passage-extraction", re.compile(r"\bpassage\b", re.I)),
    ("query-integration", re.compile(r"\b(query|action=query)\b", re.I)),
    ("find-search", re.compile(r"\bfind\b", re.I)),
    ("aci-command", re.compile(r"\baci\b", re.I)),
    ("hot-folder", re.compile(r"\bhot\s*folder\b", re.I)),
    ("ai-llm-enrichment", re.compile(r"\b(llm|ollama|openai|ai\s+enrich|python)\b", re.I)),
    ("enterprise-ingestion", re.compile(r"\b(dead\s*letter|dlq|retry|enterprise|production)\b", re.I)),
]


def extract_version_intent(text: str) -> VersionIntent:
    raw = text or ""
    intent = VersionIntent(raw=raw)

    idol_match = _IDOL_VER.search(raw)
    nifi_match = _NIFI_VER.search(raw)
    if idol_match:
        intent.idol_version = _canonical(idol_match.group("ver"), "idolVersion")
    if nifi_match:
        intent.nifi_version = _canonical(nifi_match.group("ver"), "nifiVersion")

    if intent.idol_version is None and intent.nifi_version is None:
        product = _BARE_PRODUCT.search(raw) or _BARE_ONLY.search(raw)
        if product:
            ver = _canonical(product.group("ver"), "version")
            intent.idol_version = ver
            intent.notes.append(f"Treated bare version {ver} as an IDOL/NiFi product version, not Apache NiFi.")

    if intent.idol_version and intent.nifi_version is None and not _is_apache(intent.idol_version):
        intent.notes.append("NiFi product version not stated separately; resolver will require an exact compatibility profile.")

    for name, pattern in _PROCESSOR_HINTS:
        if pattern.search(raw):
            intent.requested_processors.append(name)

    for hint, pattern in _FLOW_HINTS:
        if pattern.search(raw):
            intent.flow_hint = hint
            break

    if not intent.idol_version and not intent.nifi_version:
        intent.clarification_needed = True
        intent.notes.append("No version found in the prompt.")
    return intent


def _canonical(raw: str, field: str) -> str:
    parsed = parse_version(raw, field=field)
    if parsed.qualifier:
        return str(parsed)
    if parsed.patch:
        return parsed.dotted
    return parsed.major_minor


def _is_apache(value: str) -> bool:
    try:
        parsed = parse_version(value, field="nifiVersion")
    except VersionParseError:
        return False
    return parsed.major < 20
