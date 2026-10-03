"""Map a natural-language task to a KD capability / skill / tool."""

from __future__ import annotations

from typing import Any

from .registry import get_registry
from .versions import resolve_version

_HINTS: list[tuple[tuple[str, ...], str]] = [
    (("search", "query", "find documents", "natural language"), "content.query"),
    (("boolean", "fieldtext", "fielded"), "content.query"),
    (("parametric", "facet", "tag values"), "content.getquerytagvalues"),
    (("get content", "retrieve document", "document metadata"), "content.getcontent"),
    (("similar", "suggest", "related document"), "content.suggest"),
    (("suggest on text", "more like this text"), "content.suggestontext"),
    (("highlight",), "content.highlight"),
    (("summar",), "content.summarize"),
    (("best terms", "termgetbest", "vectors"), "content.termgetbest"),
    (("index document", "dreadd", "ingest idx"), "content.dreadddata"),
    (("delete document", "remove from index"), "content.dredeletedoc"),
    (("initialize index", "wipe index", "dreinitial"), "content.dreinitial"),
    (("sync", "flush index"), "content.dresync"),
    (("securityinfo", "document security", "acl"), "community.security"),
    (("community user", "otds"), "community.userread"),
    (("classif", "categoriz", "taxonomy"), "category.suggestfromtext"),
    (("entity", "eduction", "pii", "ner"), "eduction.educefromtext"),
    (("ocr", "optical character"), "media.ocr"),
    (("speech", "transcri", "stt"), "media.speech"),
    (("face",), "media.face_detect"),
    (("object recog", "object class"), "media.object"),
    (("number plate", "anpr", "license plate"), "media.numberplate"),
    (("image description", "describe image", "caption"), "media.image_description"),
    (("media process", "video analys", "audio analys"), "media.process"),
    (("connector", "synchronize", "cfs"), "cfs.synchronize"),
    (("keyview", "file content", "extract text", "c2pa"), "fce.keyview_filter"),
    (("nifi", "nar", "putidol", "getfilesystem"), "nifi.putidol"),
    (("qms", "query manipulation", "synonym rule"), "qms.query"),
    (("dah", "distributed search"), "dah.query"),
    (("dih", "distributed index"), "dih.dreadddata"),
    (("view document", "preview"), "view.view"),
    (("agentstore", "agent", "profile match"), "agentstore.query"),
    (("health", "getstatus", "ping component"), "content.getstatus"),
    (("license",), "content.getlicenseinfo"),
    (("answer", "ask a question", "question answering", "answer bank"), "answer.ask"),
    (("knowledge graph", "neighbors", "subgraph", "shortest path"), "kg.getneighbors"),
    (("train face", "enroll face", "list faces"), "media.trainface"),
    (("decrypt security", "inspect securityinfo"), "community.userdecryptsecurityinfo"),
    (("list connectors", "which connector"), "connectors.catalog"),
    (("ogs users", "group server users"), "ogs.getallusers"),
]


def map_task(task: str, version: str | None = None) -> dict[str, Any]:
    resolved = resolve_version(version)
    registry = get_registry()
    needle = (task or "").strip().lower()
    ranked: list[tuple[int, str]] = []
    for hints, cap_id in _HINTS:
        score = sum(4 if hint in needle else 0 for hint in hints)
        if score:
            ranked.append((score, cap_id))
    for cap in registry.search(task or ""):
        ranked.append((2, cap.id))
    seen: set[str] = set()
    ordered: list[str] = []
    for _, cap_id in sorted(ranked, key=lambda item: item[0], reverse=True):
        if cap_id not in seen:
            seen.add(cap_id)
            ordered.append(cap_id)
    matches = []
    for cap_id in ordered[:8]:
        cap = registry.get(cap_id)
        available = cap.available_in(resolved.train)
        matches.append(
            {
                "capability": cap.as_dict(),
                "availableInRequestedVersion": available,
                "alternative": None if available else _alternative(cap_id, resolved.train),
            }
        )
    return {
        "task": task,
        "version": resolved.as_dict(),
        "matches": matches,
        "recommendedSkill": matches[0]["capability"]["mcp_skill"] if matches else None,
        "recommendedTool": matches[0]["capability"]["mcp_tool"] if matches else None,
    }


def _alternative(cap_id: str, train: str) -> str | None:
    if cap_id == "media.image_description" and train < "26.2":
        return "ImageDescription requires Media Server 26.2 or later. Use OCR or object recognition instead."
    if cap_id == "dah.suggest" and train < "26.3":
        return "DAH Suggest UseVectors is documented for 26.3. Use Content Suggest / TermGetBest without UseVectors on earlier trains."
    return f"Capability '{cap_id}' is not listed for train {train}."
