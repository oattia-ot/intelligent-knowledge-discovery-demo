"""Knowledge Discovery errors."""

from __future__ import annotations


class KnowledgeDiscoveryError(RuntimeError):
    """Base error for the KD MCP layer."""


class VersionError(KnowledgeDiscoveryError):
    """Requested product version cannot be resolved."""


class ComponentError(KnowledgeDiscoveryError):
    """Unknown or unconfigured KD component."""


class CapabilityError(KnowledgeDiscoveryError):
    """Capability is unknown, unsupported, deprecated, or removed."""


class ParameterError(KnowledgeDiscoveryError):
    """Request parameters failed validation."""


class ConfirmationRequired(KnowledgeDiscoveryError):
    """Destructive action requires explicit confirmation."""


class AciClientError(KnowledgeDiscoveryError):
    """ACI HTTP call failed."""


class ConfigurationError(KnowledgeDiscoveryError):
    """Missing or invalid endpoint/auth configuration."""
