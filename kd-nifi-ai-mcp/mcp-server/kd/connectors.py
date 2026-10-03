"""Documented Knowledge Discovery 26.3 connector catalog.

Names come from the official 26.3 documentation portal connector list.
Per-repository Insert/Hold parameters are configuration, not invented HTTP APIs.
Execution remains CFS Synchronize/Collect or NiFi Ingest processors.
"""

from __future__ import annotations

from typing import Any

PORTAL = "https://www.microfocus.com/documentation/idol/knowledge-discovery-26.3"

CONNECTORS: list[dict[str, Any]] = [
    {"name": "CFS", "kind": "framework", "actions": ["Synchronize", "Collect", "QueueInfo"], "docs": PORTAL},
    {"name": "NiFi Ingest", "kind": "framework", "actions": ["NAR processors"], "docs": PORTAL},
    {"name": "AEM Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Amazon S3 Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Azure Blob Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Box Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Chatter Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "CMIS Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Confluence REST Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Core Content Connector", "kind": "repository", "actions": ["Synchronize", "Collect", "Insert", "Update", "Delete", "View"], "docs": "https://cabs.microfocus.com/documentation/idol/knowledge-discovery-26.1/corecontentconnector_26.1_Documentation/Help/Content/Introduction.htm"},
    {"name": "Content Manager Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Documentum Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "DropBox Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Dynamics Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Drupal Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Exchange Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "File System Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "SharePoint Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": PORTAL},
    {"name": "Web Connector", "kind": "repository", "actions": ["Synchronize", "Collect"], "docs": "https://blogs.opentext.com/whats-new-in-opentext-knowledge-discovery-idol/"},
]


def list_connectors(name: str | None = None) -> dict[str, Any]:
    rows = CONNECTORS
    if name:
        needle = name.lower()
        rows = [c for c in CONNECTORS if needle in c["name"].lower()]
    return {
        "version": "26.3",
        "documentation": PORTAL,
        "note": (
            "26.3 connector packs share CFS-style Synchronize/Collect/QueueInfo. "
            "This catalog does not invent per-repository HTTP endpoints."
        ),
        "count": len(rows),
        "connectors": rows,
    }
