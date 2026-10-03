"""Ten version-aware IDOL + NiFi reference flow specifications."""

from __future__ import annotations

from typing import Any

from .resolver import Resolution


SENSITIVE = ["IDOL_PASSWORD", "IDOL_TOKEN", "LLM_API_KEY", "NIFI_PASSWORD"]


def _params() -> list[dict[str, Any]]:
    return [
        {"name": "IDOL_HOST", "sensitive": False, "env": "IDOL_HOST"},
        {"name": "IDOL_ACI_PORT", "sensitive": False, "env": "IDOL_PORT"},
        {"name": "IDOL_INDEX", "sensitive": False, "env": "IDOL_INDEX"},
        {"name": "IDOL_USERNAME", "sensitive": False, "env": "IDOL_USERNAME"},
        {"name": "IDOL_PASSWORD", "sensitive": True, "env": "IDOL_PASSWORD"},
        {"name": "SOURCE_PATH", "sensitive": False, "env": "IDOL_INGEST_PATH"},
        {"name": "IDOL_LICENSE_HOST", "sensitive": False, "env": "IDOL_LICENSE_HOST"},
        {"name": "IDOL_LICENSE_PORT", "sensitive": False, "env": "IDOL_LICENSE_PORT"},
        {"name": "IDOL_TLS_ENABLED", "sensitive": False, "env": "IDOL_TLS_ENABLED"},
        {"name": "IDOL_CA_CERTS", "sensitive": False, "env": "IDOL_SSL_AUTHORITY_CERTS"},
    ]


def _cs() -> list[dict[str, Any]]:
    return [
        {
            "name": "IdolSslConfigServiceImpl",
            "type": "idol.nifi.service.IdolSslConfigServiceImpl",
            "properties": {
                "CheckCertificate": "${IDOL_TLS_ENABLED}",
                "AuthorityCertificates": "#{IDOL_CA_CERTS}",
                "Method": "Negotiate",
            },
        },
        {
            "name": "IdolLicenseServiceImpl",
            "type": "idol.nifi.service.IdolLicenseServiceImpl",
            "properties": {
                "License Server Hostname": "#{IDOL_LICENSE_HOST}",
                "License Server Port": "#{IDOL_LICENSE_PORT}",
                "SSL Config Service": "IdolSslConfigServiceImpl",
            },
        },
    ]


def _env() -> list[str]:
    return [
        "IDOL_HOST",
        "IDOL_PORT",
        "IDOL_INDEX",
        "IDOL_LICENSE_HOST",
        "IDOL_LICENSE_PORT",
        "IDOL_INGEST_PATH",
        "IDOL_TLS_ENABLED",
        "IDOL_SSL_AUTHORITY_CERTS",
    ]


def _example() -> dict[str, str]:
    return {
        "IDOL_HOST": "idol-content",
        "IDOL_ACI_PORT": "9000",
        "IDOL_INDEX": "documents",
        "SOURCE_PATH": "/idol-ingest",
        "IDOL_LICENSE_HOST": "idol-licenseserver",
        "IDOL_LICENSE_PORT": "20000",
        "IDOL_TLS_ENABLED": "false",
    }


def _error_std() -> dict[str, Any]:
    return {
        "retry": {"count": 3, "delay": "30 sec"},
        "failureQueue": True,
        "deadLetterQueue": False,
        "relationships": ["success", "failure"],
    }


def _error_enterprise() -> dict[str, Any]:
    return {
        "retry": {"count": 5, "delay": "15 sec"},
        "failureQueue": True,
        "deadLetterQueue": True,
        "quarantine": True,
        "archive": True,
        "audit": ["correlation.id", "processing.timestamp", "source.document.id"],
        "relationships": ["success", "failure", "retry"],
    }


def _validation() -> list[str]:
    return [
        "NiFi version matches the resolved NAR profile",
        "IDOL version matches the resolved NAR profile",
        "Required NAR files belong to that profile only",
        "PutIDOL / GetFileSystem / IDOL controller services exist in the selected NAR",
        "Sensitive values use parameters or environment variables",
        "TLS properties set when IDOL_TLS_ENABLED is true",
    ]


