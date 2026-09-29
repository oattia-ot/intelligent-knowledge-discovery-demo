"""
Load KD flow patterns from templates/catalog.json (and templates/custom/).

catalog.json is the single index the UI and orchestrator should read.
The JSON files under ingest/, idol-nifi2/, and stages/ are generator
specs — not Apache NiFi Templates.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any


def templates_dir() -> Path:
    env = os.environ.get("KD_TEMPLATES_DIR", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "templates"


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug or "custom"


def catalog_path() -> Path:
    return templates_dir() / "catalog.json"


def custom_dir() -> Path:
    return templates_dir() / "custom"


def load_catalog_entries() -> list[dict]:
    path = catalog_path()
    if not path.is_file():
        return []
    raw = _read_json(path)
    items = raw.get("templates") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for item in items:
        if isinstance(item, dict) and item.get("id"):
            out.append(dict(item))
    return out


def load_custom_entries() -> list[dict]:
    folder = custom_dir()
    if not folder.is_dir():
        return []
    out: list[dict] = []
    for path in sorted(folder.glob("*.json")):
        try:
            item = _read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(item, dict):
            continue
        item.setdefault("id", path.stem)
        item.setdefault("kind", "template")
        item.setdefault("group", "custom")
        item.setdefault("custom", True)
        item["_path"] = str(path)
        out.append(item)
    return out



def official_mcp_tools() -> set[str]:
    raw = _read_json(catalog_path()) if catalog_path().is_file() else {}
    names = raw.get("official_mcp_tools") if isinstance(raw, dict) else None
    return {str(n) for n in names or []}


def kd_mcp_tools() -> set[str]:
    raw = _read_json(catalog_path()) if catalog_path().is_file() else {}
    names = raw.get("kd_mcp_tools") if isinstance(raw, dict) else None
    return {str(n) for n in names or []}


def live_mcp_tool(entry: dict) -> str | None:
    """Return mcp_tool when it is a live official or OpenText KD tool."""
    name = entry.get("mcp_tool")
    if not name:
        return None
    allowed = official_mcp_tools() | kd_mcp_tools()
    if allowed and name not in allowed:
        return None
    return name

def load_spec(relpath: str | None) -> dict | None:
    if not relpath:
        return None
    path = templates_dir() / relpath
    if not path.is_file():
        return None
    try:
        data = _read_json(path)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def as_lookup_item(entry: dict) -> dict:
    spec = load_spec(entry.get("file")) if entry.get("file") else None
    title = entry.get("title") or (spec or {}).get("flowName") or entry.get("id")
    description = (
        entry.get("description")
        or (spec or {}).get("description")
        or entry.get("prompt")
        or ""
    )
    prompt = entry.get("prompt") or (spec or {}).get("prompt") or f"Create a NiFi flow: {title}"
    item = {
        "id": entry.get("id"),
        "kind": entry.get("kind") or "template",
        "group": entry.get("group") or "other",
        "title": title,
        "name": entry.get("name") or title,
        "description": description,
        "prompt": prompt,
        "skill": entry.get("skill"),
        "needs": entry.get("needs") or "",
        "mcp_tool": live_mcp_tool(entry),
        "runtime": entry.get("runtime") or "unimplemented",
        "nifi_rest": entry.get("nifi_rest"),
        "official_recipe": list(entry.get("official_recipe") or []),
        "required_config": list(entry.get("required_config") or []),
        "required": list(entry.get("required") or []),
        "file": entry.get("file"),
    }
    if entry.get("custom"):
        item["custom"] = True
    if spec:
        item["pattern"] = spec.get("pattern") or entry.get("id")
        item["flowName"] = spec.get("flowName")
    return item


def list_lookup_templates(q: str = "") -> list[dict]:
    return list_lookup_kind("template", q)


def persist_custom_template(title: str, description: str, prompt: str) -> dict:
    return persist_custom_object("template", title, description, prompt)


def kind_catalog_path(kind: str) -> Path:
    name = {"action": "actions.json", "skill": "skills.json", "template": "catalog.json"}.get(kind)
    if not name:
        raise ValueError(f"Unknown kind '{kind}'")
    return templates_dir() / name


def load_kind_seed_entries(kind: str) -> list[dict]:
    """Built-in catalog for a kind. Templates stay in catalog.json; actions/skills have their own files."""
    path = kind_catalog_path(kind)
    if not path.is_file():
        return []
    raw = _read_json(path)
    if kind == "template":
        items = raw.get("templates") if isinstance(raw, dict) else raw
    else:
        items = raw.get("items") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for item in items:
        if isinstance(item, dict) and (item.get("id") or item.get("title")):
            rec = dict(item)
            rec.setdefault("kind", kind)
            out.append(rec)
    return out


def _title_of(entry: dict) -> str:
    return str(entry.get("title") or entry.get("name") or entry.get("id") or "").strip()


def _same_name(a: str, b: str) -> bool:
    return " ".join((a or "").split()).casefold() == " ".join((b or "").split()).casefold()


def load_custom_entries_of(kind: str) -> list[dict]:
    return [e for e in load_custom_entries() if (e.get("kind") or "template") == kind]


def list_lookup_kind(kind: str, q: str = "") -> list[dict]:
    items = [as_lookup_item(e) for e in load_kind_seed_entries(kind)]
    items.extend(as_lookup_item(e) for e in load_custom_entries_of(kind))
    # Custom entries override seeds with the same title so an edited item wins.
    seen: dict[str, dict] = {}
    for item in items:
        key = _title_of(item).casefold()
        if key:
            seen[key] = item
    items = list(seen.values())
    needle = (q or "").lower().strip()
    if needle:
        items = [
            i
            for i in items
            if needle
            in (
                str(i.get("title", ""))
                + str(i.get("description", ""))
                + str(i.get("prompt", ""))
                + str(i.get("id", ""))
            ).lower()
        ]
    return items


def list_lookup_objects(q: str = "") -> list[dict]:
    out: list[dict] = []
    for kind in ("action", "skill", "template"):
        out.extend(list_lookup_kind(kind, q))
    return out


def find_object(kind: str | None, name: str) -> dict | None:
    name = (name or "").strip()
    if not name:
        return None
    kinds = [kind] if kind in ("action", "skill", "template") else ("action", "skill", "template")
    for k in kinds:
        for item in list_lookup_kind(k):
            if _same_name(_title_of(item), name):
                return item
    return None


def persist_custom_object(
    kind: str,
    title: str,
    description: str = "",
    prompt: str = "",
    needs: str = "",
    required: list | None = None,
) -> dict:
    if kind not in ("action", "skill", "template"):
        raise ValueError(f"Unknown kind '{kind}'")
    folder = custom_dir()
    folder.mkdir(parents=True, exist_ok=True)
    title = (title or "").strip()
    if not title:
        raise ValueError("title is required")
    # Replace an existing custom file with the same title rather than minting -2.
    for existing in load_custom_entries_of(kind):
        if _same_name(_title_of(existing), title) and existing.get("_path"):
            path = Path(existing["_path"])
            rec = {
                "id": path.stem,
                "kind": kind,
                "group": "custom",
                "title": title,
                "name": title,
                "description": (description or "").strip(),
                "prompt": (prompt or "").strip() or f"Execute the NiFi {kind}: {title}",
                "needs": (needs or "").strip(),
                "required_config": list(required or []),
                "custom": True,
            }
            path.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
            rec["_path"] = str(path)
            return rec
    slug = _slug(title)
    path = folder / f"{slug}.json"
    n = 1
    while path.exists():
        n += 1
        path = folder / f"{slug}-{n}.json"
    rec = {
        "id": path.stem,
        "kind": kind,
        "group": "custom",
        "title": title,
        "name": title,
        "description": (description or "").strip(),
        "prompt": (prompt or "").strip() or f"Execute the NiFi {kind}: {title}",
        "needs": (needs or "").strip(),
        "required_config": list(required or []),
        "custom": True,
    }
    path.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    rec["_path"] = str(path)
    return rec


def delete_custom_object(kind: str, title: str) -> bool:
    title = (title or "").strip()
    removed = False
    for existing in load_custom_entries_of(kind):
        if _same_name(_title_of(existing), title) and existing.get("_path"):
            path = Path(existing["_path"])
            try:
                path.unlink()
                removed = True
            except OSError:
                pass
    return removed


def clear_custom_objects(kinds: list[str] | None = None) -> int:
    allowed = set(kinds or ("action", "skill", "template"))
    count = 0
    for existing in load_custom_entries():
        kind = existing.get("kind") or "template"
        if kind in allowed and existing.get("_path"):
            try:
                Path(existing["_path"]).unlink()
                count += 1
            except OSError:
                pass
    return count
