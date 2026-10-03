"""MCP tools for version-aware IDOL NiFi NAR management."""

from __future__ import annotations

from typing import Any

from nifi_client import NiFiClient

from nar.service import IdolNarService


def register(mcp, client: NiFiClient, service: IdolNarService | None = None) -> None:
    svc = service or IdolNarService()

    @mcp.tool()
    async def list_idol_nar_versions() -> dict:
        """Return every registered IDOL/NiFi NAR compatibility profile."""
        return svc.list_versions()

    @mcp.tool()
    async def resolve_idol_nars(
        idolVersion: str | None = None,
        nifiVersion: str | None = None,
        requestedProcessors: list[str] | None = None,
        prompt: str | None = None,
    ) -> dict:
        """Resolve the NAR package for an IDOL + NiFi request. Never falls back across minor versions."""
        return svc.resolve_nars(
            idol_version=idolVersion,
            nifi_version=nifiVersion,
            requested_processors=requestedProcessors,
            prompt=prompt,
        )

    @mcp.tool()
    async def validate_idol_nar_compatibility(
        idolVersion: str | None = None,
        nifiVersion: str | None = None,
        narVersion: str | None = None,
        requestedProcessors: list[str] | None = None,
    ) -> dict:
        """Validate whether a requested IDOL/NiFi/NAR combination is supported."""
        return svc.validate_compatibility(
            idol_version=idolVersion,
            nifi_version=nifiVersion,
            nar_version=narVersion,
            requested_processors=requestedProcessors,
        )

    @mcp.tool()
    async def get_idol_nar_manifest(profileId: str | None = None, idolVersion: str | None = None) -> dict:
        """Return detailed metadata for one NAR compatibility profile."""
        return svc.manifest(profile_id=profileId, idol_version=idolVersion)

    @mcp.tool()
    async def generate_idol_nifi_flow(
        prompt: str | None = None,
        flowId: str | None = None,
        idolVersion: str | None = None,
        nifiVersion: str | None = None,
        requestedProcessors: list[str] | None = None,
    ) -> dict:
        """Generate an IDOL NiFi flow only after NAR compatibility validation succeeds."""
        return svc.generate_flow(
            prompt=prompt,
            flow_id=flowId,
            idol_version=idolVersion,
            nifi_version=nifiVersion,
            requested_processors=requestedProcessors,
        )

    @mcp.tool()
    async def validate_generated_idol_flow(
        flow: dict[str, Any],
        idolVersion: str | None = None,
        nifiVersion: str | None = None,
    ) -> dict:
        """Validate that every IDOL processor in a generated flow maps to a compatible NAR."""
        return svc.validate_flow_spec(flow, idol_version=idolVersion, nifi_version=nifiVersion)

    @mcp.tool()
    async def install_idol_nars(
        idolVersion: str | None = None,
        nifiVersion: str | None = None,
        targetDirectory: str | None = None,
    ) -> dict:
        """Install or prepare the correct NAR package. Local only; external NiFi is a prerequisite."""
        if targetDirectory:
            svc.config.nifi_extensions_dir = targetDirectory  # type: ignore[assignment]
        return svc.install_nars(idol_version=idolVersion, nifi_version=nifiVersion)

    @mcp.tool()
    async def diagnose_idol_nifi_environment(
        idolVersion: str | None = None,
        nifiVersion: str | None = None,
        javaVersion: str | None = None,
        installedNars: list[str] | None = None,
    ) -> dict:
        """Check live NiFi version, installed types, and NAR compatibility problems."""
        about = None
        processor_types: list[str] | None = None
        try:
            about = await client._request("GET", "/flow/about")
        except Exception:
            about = None
        try:
            rows = await client.list_processor_types()
            processor_types = [str(r.get("type") or "") for r in rows]
        except Exception:
            processor_types = None
        return svc.diagnose_environment(
            idol_version=idolVersion,
            nifi_version=nifiVersion,
            about=about,
            processor_types=processor_types,
            java_version=javaVersion,
            installed_nars=installedNars,
        )
