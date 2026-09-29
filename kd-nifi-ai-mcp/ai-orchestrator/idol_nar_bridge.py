"""Import path for the shared NAR engine that lives under mcp-server/nar."""

from __future__ import annotations

import sys
from pathlib import Path


def _ensure_path() -> None:
    here = Path(__file__).resolve()
    candidates = [
        here.parent / "nar",
        here.parent.parent / "mcp-server",
        Path("/app"),
        Path("/app/mcp-server"),
    ]
    for path in candidates:
        text = str(path)
        has_pkg = (path / "nar").is_dir() or ((path / "service.py").is_file() and path.name == "nar")
        if has_pkg and text not in sys.path:
            sys.path.insert(0, text)


_ensure_path()

from nar.service import IdolNarService  # noqa: E402
from nar.intent import extract_version_intent  # noqa: E402

__all__ = ["IdolNarService", "extract_version_intent"]
