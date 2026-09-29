"""Version-aware OpenText IDOL NiFi NAR management.

Layers (flow generator never picks a NAR version itself):

    intent extraction  →  compatibility resolver  →  NAR registry
                     →  flow generator / validator  →  deployment adapter
"""

from .config import NarConfig
from .errors import CompatibilityError, NarResolutionError, VersionParseError
from .intent import VersionIntent, extract_version_intent
from .registry import NarRegistry
from .resolver import NarResolver, Resolution
from .versions import Version, parse_version

__all__ = [
    "CompatibilityError",
    "NarConfig",
    "NarRegistry",
    "NarResolutionError",
    "NarResolver",
    "Resolution",
    "Version",
    "VersionIntent",
    "VersionParseError",
    "extract_version_intent",
    "parse_version",
]
