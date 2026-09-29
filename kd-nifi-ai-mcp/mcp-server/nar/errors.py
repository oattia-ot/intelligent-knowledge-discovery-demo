"""Typed errors for NAR resolution. Never silently fall back."""


class VersionParseError(ValueError):
    """The requested version string is not a valid IDOL/NiFi version."""


class CompatibilityError(RuntimeError):
    """Requested IDOL/NiFi/NAR combination is not in the compatibility matrix."""

    def __init__(self, message: str, *, available: list[str] | None = None, requested: dict | None = None):
        super().__init__(message)
        self.available = available or []
        self.requested = requested or {}


class NarResolutionError(RuntimeError):
    """A compatible profile exists but the NAR artifacts cannot be used."""

    def __init__(self, message: str, *, profile_id: str | None = None, missing: list[str] | None = None):
        super().__init__(message)
        self.profile_id = profile_id
        self.missing = missing or []
