"""OpenText Knowledge Discovery MCP capability layer.

Primary target version: Knowledge Discovery 26.3.
This package is additive: existing NiFi / NAR MCP tools are unchanged.
"""

from __future__ import annotations

TARGET_VERSION = "26.3"
SUPPORTED_VERSIONS = ("26.1", "26.2", "26.3")

__all__ = ["TARGET_VERSION", "SUPPORTED_VERSIONS"]
