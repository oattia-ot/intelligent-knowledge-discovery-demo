"""Centralized version/NAR configuration. No hard-coded 26.2/26.3 in business logic."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _default_nars_root() -> Path:
    env = os.environ.get("IDOL_NAR_PATH") or os.environ.get("IDOL_NAR_REPOSITORY")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    # mcp-server/nar/config.py → repo nars/
    return here.parents[2] / "nars"


@dataclass
class NarConfig:
    nars_root: Path
    idol_version: str | None
    nifi_version: str | None
    nar_version: str | None
    repository: str | None
    validation_enabled: bool
    deployment_mode: str  # local | external
    nifi_extensions_dir: Path | None
    nifi_image: str | None

    @classmethod
    def from_env(cls, nars_root: Path | None = None) -> "NarConfig":
        root = Path(nars_root) if nars_root else _default_nars_root()
        mode = (os.environ.get("NIFI_DEPLOYMENT_MODE") or os.environ.get("NIFI_LOCATION") or "external").lower()
        if mode in {"create-nifi", "compose"}:
            mode = "local"
        if mode not in {"local", "external"}:
            mode = "external"
        ext = os.environ.get("NIFI_EXTENSIONS_DIR") or os.environ.get("NIFI_NAR_INSTALL_DIR")
        return cls(
            nars_root=root,
            idol_version=_clean(os.environ.get("IDOL_VERSION")),
            nifi_version=_clean(os.environ.get("NIFI_VERSION") or os.environ.get("NIFI_PRODUCT_VERSION")),
            nar_version=_clean(os.environ.get("IDOL_NAR_VERSION")),
            repository=_clean(os.environ.get("IDOL_NAR_REPOSITORY")),
            validation_enabled=os.environ.get("NAR_VALIDATION_ENABLED", "true").lower() not in {"0", "false", "no"},
            deployment_mode=mode,
            nifi_extensions_dir=Path(ext) if ext else None,
            nifi_image=_clean(os.environ.get("NIFI_IMAGE")),
        )


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None