def _deploy() -> dict[str, str]:
    return {
        "local": "Resolver may copy NARs into NIFI_EXTENSIONS_DIR when deployment mode is local.",
        "external": "Treat NAR installation as an environment prerequisite. Report missing artifacts; do not push NARs remotely.",
    }


REFERENCE_FLOWS: dict[str, dict[str, Any]] = {
    "content-ingestion": {
        "id": "content-ingestion",
        "flowName": "IDOL Content Ingestion",
        "purpose": "Read documents from a filesystem or hot folder and send them to IDOL Content.",
        "processors": [
            {"name": "ListInputDirectory", "type": "org.apache.nifi.processors.standard.GetFile", "role": "source"},
            {"name": "FileIngestion", "type": "idol.nifi.connector.GetFileSystem", "role": "ingest"},
            {"name": "MetadataExtraction", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "metadata"},
            {"name": "IDOLContentProcessor", "type": "idol.nifi.processor.PutIDOL", "role": "index"},
            {"name": "SuccessLog", "type": "org.apache.nifi.processors.standard.LogAttribute", "role": "success"},
            {"name": "FailureQueue", "type": "org.apache.nifi.processors.standard.PutFile", "role": "failure"},
        ],
        "relationships": [
            {"from": "ListInputDirectory", "to": "FileIngestion", "relationship": "success"},
            {"from": "FileIngestion", "to": "MetadataExtraction", "relationship": "success"},
            {"from": "MetadataExtraction", "to": "IDOLContentProcessor", "relationship": "success"},
            {"from": "IDOLContentProcessor", "to": "SuccessLog", "relationship": "success"},
            {"from": "FileIngestion", "to": "FailureQueue", "relationship": "failure"},
            {"from": "IDOLContentProcessor", "to": "FailureQueue", "relationship": "failure"},
        ],
        "requiredIdolServices": ["Content", "LicenseServer"],
        "errorHandling": _error_std(),
    },
    "content-indexing-metadata": {
        "id": "content-indexing-metadata",
        "flowName": "IDOL Content Indexing With Metadata",
        "purpose": "Ingest documents and enrich them with metadata before indexing.",
        "processors": [
            {"name": "FileInput", "type": "idol.nifi.connector.GetFileSystem", "role": "source"},
            {"name": "MimeDetection", "type": "org.apache.nifi.processors.standard.IdentifyMimeType", "role": "detect"},
            {"name": "MetadataExtraction", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "metadata"},
            {"name": "MetadataMapping", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "map"},
            {"name": "IDOLContentIndexing", "type": "idol.nifi.processor.PutIDOL", "role": "index"},
            {"name": "AuditLogging", "type": "org.apache.nifi.processors.standard.LogAttribute", "role": "audit"},
        ],
        "relationships": [
            {"from": "FileInput", "to": "MimeDetection", "relationship": "success"},
            {"from": "MimeDetection", "to": "MetadataExtraction", "relationship": "success"},
            {"from": "MetadataExtraction", "to": "MetadataMapping", "relationship": "success"},
            {"from": "MetadataMapping", "to": "IDOLContentIndexing", "relationship": "success"},
            {"from": "IDOLContentIndexing", "to": "AuditLogging", "relationship": "success"},
        ],
        "metadataFields": ["filename", "path", "mime.type", "file.creationTime", "file.lastModifiedTime", "custom.*"],
        "requiredIdolServices": ["Content", "LicenseServer"],
        "errorHandling": _error_std(),
    },
    "document-processing": {
        "id": "document-processing",
        "flowName": "IDOL Document Processing and Enrichment",
        "purpose": "Process documents before sending them to IDOL. Extra processors may be inserted between extraction and indexing.",
        "processors": [
            {"name": "DocumentInput", "type": "idol.nifi.connector.GetFileSystem", "role": "source"},
            {"name": "ContentExtraction", "type": "idol.nifi.processor.KeyViewFilter", "role": "extract"},
            {"name": "TextNormalization", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "normalize"},
            {"name": "MetadataEnrichment", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "enrich"},
            {"name": "IDOLProcessing", "type": "idol.nifi.processor.Eduction", "role": "process"},
            {"name": "IDOLContent", "type": "idol.nifi.processor.PutIDOL", "role": "index"},
        ],
        "relationships": [
            {"from": "DocumentInput", "to": "ContentExtraction", "relationship": "success"},
            {"from": "ContentExtraction", "to": "TextNormalization", "relationship": "success"},
            {"from": "TextNormalization", "to": "MetadataEnrichment", "relationship": "success"},
            {"from": "MetadataEnrichment", "to": "IDOLProcessing", "relationship": "success"},
            {"from": "IDOLProcessing", "to": "IDOLContent", "relationship": "success"},
        ],
        "extensionPoint": "between ContentExtraction and IDOLContent",
        "requiredIdolServices": ["Content", "LicenseServer", "KeyView"],
        "errorHandling": _error_std(),
    },
    "passage-extraction": {
        "id": "passage-extraction",
        "flowName": "IDOL Passage Extraction",
        "purpose": "Extract passages or textual content from documents using IDOL services.",
        "processors": [
            {"name": "DocumentInput", "type": "idol.nifi.connector.GetFileSystem", "role": "source"},
            {"name": "ContentExtraction", "type": "idol.nifi.processor.KeyViewFilter", "role": "extract"},
            {"name": "IDOLPassageExtraction", "type": "org.apache.nifi.processors.standard.InvokeHTTP", "role": "passages"},
            {"name": "ProcessedText", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "prepare"},
            {"name": "IDOLContent", "type": "idol.nifi.processor.PutIDOL", "role": "index"},
        ],
        "relationships": [
            {"from": "DocumentInput", "to": "ContentExtraction", "relationship": "success"},
            {"from": "ContentExtraction", "to": "IDOLPassageExtraction", "relationship": "success"},
            {"from": "IDOLPassageExtraction", "to": "ProcessedText", "relationship": "success"},
            {"from": "ProcessedText", "to": "IDOLContent", "relationship": "success"},
        ],
        "https": True,
        "timeout": "30 sec",
        "requiredIdolServices": ["Content", "LicenseServer"],
        "errorHandling": _error_std(),
    },
    "query-integration": {
        "id": "query-integration",
        "flowName": "IDOL Query Integration",
        "purpose": "Allow NiFi to query IDOL and process returned results.",
        "processors": [
            {"name": "NiFiTrigger", "type": "org.apache.nifi.processors.standard.GenerateFlowFile", "role": "trigger"},
            {"name": "IDOLQueryRequest", "type": "org.apache.nifi.processors.standard.InvokeHTTP", "role": "query"},
            {"name": "ResponseParsing", "type": "org.apache.nifi.processors.standard.EvaluateJsonPath", "role": "parse"},
            {"name": "ResultTransformation", "type": "org.apache.nifi.processors.standard.JoltTransformJSON", "role": "transform"},
            {"name": "DownstreamProcessing", "type": "org.apache.nifi.processors.standard.LogAttribute", "role": "output"},
        ],
        "relationships": [
            {"from": "NiFiTrigger", "to": "IDOLQueryRequest", "relationship": "success"},
            {"from": "IDOLQueryRequest", "to": "ResponseParsing", "relationship": "Original"},
            {"from": "ResponseParsing", "to": "ResultTransformation", "relationship": "matched"},
            {"from": "ResultTransformation", "to": "DownstreamProcessing", "relationship": "success"},
        ],
        "queryParameters": ["text", "databases", "maxResults", "timeout", "responseFormat"],
        "requiredIdolServices": ["Content"],
        "errorHandling": _error_std(),
    },
    "find-search": {
        "id": "find-search",
        "flowName": "IDOL Find Search Pipeline",
        "purpose": "Integrate NiFi with IDOL Find.",
        "processors": [
            {"name": "SearchRequest", "type": "org.apache.nifi.processors.standard.GenerateFlowFile", "role": "trigger"},
            {"name": "IDOLFind", "type": "org.apache.nifi.processors.standard.InvokeHTTP", "role": "find"},
            {"name": "ResponseParsing", "type": "org.apache.nifi.processors.standard.EvaluateJsonPath", "role": "parse"},
            {"name": "ResultEnrichment", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "enrich"},
            {"name": "Output", "type": "org.apache.nifi.processors.standard.LogAttribute", "role": "output"},
        ],
        "relationships": [
            {"from": "SearchRequest", "to": "IDOLFind", "relationship": "success"},
            {"from": "IDOLFind", "to": "ResponseParsing", "relationship": "Original"},
            {"from": "ResponseParsing", "to": "ResultEnrichment", "relationship": "matched"},
            {"from": "ResultEnrichment", "to": "Output", "relationship": "success"},
        ],
        "requiredIdolServices": ["Find", "Community"],
        "errorHandling": _error_std(),
    },
    "aci-command": {
        "id": "aci-command",
        "flowName": "IDOL ACI Command Flow",
        "purpose": "Generic NiFi pattern for executing allow-listed IDOL ACI commands.",
        "processors": [
            {"name": "InputRequest", "type": "org.apache.nifi.processors.standard.ListenHTTP", "role": "input"},
            {"name": "ACICommandBuilder", "type": "org.apache.nifi.processors.standard.ReplaceText", "role": "builder"},
            {"name": "IDOLACIRequest", "type": "org.apache.nifi.processors.standard.InvokeHTTP", "role": "aci"},
            {"name": "ResponseValidation", "type": "org.apache.nifi.processors.standard.ValidateXml", "role": "validate"},
            {"name": "Success", "type": "org.apache.nifi.processors.standard.LogAttribute", "role": "success"},
            {"name": "Failure", "type": "org.apache.nifi.processors.standard.LogAttribute", "role": "failure"},
        ],
        "relationships": [
            {"from": "InputRequest", "to": "ACICommandBuilder", "relationship": "success"},
            {"from": "ACICommandBuilder", "to": "IDOLACIRequest", "relationship": "success"},
            {"from": "IDOLACIRequest", "to": "ResponseValidation", "relationship": "Original"},
            {"from": "ResponseValidation", "to": "Success", "relationship": "valid"},
            {"from": "ResponseValidation", "to": "Failure", "relationship": "invalid"},
        ],
        "commandAllowList": ["GetStatus", "GetVersion", "Query", "GetContent", "IndexerGetStatus"],
        "unsafeConstruction": "blocked",
        "requiredIdolServices": ["Content"],
        "errorHandling": _error_std(),
    },
    "hot-folder": {
        "id": "hot-folder",
        "flowName": "IDOL Hot Folder Processing",
        "purpose": "Enterprise ingestion pipeline based on a monitored hot folder.",
        "processors": [
            {"name": "HotFolder", "type": "idol.nifi.connector.GetFileSystem", "role": "source"},
            {"name": "FileDetection", "type": "org.apache.nifi.processors.standard.UpdateAttribute", "role": "detect"},
            {"name": "DuplicateDetection", "type": "org.apache.nifi.processors.standard.DetectDuplicate", "role": "dedupe"},
            {"name": "MetadataExtraction", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "metadata"},
            {"name": "IDOLProcessing", "type": "idol.nifi.processor.KeyViewFilter", "role": "process"},
            {"name": "IDOLContent", "type": "idol.nifi.processor.PutIDOL", "role": "index"},
            {"name": "Archive", "type": "org.apache.nifi.processors.standard.PutFile", "role": "archive"},
            {"name": "Quarantine", "type": "org.apache.nifi.processors.standard.PutFile", "role": "quarantine"},
        ],
        "relationships": [
            {"from": "HotFolder", "to": "FileDetection", "relationship": "success"},
            {"from": "FileDetection", "to": "DuplicateDetection", "relationship": "success"},
            {"from": "DuplicateDetection", "to": "MetadataExtraction", "relationship": "non-duplicate"},
            {"from": "MetadataExtraction", "to": "IDOLProcessing", "relationship": "success"},
            {"from": "IDOLProcessing", "to": "IDOLContent", "relationship": "success"},
            {"from": "IDOLContent", "to": "Archive", "relationship": "success"},
            {"from": "DuplicateDetection", "to": "Quarantine", "relationship": "duplicate"},
            {"from": "IDOLProcessing", "to": "Quarantine", "relationship": "failure"},
        ],
        "requiredIdolServices": ["Content", "LicenseServer"],
        "errorHandling": _error_enterprise(),
    },
    "ai-llm-enrichment": {
        "id": "ai-llm-enrichment",
        "flowName": "IDOL AI / LLM Enrichment Pipeline",
        "purpose": "Combine IDOL processing with an optional local or remote LLM. No provider is hard-coded.",
        "processors": [
            {"name": "Document", "type": "idol.nifi.connector.GetFileSystem", "role": "source"},
            {"name": "IDOLContentExtraction", "type": "idol.nifi.processor.KeyViewFilter", "role": "extract"},
            {"name": "TextPreparation", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "prepare"},
            {"name": "LLMRequest", "type": "org.apache.nifi.processors.standard.InvokeHTTP", "role": "llm", "optional": True},
            {"name": "AIMetadata", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "ai-meta", "optional": True},
            {"name": "IDOLContentIndexing", "type": "idol.nifi.processor.PutIDOL", "role": "index"},
        ],
        "relationships": [
            {"from": "Document", "to": "IDOLContentExtraction", "relationship": "success"},
            {"from": "IDOLContentExtraction", "to": "TextPreparation", "relationship": "success"},
            {"from": "TextPreparation", "to": "LLMRequest", "relationship": "success"},
            {"from": "LLMRequest", "to": "AIMetadata", "relationship": "Original"},
            {"from": "AIMetadata", "to": "IDOLContentIndexing", "relationship": "success"},
        ],
        "llm": {
            "optional": True,
            "localEndpointEnv": "LLM_LOCAL_URL",
            "remoteEndpointEnv": "LLM_REMOTE_URL",
            "providerNotHardCoded": True,
        },
        "requiredIdolServices": ["Content", "LicenseServer"],
        "errorHandling": _error_std(),
    },
    "enterprise-ingestion": {
        "id": "enterprise-ingestion",
        "flowName": "IDOL Enterprise Ingestion With Error Recovery",
        "purpose": "Production-oriented ingestion pipeline with retry, DLQ, audit, and correlation.",
        "processors": [
            {"name": "Source", "type": "idol.nifi.connector.GetFileSystem", "role": "source"},
            {"name": "FileValidation", "type": "org.apache.nifi.processors.standard.ValidateRecord", "role": "validate"},
            {"name": "ContentExtraction", "type": "idol.nifi.processor.KeyViewFilter", "role": "extract"},
            {"name": "IDOLProcessing", "type": "idol.nifi.processor.Eduction", "role": "process"},
            {"name": "MetadataEnrichment", "type": "org.apache.nifi.processors.attributes.UpdateAttribute", "role": "enrich"},
            {"name": "IDOLContent", "type": "idol.nifi.processor.PutIDOL", "role": "index"},
            {"name": "Audit", "type": "org.apache.nifi.processors.standard.LogAttribute", "role": "audit"},
            {"name": "Retry", "type": "org.apache.nifi.processors.standard.ControlRate", "role": "retry"},
            {"name": "DeadLetterQueue", "type": "org.apache.nifi.processors.standard.PutFile", "role": "dlq"},
            {"name": "ErrorArchive", "type": "org.apache.nifi.processors.standard.PutFile", "role": "error-archive"},
        ],
        "relationships": [
            {"from": "Source", "to": "FileValidation", "relationship": "success"},
            {"from": "FileValidation", "to": "ContentExtraction", "relationship": "valid"},
            {"from": "ContentExtraction", "to": "IDOLProcessing", "relationship": "success"},
            {"from": "IDOLProcessing", "to": "MetadataEnrichment", "relationship": "success"},
            {"from": "MetadataEnrichment", "to": "IDOLContent", "relationship": "success"},
            {"from": "IDOLContent", "to": "Audit", "relationship": "success"},
            {"from": "FileValidation", "to": "Retry", "relationship": "invalid"},
            {"from": "ContentExtraction", "to": "Retry", "relationship": "failure"},
            {"from": "IDOLProcessing", "to": "Retry", "relationship": "failure"},
            {"from": "IDOLContent", "to": "Retry", "relationship": "failure"},
            {"from": "Retry", "to": "FileValidation", "relationship": "success"},
            {"from": "Retry", "to": "DeadLetterQueue", "relationship": "failure"},
            {"from": "DeadLetterQueue", "to": "ErrorArchive", "relationship": "success"},
        ],
        "requiredIdolServices": ["Content", "LicenseServer"],
        "errorHandling": _error_enterprise(),
    },
}


