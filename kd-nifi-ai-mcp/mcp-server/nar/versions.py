"""Normalized version values for IDOL, Apache NiFi, NAR, and processors."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .errors import VersionParseError

# OpenText product versions look like 26.2 / 26.2.0 / 26.3.0-nifi2
# Apache NiFi versions look like 2.9.0 / 2.0.0
_VERSION_RE = re.compile(
    r"""
    ^\s*
    v?
    (?P<major>\d+)
    \.(?P<minor>\d+)
    (?:\.(?P<patch>\d+))?
    (?:[-._]?(?P<qualifier>nifi2|nifi))?
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)


@dataclass(frozen=True, order=True)
class Version:
    major: int
    minor: int = 0
    patch: int = 0
    qualifier: str = ""

    @property
    def major_minor(self) -> str:
        return f"{self.major}.{self.minor}"

    @property
    def dotted(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"

    def matches(self, other: "Version", *, ignore_patch: bool = True, ignore_qualifier: bool = True) -> bool:
        if self.major != other.major or self.minor != other.minor:
            return False
        if not ignore_patch and self.patch != other.patch:
            return False
        if not ignore_qualifier and (self.qualifier or "") != (other.qualifier or ""):
            return False
        return True

    def __str__(self) -> str:
        base = self.dotted
        return f"{base}-{self.qualifier}" if self.qualifier else base


def parse_version(raw: str | None, *, field: str = "version") -> Version:
    if raw is None or not str(raw).strip():
        raise VersionParseError(f"{field} is empty")
    text = str(raw).strip()
    match = _VERSION_RE.match(text)
    if not match:
        raise VersionParseError(
            f"Invalid {field} '{raw}'. Expected forms like 26.2, 26.2.0, 26.3.0-nifi2, or 2.9.0."
        )
    qualifier = (match.group("qualifier") or "").lower()
    return Version(
        major=int(match.group("major")),
        minor=int(match.group("minor") or 0),
        patch=int(match.group("patch") or 0),
        qualifier=qualifier,
    )


def looks_like_apache_nifi(version: Version) -> bool:
    """Apache NiFi 2.x is 2.y.z. OpenText IDOL/NiFi product versions are 23+."""
    return version.major < 20
