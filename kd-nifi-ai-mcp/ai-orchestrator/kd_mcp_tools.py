"""
OpenText Knowledge Discovery MCP tools.

Official Cloudera nifi-mcp-server has no create_kd_* tools. When the
orchestrator forwards a NiFi MCP flow-build request that matches a KD
pattern, these tools run instead — they create process groups on the
live NiFi instance via REST (same path the IDOL 26.3 samples already use).

The tool names and JSON Schemas are what Ollama / the UI see. They are
merged into list_tools so a model can call them next to official tools.
"""

from __future__ import annotations

from typing import Any, Callable, Awaitable

from nifi_rest import NiFiRest, NiFiRestError


Handler = Callable[..., Awaitable[dict]]


def _schema(properties: dict, required: list[str]) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": True,
    }


KD_TOOLS: list[dict] = [
    {
        "name": "create_kd_file_connector_flow",
        "description": (
            "OpenText KD: watch a directory with GetFile, stamp Knowledge Discovery "
            "metadata, and POST each document to IDOL Content action=index."
        ),
        "inputSchema": _schema(
            {
                "flow_name": {"type": "string", "description": "Process group name"},
                "source_path": {"type": "string", "description": "Directory to watch"},
                "idol_host": {"type": "string"},
                "idol_port": {"type": "string", "default": "9100"},
                "file_filter": {"type": "string"},
            },
            [],
        ),
    },
    {
        "name": "create_kd_idol_nifi2_flow",
        "description": (
            "OpenText KD on IDOL NiFi 26.3/nifi2: IdolSslConfigServiceImpl + "
            "IdolLicenseServiceImpl, GetFileSystem → PutIDOL."
        ),
        "inputSchema": _schema(
            {
                "flow_name": {"type": "string"},
                "source_path": {"type": "string"},
                "idol_host": {"type": "string"},
                "idol_port": {"type": "string", "default": "9000"},
            },
            [],
        ),
    },
    {
        "name": "create_kd_ai_python_flow",
        "description": (
            "OpenText KD AI sample: GenerateDocumentFlowFile → ExecuteDocumentPython "
            "with both IDOL controller services."
        ),
        "inputSchema": _schema(
            {
                "flow_name": {"type": "string"},
                "enrichment_script": {
                    "type": "string",
                    "description": "Python script path inside the NiFi container",
                },
            },
            [],
        ),
    },
    {
        "name": "create_kd_sap_flow",
        "description": (
            "OpenText KD: pull documents from an SAP HTTP endpoint, map metadata, "
            "index into IDOL Content."
        ),
        "inputSchema": _schema(
            {
                "flow_name": {"type": "string"},
                "sap_endpoint": {"type": "string"},
                "repository": {"type": "string"},
                "idol_host": {"type": "string"},
                "idol_port": {"type": "string", "default": "9100"},
            },
            ["sap_endpoint"],
        ),
    },
    {
        "name": "create_kd_documentum_flow",
        "description": (
            "OpenText KD: fetch from a Documentum REST repository and index into IDOL Content."
        ),
        "inputSchema": _schema(
            {
                "flow_name": {"type": "string"},
                "documentum_endpoint": {"type": "string"},
                "idol_host": {"type": "string"},
                "idol_port": {"type": "string", "default": "9100"},
            },
            ["documentum_endpoint"],
        ),
    },
    {
        "name": "create_kd_enrichment_flow",
        "description": (
            "OpenText KD mid-pipeline stage: map KD metadata fields and POST to IDOL index."
        ),
        "inputSchema": _schema(
            {
                "flow_name": {"type": "string"},
                "idol_host": {"type": "string"},
                "idol_port": {"type": "string", "default": "9100"},
                "enrichment_script": {"type": "string"},
            },
            [],
        ),
    },
    {
        "name": "list_idol_nar_versions",
        "description": "List registered IDOL/NiFi NAR compatibility profiles. Never guesses a NAR from a filename.",
        "inputSchema": _schema({}, []),
    },
    {
        "name": "resolve_idol_nars",
        "description": "Resolve the exact IDOL NiFi NAR package for idolVersion + nifiVersion.",
        "inputSchema": _schema(
            {
                "idolVersion": {"type": "string"},
                "nifiVersion": {"type": "string"},
                "requestedProcessors": {"type": "array", "items": {"type": "string"}},
                "prompt": {"type": "string"},
            },
            [],
        ),
    },
    {
        "name": "validate_idol_nar_compatibility",
        "description": "Validate whether an IDOL/NiFi/NAR combination is supported. No silent fallback.",
        "inputSchema": _schema(
            {
                "idolVersion": {"type": "string"},
                "nifiVersion": {"type": "string"},
                "narVersion": {"type": "string"},
                "requestedProcessors": {"type": "array", "items": {"type": "string"}},
            },
            [],
        ),
    },
    {
        "name": "get_idol_nar_manifest",
        "description": "Return the manifest for one NAR compatibility profile.",
        "inputSchema": _schema(
            {"profileId": {"type": "string"}, "idolVersion": {"type": "string"}},
            [],
        ),
    },
    {
        "name": "generate_idol_nifi_flow",
        "description": "Generate a version-aware IDOL NiFi reference flow after NAR validation.",
        "inputSchema": _schema(
            {
                "prompt": {"type": "string"},
                "flowId": {"type": "string"},
                "idolVersion": {"type": "string"},
                "nifiVersion": {"type": "string"},
                "requestedProcessors": {"type": "array", "items": {"type": "string"}},
            },
            [],
        ),
    },
    {
        "name": "validate_generated_idol_flow",
        "description": "Validate that IDOL processors in a generated flow map to the selected NAR.",
        "inputSchema": _schema(
            {
                "flow": {"type": "object"},
                "idolVersion": {"type": "string"},
                "nifiVersion": {"type": "string"},
            },
            ["flow"],
        ),
    },
    {
        "name": "install_idol_nars",
        "description": "Prepare/install NARs for local NiFi only. External NiFi is a prerequisite.",
        "inputSchema": _schema(
            {
                "idolVersion": {"type": "string"},
                "nifiVersion": {"type": "string"},
                "targetDirectory": {"type": "string"},
            },
            [],
        ),
    },
    {
        "name": "diagnose_idol_nifi_environment",
        "description": "Diagnose NiFi/Java/NAR compatibility for the requested IDOL version.",
        "inputSchema": _schema(
            {
                "idolVersion": {"type": "string"},
                "nifiVersion": {"type": "string"},
                "javaVersion": {"type": "string"},
                "installedNars": {"type": "array", "items": {"type": "string"}},
            },
            [],
        ),
    },
]