FLOW_ALIASES = {
    "content-ingestion": "content-ingestion",
    "ingestion": "content-ingestion",
    "ingest": "content-ingestion",
    "idol-file": "content-ingestion",
    "content-indexing-metadata": "content-indexing-metadata",
    "indexing": "content-indexing-metadata",
    "document-processing": "document-processing",
    "enrichment": "document-processing",
    "passage-extraction": "passage-extraction",
    "passage": "passage-extraction",
    "query-integration": "query-integration",
    "query": "query-integration",
    "find-search": "find-search",
    "find": "find-search",
    "aci-command": "aci-command",
    "aci": "aci-command",
    "hot-folder": "hot-folder",
    "hotfolder": "hot-folder",
    "ai-llm-enrichment": "ai-llm-enrichment",
    "ai": "ai-llm-enrichment",
    "llm": "ai-llm-enrichment",
    "idol-ai-python": "ai-llm-enrichment",
    "enterprise-ingestion": "enterprise-ingestion",
    "enterprise": "enterprise-ingestion",
}


def list_reference_flows() -> list[dict[str, Any]]:
    return [
        {
            "id": spec["id"],
            "flowName": spec["flowName"],
            "purpose": spec["purpose"],
            "processors": [p["name"] for p in spec["processors"]],
        }
        for spec in REFERENCE_FLOWS.values()
    ]


