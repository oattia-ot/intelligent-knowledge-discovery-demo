"""Safe execution classification for KD operations."""

from __future__ import annotations

from typing import Any

from .errors import ConfirmationRequired

READ_ONLY = "READ_ONLY"
SAFE_WRITE = "SAFE_WRITE"
DESTRUCTIVE = "DESTRUCTIVE"

DESTRUCTIVE_ACTIONS = {
    "DREDELETEDOC",
    "DREDELETEREF",
    "DREINITIAL",
    "DRECOMPACT",
    "DREDELDBASE",
    "DRERESTORE",
    "CATEGORYDELETE",
    "USERDELETE",
    "REMOVEFACE",
    "REMOVEFACEDATABASE",
}

SAFE_WRITE_ACTIONS = {
    "DREADD",
    "DREADDDATA",
    "DREREPLACE",
    "DRESYNC",
    "DRECREATEDBASE",
    "USERADD",
    "CATEGORYCREATE",
    "SYNCHRONIZE",
    "COLLECT",
    "PROCESS",
    "BUILDOBJECTCLASSRECOGNIZER",
    "TRAINFACE",
    "BUILDFACE",
    "MANAGERESOURCES",
}


def classify(action: str, *, destructive_flag: bool | None = None) -> str:
    name = (action or "").upper()
    if destructive_flag or name in DESTRUCTIVE_ACTIONS:
        return DESTRUCTIVE
    if name in SAFE_WRITE_ACTIONS:
        return SAFE_WRITE
    return READ_ONLY


def require_confirmation(action: str, confirm: bool | None, *, destructive_flag: bool | None = None) -> None:
    if classify(action, destructive_flag=destructive_flag) != DESTRUCTIVE:
        return
    if confirm is True:
        return
    raise ConfirmationRequired(
        f"Action '{action}' is DESTRUCTIVE and requires confirm=true. "
        "It will not run from a natural-language request without explicit confirmation."
    )


def envelope(classification: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"classification": classification, **payload}