def kd_tool_names() -> set[str]:
    return {t["name"] for t in KD_TOOLS}


def kd_tool_catalog() -> list[dict]:
    return [dict(t) for t in KD_TOOLS]


def _nar_service():
    from idol_nar_bridge import IdolNarService

    return IdolNarService()


async def call_kd_tool(name: str, arguments: dict | None = None) -> dict:
    args = dict(arguments or {})
    if name in {
        "list_idol_nar_versions",
        "resolve_idol_nars",
        "validate_idol_nar_compatibility",
        "get_idol_nar_manifest",
        "generate_idol_nifi_flow",
        "validate_generated_idol_flow",
        "install_idol_nars",
        "diagnose_idol_nifi_environment",
    }:
        svc = _nar_service()
        if name == "list_idol_nar_versions":
            return svc.list_versions()
        if name == "resolve_idol_nars":
            return svc.resolve_nars(
                idol_version=args.get("idolVersion") or args.get("idol_version"),
                nifi_version=args.get("nifiVersion") or args.get("nifi_version"),
                requested_processors=args.get("requestedProcessors") or args.get("requested_processors"),
                prompt=args.get("prompt"),
            )
        if name == "validate_idol_nar_compatibility":
            return svc.validate_compatibility(
                idol_version=args.get("idolVersion") or args.get("idol_version"),
                nifi_version=args.get("nifiVersion") or args.get("nifi_version"),
                nar_version=args.get("narVersion") or args.get("nar_version"),
                requested_processors=args.get("requestedProcessors"),
            )
        if name == "get_idol_nar_manifest":
            return svc.manifest(profile_id=args.get("profileId"), idol_version=args.get("idolVersion"))
        if name == "generate_idol_nifi_flow":
            return svc.generate_flow(
                prompt=args.get("prompt"),
                flow_id=args.get("flowId") or args.get("flow_id"),
                idol_version=args.get("idolVersion") or args.get("idol_version"),
                nifi_version=args.get("nifiVersion") or args.get("nifi_version"),
                requested_processors=args.get("requestedProcessors"),
            )
        if name == "validate_generated_idol_flow":
            return svc.validate_flow_spec(
                args.get("flow") or {},
                idol_version=args.get("idolVersion"),
                nifi_version=args.get("nifiVersion"),
            )
        if name == "install_idol_nars":
            return svc.install_nars(
                idol_version=args.get("idolVersion"),
                nifi_version=args.get("nifiVersion"),
            )
        if name == "diagnose_idol_nifi_environment":
            return svc.diagnose_environment(
                idol_version=args.get("idolVersion"),
                nifi_version=args.get("nifiVersion"),
                java_version=args.get("javaVersion"),
                installed_nars=args.get("installedNars"),
            )
    rest = NiFiRest()
    try:
        if name == "create_kd_file_connector_flow":
            return await rest.create_idol_sample_flow(
                name=args.get("flow_name") or "KD File Ingestion",
                source_path=args.get("source_path") or "/idol-ingest",
                idol_host=args.get("idol_host"),
                idol_port=args.get("idol_port") or args.get("idol_port".upper(), None),
            )
        if name == "create_kd_idol_nifi2_flow":
            return await rest.create_idol_nifi2_sample_flow(
                name=args.get("flow_name") or "KD 26.3.0-nifi2 GetFileSystem to PutIDOL",
                source_path=args.get("source_path") or "/idol-ingest",
                idol_host=args.get("idol_host"),
                idol_port=args.get("idol_port"),
            )
        if name == "create_kd_ai_python_flow":
            return await rest.create_ai_python_sample_flow(
                name=args.get("flow_name") or "AI test with Python",
                script_file=args.get("enrichment_script") or args.get("script_file"),
            )
        if name == "create_kd_sap_flow":
            return await rest.create_http_source_idol_flow(
                name=args.get("flow_name") or "KD SAP Ingestion",
                pattern="sap",
                source_name="Fetch from SAP",
                source_url=(
                    (args.get("sap_endpoint") or "").rstrip("/")
                    + "/"
                    + (args.get("repository") or "default")
                ),
                idol_host=args.get("idol_host"),
                idol_port=args.get("idol_port"),
                kd_source="sap",
            )
        if name == "create_kd_documentum_flow":
            return await rest.create_http_source_idol_flow(
                name=args.get("flow_name") or "KD Documentum Ingestion",
                pattern="documentum",
                source_name="Fetch from Documentum",
                source_url=args.get("documentum_endpoint") or "",
                idol_host=args.get("idol_host"),
                idol_port=args.get("idol_port"),
                kd_source="documentum",
            )
        if name == "create_kd_enrichment_flow":
            return await rest.create_http_source_idol_flow(
                name=args.get("flow_name") or "IDOL Indexing Stage",
                pattern="enrichment",
                source_name="Map KD metadata",
                source_url=None,
                idol_host=args.get("idol_host"),
                idol_port=args.get("idol_port"),
                kd_source="enrichment",
                metadata_only=True,
            )
    except NiFiRestError as exc:
        raise RuntimeError(str(exc)) from exc
    raise KeyError(f"Unknown KD MCP tool '{name}'")