def get_reference_flow(flow_id: str | None) -> dict[str, Any]:
    key = FLOW_ALIASES.get((flow_id or "content-ingestion").lower(), flow_id or "content-ingestion")
    if key not in REFERENCE_FLOWS:
        known = ", ".join(sorted(REFERENCE_FLOWS))
        raise KeyError(f"Unknown reference flow '{flow_id}'. Known: {known}")
    return REFERENCE_FLOWS[key]


def materialize_flow(flow_id: str | None, resolution: Resolution) -> dict[str, Any]:
    spec = dict(get_reference_flow(flow_id))
    profile = resolution.profile
    spec["supportedVersions"] = {
        "idol": resolution.idol_version,
        "nifi": resolution.nifi_version,
        "nar": resolution.nar_version,
        "profile": profile.id if profile else None,
    }
    spec["requiredNars"] = [a.filename for a in resolution.selected_nars]
    spec["narCompatibility"] = resolution.as_dict()
    spec["controllerServices"] = _cs()
    spec["parameterContext"] = {"name": f"{spec['id']}-params", "parameters": _params()}
    spec["sensitiveProperties"] = list(SENSITIVE)
    spec["requiredEnvironmentVariables"] = _env()
    spec["exampleConfiguration"] = _example()
    spec["validationRules"] = _validation()
    spec["deploymentRequirements"] = _deploy()
    spec["flowDefinitionVersion"] = "1.0"
    return spec
