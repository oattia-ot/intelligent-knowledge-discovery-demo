"""MCP tools for OpenText Knowledge Discovery 26.3.

Registered alongside existing NiFi / NAR tools. Does not replace them.
"""

from __future__ import annotations

from typing import Any

from kd.service import KnowledgeDiscoveryService


def _svc() -> KnowledgeDiscoveryService:
    return KnowledgeDiscoveryService()


def register(mcp, client: Any = None) -> None:
    """Register KD tools on a FastMCP instance. `client` is unused but kept
    so the register(mcp, nifi) signature matches sibling tool modules."""

    @mcp.tool()
    async def kd_list_skills() -> dict:
        """List Knowledge Discovery MCP skills, components, versions, and examples."""
        return _svc().list_skills()

    @mcp.tool()
    async def kd_list_capabilities(version: str = "26.3") -> dict:
        """List documented Knowledge Discovery APIs available in the requested version."""
        return _svc().list_apis(version)

    @mcp.tool()
    async def kd_find_api(task: str, version: str | None = None) -> dict:
        """Map a natural-language task to the correct KD component, action, tool, and skill."""
        return _svc().find_api(task, version)

    @mcp.tool()
    async def kd_resolve_version(version: str | None = None) -> dict:
        """Resolve a Knowledge Discovery version string and return 26.3 deltas when applicable."""
        return _svc().resolve_version(version)

    @mcp.tool()
    async def kd_discover_components() -> dict:
        """Show configured KD component endpoints (hosts/ports, no secrets)."""
        return _svc().list_components()

    @mcp.tool()
    async def kd_component_health(component: str) -> dict:
        """Call GetStatus (and GetVersion) on a configured ACI component."""
        return _svc().client.health(component)

    @mcp.tool()
    async def kd_component_version(component: str) -> dict:
        """Call GetVersion on a configured ACI component."""
        return _svc().invoke(component=component, action="GetVersion")

    @mcp.tool()
    async def kd_license_status(component: str = "LicenseServer") -> dict:
        """Call GetLicenseInfo on License Server or another ACI component."""
        return _svc().invoke(component=component, action="GetLicenseInfo")

    @mcp.tool()
    async def kd_list_component_actions(component: str) -> dict:
        """Call GetAllActions so the live server lists the actions it actually supports."""
        return _svc().invoke(component=component, action="GetAllActions")

    @mcp.tool()
    async def kd_describe_capability(capabilityId: str) -> dict:
        """Return registry metadata for one capability, including the official documentation URL."""
        return _svc().describe_capability(capabilityId)

    @mcp.tool()
    async def kd_aci_action(
        component: str,
        action: str,
        params: dict[str, Any] | None = None,
        version: str | None = None,
        confirm: bool = False,
        dryRun: bool = False,
    ) -> dict:
        """Controlled escape-hatch ACI call. Only documented registry actions should be used.
        Destructive actions require confirm=true. Hosts are limited to configured components."""
        cap = _svc().registry.by_action(component, action)
        return _svc().invoke(
            cap.id if cap else None,
            component=component,
            action=action,
            params=params,
            version=version,
            confirm=confirm,
            dry_run=dryRun,
        )

    # ----- Content search / retrieve -----

    @mcp.tool()
    async def kd_content_query(
        text: str | None = None,
        fieldText: str | None = None,
        databaseMatch: str | None = None,
        maxResults: int = 10,
        start: int = 1,
        printMode: str = "fields",
        printFields: str | None = None,
        highlight: bool = False,
        summary: str | None = None,
        securityInfo: str | None = None,
        combine: str | None = None,
        minScore: int | None = None,
        sort: str | None = None,
        querySummary: bool = False,
        version: str | None = None,
    ) -> dict:
        """Search IDOL Content (action=Query). Supports conceptual, Boolean, fielded, and NL text."""
        params: dict[str, Any] = {
            "Text": text,
            "FieldText": fieldText,
            "DatabaseMatch": databaseMatch,
            "MaxResults": maxResults,
            "Start": start,
            "Print": printMode,
            "PrintFields": printFields,
            "Highlight": highlight or None,
            "Summary": summary,
            "SecurityInfo": securityInfo,
            "Combine": combine,
            "MinScore": minScore,
            "Sort": sort,
            "QuerySummary": querySummary or None,
        }
        return _svc().invoke("content.query", params=params, version=version)

    @mcp.tool()
    async def kd_content_get(
        documentId: str | None = None,
        reference: str | None = None,
        printMode: str = "all",
        printFields: str | None = None,
        securityInfo: str | None = None,
        version: str | None = None,
    ) -> dict:
        """Retrieve a document from Content (action=GetContent) by ID or Reference."""
        return _svc().invoke(
            "content.getcontent",
            params={
                "ID": documentId,
                "Reference": reference,
                "Print": printMode,
                "PrintFields": printFields,
                "SecurityInfo": securityInfo,
            },
            version=version,
        )

    @mcp.tool()
    async def kd_content_suggest(
        documentId: str | None = None,
        reference: str | None = None,
        maxResults: int = 10,
        useVectors: bool | None = None,
        securityInfo: str | None = None,
        version: str | None = None,
    ) -> dict:
        """Find similar documents (action=Suggest). On 26.3 DAH/Content, UseVectors is documented."""
        return _svc().invoke(
            "content.suggest",
            params={
                "ID": documentId,
                "Reference": reference,
                "MaxResults": maxResults,
                "UseVectors": useVectors,
                "SecurityInfo": securityInfo,
            },
            version=version,
        )

    @mcp.tool()
    async def kd_content_suggest_on_text(
        text: str,
        maxResults: int = 10,
        useVectors: bool | None = None,
        securityInfo: str | None = None,
        version: str | None = None,
    ) -> dict:
        """Suggest documents related to free text (action=SuggestOnText)."""
        return _svc().invoke(
            "content.suggestontext",
            params={"Text": text, "MaxResults": maxResults, "UseVectors": useVectors, "SecurityInfo": securityInfo},
            version=version,
        )

    @mcp.tool()
    async def kd_content_highlight(text: str, highlightText: str, startTag: str = "<b>", endTag: str = "</b>") -> dict:
        """Highlight terms in text (action=Highlight)."""
        return _svc().invoke(
            "content.highlight",
            params={"Text": text, "HighlightText": highlightText, "StartTag": startTag, "EndTag": endTag},
        )

    @mcp.tool()
    async def kd_content_summarize(
        text: str | None = None,
        documentId: str | None = None,
        reference: str | None = None,
        summary: str = "Context",
        sentences: int | None = None,
    ) -> dict:
        """Summarize text or a stored document (action=Summarize)."""
        return _svc().invoke(
            "content.summarize",
            params={"Text": text, "ID": documentId, "Reference": reference, "Summary": summary, "Sentences": sentences},
        )

    @mcp.tool()
    async def kd_content_term_get_best(
        text: str | None = None,
        documentId: str | None = None,
        maxTerms: int = 20,
        useVectors: bool | None = None,
        version: str | None = None,
    ) -> dict:
        """Return best terms (and vectors when UseVectors is set on 26.3) via TermGetBest."""
        return _svc().invoke(
            "content.termgetbest",
            params={"Text": text, "ID": documentId, "MaxTerms": maxTerms, "UseVectors": useVectors},
            version=version,
        )

    @mcp.tool()
    async def kd_content_term_expand(text: str, fieldText: str | None = None, maxTerms: int = 20) -> dict:
        """Expand query terms (action=TermExpand). FieldText restricts expansion the same way as Query."""
        return _svc().invoke("content.termexpand", params={"Text": text, "FieldText": fieldText, "MaxTerms": maxTerms})

    @mcp.tool()
    async def kd_content_parametric(
        fieldName: str,
        text: str | None = None,
        fieldText: str | None = None,
        databaseMatch: str | None = None,
        maxValues: int = 50,
        securityInfo: str | None = None,
    ) -> dict:
        """Parametric values for a field (action=GetQueryTagValues)."""
        return _svc().invoke(
            "content.getquerytagvalues",
            params={
                "FieldName": fieldName,
                "Text": text,
                "FieldText": fieldText,
                "DatabaseMatch": databaseMatch,
                "MaxValues": maxValues,
                "SecurityInfo": securityInfo,
            },
        )

    @mcp.tool()
    async def kd_content_index_status() -> dict:
        """Index document statistics (action=DocumentStats)."""
        return _svc().invoke("content.documentstats")

    @mcp.tool()
    async def kd_content_index_data(
        idxBody: str,
        dreDbName: str | None = None,
        confirm: bool = False,
    ) -> dict:
        """Index IDX/XML payload via DREADDDATA on the Content index port (SAFE_WRITE)."""
        return _svc().invoke(
            "content.dreadddata",
            params={"DREDbName": dreDbName},
            body=idxBody,
            confirm=confirm,
        )

    @mcp.tool()
    async def kd_content_index_file(fileName: str, dreDbName: str | None = None) -> dict:
        """Index a server-side file via DREADD. FileName is a path the Content server can read."""
        return _svc().invoke("content.dreadd", params={"FileName": fileName, "DREDbName": dreDbName})

    @mcp.tool()
    async def kd_content_delete(
        docs: str,
        byReference: bool = False,
        confirm: bool = False,
    ) -> dict:
        """Delete documents by ID (DREDELETEDOC) or reference (DREDELETEREF). Requires confirm=true."""
        cap = "content.dredeleteref" if byReference else "content.dredeletedoc"
        return _svc().invoke(cap, params={"Docs": docs}, confirm=confirm)

    @mcp.tool()
    async def kd_content_replace_fields(idxBody: str, databaseMatch: str | None = None) -> dict:
        """Change field values with DREREPLACE (POST body)."""
        return _svc().invoke("content.drereplace", params={"DatabaseMatch": databaseMatch}, body=idxBody)

    @mcp.tool()
    async def kd_content_sync() -> dict:
        """Flush the Content index cache (DRESYNC)."""
        return _svc().invoke("content.dresync")

    @mcp.tool()
    async def kd_content_compact(confirm: bool = False) -> dict:
        """Compact the Content index (DRECOMPACT). Destructive-class; requires confirm=true."""
        return _svc().invoke("content.drecompact", confirm=confirm)

    @mcp.tool()
    async def kd_content_initialize(confirm: bool = False) -> dict:
        """Reset the Content index (DREINITIAL). DESTRUCTIVE; requires confirm=true."""
        return _svc().invoke("content.dreinitial", confirm=confirm)

    @mcp.tool()
    async def kd_content_create_database(dreDbName: str) -> dict:
        """Create a Content database (DRECREATEDBASE)."""
        return _svc().invoke("content.drecreatedbase", params={"DREDbName": dreDbName})

    @mcp.tool()
    async def kd_content_delete_database(dreDbName: str, confirm: bool = False) -> dict:
        """Delete a Content database (DREDELDBASE). DESTRUCTIVE; requires confirm=true."""
        return _svc().invoke("content.dredeldbase", params={"DREDbName": dreDbName}, confirm=confirm)

    # ----- Other ACI components -----

    @mcp.tool()
    async def kd_dah_query(text: str, maxResults: int = 10, securityInfo: str | None = None) -> dict:
        """Distributed query through DAH."""
        return _svc().invoke("dah.query", params={"Text": text, "MaxResults": maxResults, "SecurityInfo": securityInfo})

    @mcp.tool()
    async def kd_dah_suggest(
        documentId: str | None = None,
        reference: str | None = None,
        useVectors: bool | None = None,
        maxResults: int = 10,
        version: str = "26.3",
    ) -> dict:
        """DAH Suggest. UseVectors is documented for Knowledge Discovery 26.3."""
        return _svc().invoke(
            "dah.suggest",
            params={"ID": documentId, "Reference": reference, "UseVectors": useVectors, "MaxResults": maxResults},
            version=version,
        )

    @mcp.tool()
    async def kd_qms_query(text: str, maxResults: int = 10, securityInfo: str | None = None) -> dict:
        """Query via Query Manipulation Server."""
        return _svc().invoke("qms.query", params={"Text": text, "MaxResults": maxResults, "SecurityInfo": securityInfo})

    @mcp.tool()
    async def kd_view_document(reference: str, highlight: str | None = None) -> dict:
        """Render a document through the View component."""
        return _svc().invoke("view.view", params={"Reference": reference, "Highlight": highlight})

    @mcp.tool()
    async def kd_agentstore_query(text: str, maxResults: int = 10) -> dict:
        """Query Agentstore for agents/profiles/categories."""
        return _svc().invoke("agentstore.query", params={"Text": text, "MaxResults": maxResults})

    @mcp.tool()
    async def kd_dih_index_data(idxBody: str, dreDbName: str | None = None) -> dict:
        """Index through DIH (DREADDDATA)."""
        return _svc().invoke("dih.dreadddata", params={"DREDbName": dreDbName}, body=idxBody)

    # ----- Category / Eduction / Security -----

    @mcp.tool()
    async def kd_category_suggest_from_text(queryText: str, numResults: int = 5) -> dict:
        """Classify text against trained categories (CategorySuggestFromText)."""
        return _svc().invoke(
            "category.suggestfromtext",
            params={"QueryText": queryText, "NumResults": numResults},
        )

    @mcp.tool()
    async def kd_category_list(parent: str | None = None) -> dict:
        """List categories (CategoryList)."""
        return _svc().invoke("category.list", params={"Parent": parent})

    @mcp.tool()
    async def kd_category_get_details(category: str) -> dict:
        """CategoryGetDetails."""
        return _svc().invoke("category.getdetails", params={"Category": category})

    @mcp.tool()
    async def kd_category_create(name: str, parent: str | None = None) -> dict:
        """Create a category (SAFE_WRITE)."""
        return _svc().invoke("category.create", params={"Name": name, "Parent": parent})

    @mcp.tool()
    async def kd_category_delete(category: str, confirm: bool = False) -> dict:
        """Delete a category. DESTRUCTIVE; requires confirm=true."""
        return _svc().invoke("category.delete", params={"Category": category}, confirm=confirm)

    @mcp.tool()
    async def kd_educe_text(text: str, grammars: str | None = None, entities: str | None = None, version: str | None = None) -> dict:
        """Extract entities / PII from text (EduceFromText). 26.3 adds Saudi PII and ITAR grammars."""
        return _svc().invoke(
            "eduction.educefromtext",
            params={"Text": text, "Grammars": grammars, "Entities": entities},
            version=version,
        )

    @mcp.tool()
    async def kd_educe_file(fileName: str, grammars: str | None = None) -> dict:
        """Extract entities from a server-side file (EduceFromFile)."""
        return _svc().invoke("eduction.educefromfile", params={"FileName": fileName, "Grammars": grammars})

    @mcp.tool()
    async def kd_security_info(userName: str, password: str | None = None, repository: str | None = None) -> dict:
        """Request Community security information for query-time document security."""
        return _svc().invoke(
            "community.security",
            params={"UserName": userName, "Password": password, "Repository": repository},
        )

    @mcp.tool()
    async def kd_community_user_read(userName: str) -> dict:
        """Read a Community user (OTDS-backed deployments use OTDSUserField in 26.3)."""
        return _svc().invoke("community.userread", params={"UserName": userName})

    # ----- Media -----

    @mcp.tool()
    async def kd_media_process(
        sourcePath: str | None = None,
        sourceUrl: str | None = None,
        config: str | None = None,
        configName: str | None = None,
        persist: bool | None = None,
        version: str | None = None,
    ) -> dict:
        """Run Media Server action=Process. Supply a server-readable SourcePath/SourceURL and config."""
        return _svc().invoke(
            "media.process",
            params={
                "SourcePath": sourcePath,
                "SourceURL": sourceUrl,
                "Config": config,
                "ConfigName": configName,
                "Persist": persist,
                "Source": "file" if sourcePath else ("curl" if sourceUrl else None),
            },
            version=version,
        )

    @mcp.tool()
    async def kd_media_queue_info(token: str | None = None, queueAction: str = "GetStatus") -> dict:
        """Inspect Media Server asynchronous process queue (QueueInfo)."""
        return _svc().invoke("media.queueinfo", params={"Token": token, "QueueAction": queueAction})

    @mcp.tool()
    async def kd_media_ocr(
        sourcePath: str | None = None,
        sourceUrl: str | None = None,
        languages: str = "en",
        ocrMode: str = "document",
        config: str | None = None,
        version: str = "26.3",
    ) -> dict:
        """OCR via Media Server Process. 26.3 adds hy, az, ka, id, kk, ms, mn, tg, uz."""
        cfg = config or f"[OCR]\nType=ocr\nOcrMode={ocrMode}\nLanguages={languages}\n"
        return _svc().invoke(
            "media.ocr",
            params={"SourcePath": sourcePath, "SourceURL": sourceUrl, "Languages": languages, "OcrMode": ocrMode, "Config": cfg},
            version=version,
        )

    @mcp.tool()
    async def kd_media_speech_to_text(
        sourcePath: str | None = None,
        sourceUrl: str | None = None,
        languagePack: str = "ENUK",
        modelSize: str | None = None,
        config: str | None = None,
        version: str = "26.3",
    ) -> dict:
        """Speech-to-text via Media Server. In 26.3 Medium and Large resolve to one combined model."""
        note = _svc().speech_guard(version, modelSize)
        cfg = config or _speech_config(languagePack, modelSize)
        result = _svc().invoke(
            "media.speech",
            params={
                "SourcePath": sourcePath,
                "SourceURL": sourceUrl,
                "LanguagePack": languagePack,
                "ModelSize": modelSize,
                "Config": cfg,
            },
            version=version,
        )
        if note:
            result["versionNote"] = note
        return result

    @mcp.tool()
    async def kd_media_face_detect(sourcePath: str | None = None, sourceUrl: str | None = None, config: str | None = None) -> dict:
        """Face detection via Media Server Process (Visual channel license required)."""
        cfg = config or "[FaceDetect]\nType=FaceDetect\n"
        return _svc().invoke("media.face_detect", params={"SourcePath": sourcePath, "SourceURL": sourceUrl, "Config": cfg})

    @mcp.tool()
    async def kd_media_object_recognize(sourcePath: str | None = None, sourceUrl: str | None = None, config: str | None = None) -> dict:
        """Object recognition via Media Server Process."""
        cfg = config or "[Object]\nType=ObjectRecognition\n"
        return _svc().invoke("media.object", params={"SourcePath": sourcePath, "SourceURL": sourceUrl, "Config": cfg})

    @mcp.tool()
    async def kd_media_number_plate(sourcePath: str | None = None, sourceUrl: str | None = None, region: str | None = None) -> dict:
        """Number-plate recognition via Media Server Process."""
        cfg = "[NumberPlate]\nType=NumberPlate\n"
        if region:
            cfg += f"Region={region}\n"
        return _svc().invoke(
            "media.numberplate",
            params={"SourcePath": sourcePath, "SourceURL": sourceUrl, "Region": region, "Config": cfg},
        )

    @mcp.tool()
    async def kd_media_image_description(sourcePath: str | None = None, sourceUrl: str | None = None, version: str = "26.3") -> dict:
        """LLM image/video-frame description. Documented from Media Server 26.2 onward."""
        cfg = "[ImageDescription]\nType=ImageDescription\n"
        return _svc().invoke(
            "media.image_description",
            params={"SourcePath": sourcePath, "SourceURL": sourceUrl, "Config": cfg},
            version=version,
        )

    @mcp.tool()
    async def kd_media_build_object_class(identifier: str, version: str = "26.3") -> dict:
        """Train an object-class recognizer (BuildObjectClassRecognizer), restored in 26.2."""
        return _svc().invoke("media.build_object_class", params={"Identifier": identifier}, version=version)

    # ----- Ingest / FCE -----

    @mcp.tool()
    async def kd_connector_synchronize(identifier: str | None = None, configSection: str | None = None) -> dict:
        """Start connector/CFS Synchronize."""
        return _svc().invoke("cfs.synchronize", params={"Identifier": identifier, "ConfigSection": configSection})

    @mcp.tool()
    async def kd_connector_collect(identifier: str | None = None) -> dict:
        """Connector/CFS Collect."""
        return _svc().invoke("cfs.collect", params={"Identifier": identifier})

    @mcp.tool()
    async def kd_connector_queue_info(token: str | None = None, queueAction: str = "GetStatus") -> dict:
        """CFS QueueInfo."""
        return _svc().invoke("cfs.queueinfo", params={"Token": token, "QueueAction": queueAction})

    @mcp.tool()
    async def kd_fce_describe(version: str = "26.3") -> dict:
        """Describe File Content Extraction 26.3 capabilities (C2PA, formats, source-code module).
        FCE is not a standalone ACI server; use CFS or NiFi KeyViewFilter to execute extraction."""
        cap = _svc().describe_capability("fce.keyview_filter")
        resolved = _svc().resolve_version(version)
        return {
            "capability": cap,
            "version": resolved,
            "execution": [
                "NiFi processor idol.nifi.processor.KeyViewFilter (version-matched NAR)",
                "Connector Framework Server import tasks using File Content Extraction",
            ],
            "documentation": cap["documentation"],
        }

    # ----- Workflows -----

    @mcp.tool()
    async def kd_list_connectors(name: str | None = None) -> dict:
        """List official Knowledge Discovery 26.3 connectors and their shared CFS actions."""
        from kd.connectors import list_connectors

        return list_connectors(name)

    @mcp.tool()
    async def kd_answer_ask(text: str, systemName: str | None = None, customizationData: str | None = None) -> dict:
        """Ask Answer Server (action=Ask). SystemName selects the configured answer system."""
        return _svc().invoke(
            "answer.ask",
            params={"Text": text, "SystemName": systemName, "CustomizationData": customizationData},
        )

    @mcp.tool()
    async def kd_answer_get_resources(resourceType: str = "schema", systemName: str | None = None, ids: str | None = None) -> dict:
        """Answer Server GetResources (question, schema, question_suggestion, ...)."""
        return _svc().invoke(
            "answer.getresources",
            params={"Type": resourceType, "SystemName": systemName, "IDs": ids},
        )

    @mcp.tool()
    async def kd_answer_converse(text: str, systemName: str | None = None, session: str | None = None) -> dict:
        """Answer Server Converse for multi-turn systems."""
        return _svc().invoke("answer.converse", params={"Text": text, "SystemName": systemName, "Session": session})

    @mcp.tool()
    async def kd_answer_job_status(token: str | None = None) -> dict:
        """Answer Server GetJobStatus."""
        return _svc().invoke("answer.getjobstatus", params={"Token": token})

    @mcp.tool()
    async def kd_kg_get_neighbors(sourceNames: str, maxResults: int = 10) -> dict:
        """Knowledge Graph GetNeighbors."""
        return _svc().invoke("kg.getneighbors", params={"SourceNames": sourceNames, "MaxResults": maxResults})

    @mcp.tool()
    async def kd_kg_get_neighborhood(sourceNames: str, maxResults: int = 15) -> dict:
        """Knowledge Graph GetNeighborhood."""
        return _svc().invoke("kg.getneighborhood", params={"SourceNames": sourceNames, "MaxResults": maxResults})

    @mcp.tool()
    async def kd_kg_get_common_neighbors(sourceNames: str, maxResults: int = 10) -> dict:
        """Knowledge Graph GetCommonNeighbors."""
        return _svc().invoke("kg.getcommonneighbors", params={"SourceNames": sourceNames, "MaxResults": maxResults})

    @mcp.tool()
    async def kd_kg_get_shortest_path(sourceName: str, targetName: str, method: str | None = None) -> dict:
        """Knowledge Graph GetShortestPath."""
        return _svc().invoke(
            "kg.getshortestpath",
            params={"SourceName": sourceName, "TargetName": targetName, "Method": method},
        )

    @mcp.tool()
    async def kd_kg_get_subgraph(nodeIds: str) -> dict:
        """Knowledge Graph GetSubgraph."""
        return _svc().invoke("kg.getsubgraph", params={"NodeIDs": nodeIds})

    @mcp.tool()
    async def kd_kg_suggest_links(nodeName: str) -> dict:
        """Knowledge Graph SuggestLinks."""
        return _svc().invoke("kg.suggestlinks", params={"NodeName": nodeName})

    @mcp.tool()
    async def kd_kg_get_nodes(sort: str = "None") -> dict:
        """Knowledge Graph GetNodes."""
        return _svc().invoke("kg.getnodes", params={"Sort": sort})

    @mcp.tool()
    async def kd_kg_summarize() -> dict:
        """Knowledge Graph SummarizeGraph."""
        return _svc().invoke("kg.summarizegraph")

    @mcp.tool()
    async def kd_media_train_face(
        identifier: str | None = None,
        database: str | None = None,
        imagePath: str | None = None,
        label: str | None = None,
    ) -> dict:
        """Train Media Server to recognize a face (TrainFace). ImagePath must be readable by Media Server."""
        return _svc().invoke(
            "media.trainface",
            params={"Identifier": identifier, "Database": database, "ImagePath": imagePath, "Label": label},
        )

    @mcp.tool()
    async def kd_media_list_faces(database: str | None = None, metadata: bool = True) -> dict:
        """List trained faces (ListFaces)."""
        return _svc().invoke("media.listfaces", params={"Database": database, "Metadata": metadata})

    @mcp.tool()
    async def kd_media_list_face_databases() -> dict:
        """List face databases (ListFaceDatabases)."""
        return _svc().invoke("media.listfacedatabases")

    @mcp.tool()
    async def kd_media_remove_face(identifier: str, database: str | None = None, confirm: bool = False) -> dict:
        """Remove a trained face. DESTRUCTIVE; requires confirm=true."""
        return _svc().invoke("media.removeface", params={"Identifier": identifier, "Database": database}, confirm=confirm)

    @mcp.tool()
    async def kd_media_build_face(identifier: str, database: str | None = None) -> dict:
        """Finish face training (BuildFace)."""
        return _svc().invoke("media.buildface", params={"Identifier": identifier, "Database": database})

    @mcp.tool()
    async def kd_media_list_speakers(database: str | None = None, version: str = "26.3") -> dict:
        """List speaker-ID records. 26.2+ response format changed with the new algorithm."""
        return _svc().invoke("media.listspeakers", params={"Database": database}, version=version)

    @mcp.tool()
    async def kd_security_decrypt(securityInfo: str) -> dict:
        """Decrypt a SecurityInfo token via Community UserDecryptSecurityInfo (admin/troubleshooting)."""
        return _svc().invoke("community.userdecryptsecurityinfo", params={"SecurityInfo": securityInfo})

    @mcp.tool()
    async def kd_community_user_delete(userName: str, confirm: bool = False) -> dict:
        """Delete a Community user. DESTRUCTIVE; requires confirm=true."""
        return _svc().invoke("community.userdelete", params={"UserName": userName}, confirm=confirm)

    @mcp.tool()
    async def kd_ogs_get_all_users(repository: str | None = None) -> dict:
        """List users known to OmniGroupServer (GetAllUsers)."""
        return _svc().invoke("ogs.getallusers", params={"Repository": repository})

    @mcp.tool()
    async def kd_component_children(component: str = "Content") -> dict:
        """GetChildren for an ACI component (distributed child list)."""
        return _svc().invoke(component=component, action="GetChildren")

    @mcp.tool()
    async def kd_workflow_ask(text: str, systemName: str | None = None) -> dict:
        """Expert workflow: Answer Server Ask."""
        return {"workflow": "answer_question", "result": _svc().invoke("answer.ask", params={"Text": text, "SystemName": systemName})}

    @mcp.tool()
    async def kd_workflow_graph(sourceNames: str, maxResults: int = 10) -> dict:
        """Expert workflow: summarize graph then list neighbors."""
        service = _svc()
        return {
            "workflow": "knowledge_graph_explore",
            "summary": service.invoke("kg.summarizegraph"),
            "neighbors": service.invoke("kg.getneighbors", params={"SourceNames": sourceNames, "MaxResults": maxResults}),
        }

    @mcp.tool()
    async def kd_workflow_plan(workflowId: str, version: str | None = None) -> dict:
        """Return the tool sequence for a named expert workflow without executing writes."""
        workflows = {item["id"]: item for item in _svc().registry.workflows()}
        item = workflows.get(workflowId)
        if item is None:
            return {"ok": False, "knownWorkflows": sorted(workflows), "error": f"Unknown workflow '{workflowId}'"}
        return {"ok": True, "version": _svc().resolve_version(version), **item}

    @mcp.tool()
    async def kd_workflow_enterprise_search(
        text: str,
        securityInfo: str | None = None,
        maxResults: int = 10,
        summarize: bool = False,
        extractEntities: bool = False,
        version: str | None = None,
    ) -> dict:
        """Orchestrate Content search plus optional summary and Eduction."""
        service = _svc()
        search = service.invoke(
            "content.query",
            params={"Text": text, "MaxResults": maxResults, "SecurityInfo": securityInfo, "Print": "fields"},
            version=version,
        )
        extra: dict[str, Any] = {}
        if summarize:
            extra["summary"] = service.invoke("content.summarize", params={"Text": text})
        if extractEntities:
            extra["entities"] = service.invoke("eduction.educefromtext", params={"Text": text}, version=version)
        return {"workflow": "enterprise_document_search", "search": search, **extra}

    @mcp.tool()
    async def kd_workflow_secure_search(userName: str, text: str, maxResults: int = 10) -> dict:
        """Obtain SecurityInfo then run a Content query with it."""
        service = _svc()
        token = service.invoke("community.security", params={"UserName": userName})
        security = None
        try:
            security = _extract_security(token)
        except Exception:
            security = None
        query = service.invoke(
            "content.query",
            params={"Text": text, "MaxResults": maxResults, "SecurityInfo": security},
        )
        return {"workflow": "secure_enterprise_search", "securityResponse": token, "search": query}

    @mcp.tool()
    async def kd_workflow_pii(text: str, grammars: str | None = None, version: str = "26.3") -> dict:
        """PII / sensitive-data discovery via Eduction."""
        return {
            "workflow": "pii_discovery",
            "version": _svc().resolve_version(version),
            "result": _svc().invoke("eduction.educefromtext", params={"Text": text, "Grammars": grammars}, version=version),
        }

    @mcp.tool()
    async def kd_workflow_media_analysis(
        sourcePath: str,
        includeOcr: bool = True,
        includeSpeech: bool = False,
        includeFaces: bool = False,
        version: str = "26.3",
    ) -> dict:
        """Plan + optionally submit a combined Media Server Process configuration."""
        sections = []
        if includeOcr:
            sections.append("[OCR]\nType=ocr\nOcrMode=document\nLanguages=en\n")
        if includeSpeech:
            sections.append("[Speech]\nType=SpeechToText\nLanguagePack=ENUK\n")
        if includeFaces:
            sections.append("[FaceDetect]\nType=FaceDetect\n")
        config = "\n".join(sections) if sections else None
        submitted = _svc().invoke(
            "media.process",
            params={"SourcePath": sourcePath, "Source": "file", "Config": config},
            version=version,
        )
        return {"workflow": "rich_media_analysis", "config": config, "submitted": submitted}

    @mcp.tool()
    async def kd_workflow_nifi_ingest(
        prompt: str,
        idolVersion: str = "26.3",
        nifiVersion: str = "26.3",
    ) -> dict:
        """Resolve the matching NAR profile and generate an IDOL NiFi flow (reuses existing NAR service)."""
        from nar.service import IdolNarService

        nar = IdolNarService()
        resolved = nar.resolve_nars(idol_version=idolVersion, nifi_version=nifiVersion, prompt=prompt)
        generated = None
        if resolved.get("status") == "PASS":
            generated = nar.generate_flow(prompt=prompt, idol_version=idolVersion, nifi_version=nifiVersion)
        return {
            "workflow": "nifi_ingest_generation",
            "narResolution": resolved,
            "flow": generated,
        }

    @mcp.tool()
    async def kd_workflow_troubleshoot(component: str, version: str | None = None) -> dict:
        """Health + version + license probe for one component."""
        service = _svc()
        return {
            "workflow": "troubleshooting",
            "requestedVersion": service.resolve_version(version),
            "endpoint": service.config.components.get(component).as_dict() if component in service.config.components else None,
            "health": _safe(lambda: service.client.health(component)),
            "license": _safe(lambda: service.invoke(component=component, action="GetLicenseInfo")),
        }


def _speech_config(language_pack: str, model_size: str | None) -> str:
    lines = ["[SpeechToText]", "Type=SpeechToText", f"LanguagePack={language_pack}"]
    if model_size:
        lines.append(f"ModelSize={model_size}")
    return "\n".join(lines) + "\n"


def _extract_security(payload: dict[str, Any]) -> str | None:
    blob = str(payload)
    for key in ("SecurityInfo", "securityinfo", "autn:securityinfo"):
        if key in blob.lower():
            break
    response = payload.get("response") if isinstance(payload, dict) else None
    if isinstance(response, dict):
        for candidate in _walk_strings(response):
            if len(candidate) > 20 and " " not in candidate[:10]:
                return candidate
    return None


def _walk_strings(node: Any):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _walk_strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk_strings(value)


def _safe(fn):
    try:
        return fn()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
