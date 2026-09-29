"""
tools/opentext_kd.py

Higher-level MCP tools that assemble whole OpenText Knowledge Discovery
ingestion/enrichment flows out of the low-level processor tools, so the
AI does not have to hand-wire every processor and connection for common
KD patterns (file share ingestion, SAP ingestion, metadata enrichment).

Each tool:
  1. Creates a process group to hold the flow.
  2. Creates and configures the processors for that pattern.
  3. Wires up the connections.
  4. Creates + assigns a parameter context for the configurable bits.
  5. Returns the group id plus a summary for the AI/UI to preview.

None of these tools starts the flow — that is a separate, explicit
start_flow call gated on user approval, per the recommended workflow.
"""

from __future__ import annotations

from nifi_client import NiFiClient

# Canonical NiFi processor types used by the KD patterns below.
GET_FILE = "org.apache.nifi.processors.standard.GetFile"
LIST_SFTP = "org.apache.nifi.processors.standard.ListSFTP"
EXTRACT_TEXT = "org.apache.nifi.processors.standard.ExtractText"
UPDATE_ATTRIBUTE = "org.apache.nifi.processors.attributes.UpdateAttribute"
ROUTE_ON_ATTRIBUTE = "org.apache.nifi.processors.standard.RouteOnAttribute"
INVOKE_HTTP = "org.apache.nifi.processors.standard.InvokeHTTP"
EXECUTE_SCRIPT = "org.apache.nifi.processors.script.ExecuteScript"


async def _wire_linear(client: NiFiClient, group_id: str, ordered_ids: list[str], relationship: str = "success") -> None:
    """Connect a list of processor ids in a straight line: 0->1->2->..."""
    for src, dst in zip(ordered_ids, ordered_ids[1:]):
        await client.create_connection(group_id, src, "PROCESSOR", dst, "PROCESSOR", [relationship])


def register(mcp, client: NiFiClient) -> None:
    @mcp.tool()
    async def create_kd_file_connector_flow(
        parent_group_id: str,
        flow_name: str,
        source_path: str,
        idol_host: str,
        idol_port: str = "9100",
        recursive: bool = True,
        file_filter: str = ".*\\.(pdf|docx?|xlsx?)",
    ) -> dict:
        """Build a NiFi flow that watches a local/mounted file share, extracts
        text, and posts each document to an OpenText IDOL Content engine.
        Returns the created process group id, parameter context id, and the
        processor ids created (not yet started)."""
        group = await client.create_process_group(parent_group_id, flow_name)
        group_id = group["component"]["id"]

        ctx = await client.create_parameter_context(
            f"{flow_name}-params",
            {
                "SOURCE_PATH": source_path,
                "FILE_FILTER": file_filter,
                "IDOL_HOST": idol_host,
                "IDOL_PORT": idol_port,
            },
        )
        await client.assign_parameter_context(group_id, ctx["component"]["id"])

        get_file = await client.create_processor(group_id, GET_FILE, "GetFile", {"x": 0, "y": 0})
        await client.update_processor_properties(
            get_file["component"]["id"],
            {"Input Directory": "#{SOURCE_PATH}", "Recurse Subdirectories": str(recursive), "File Filter": "#{FILE_FILTER}"},
        )

        extract_text = await client.create_processor(group_id, EXTRACT_TEXT, "ExtractText", {"x": 0, "y": 200})

        update_attr = await client.create_processor(group_id, UPDATE_ATTRIBUTE, "Map KD Metadata", {"x": 0, "y": 400})
        await client.update_processor_properties(
            update_attr["component"]["id"],
            {"kd.source": "file-share", "kd.index": flow_name},
        )

        send_to_idol = await client.create_processor(group_id, INVOKE_HTTP, "Send to IDOL Content", {"x": 0, "y": 600})
        await client.update_processor_properties(
            send_to_idol["component"]["id"],
            {
                "HTTP Method": "POST",
                "Remote URL": "http://#{IDOL_HOST}:#{IDOL_PORT}/action=index",
                "Content-Type": "application/octet-stream",
            },
        )

        ids = [
            get_file["component"]["id"],
            extract_text["component"]["id"],
            update_attr["component"]["id"],
            send_to_idol["component"]["id"],
        ]
        await _wire_linear(client, group_id, ids)

        return {
            "groupId": group_id,
            "parameterContextId": ctx["component"]["id"],
            "processorIds": ids,
            "summary": f"File-share -> ExtractText -> Metadata mapping -> IDOL Content ({source_path} -> {idol_host}:{idol_port})",
        }

    @mcp.tool()
    async def create_kd_sap_flow(
        parent_group_id: str,
        flow_name: str,
        sap_endpoint: str,
        repository: str,
        idol_host: str,
        idol_port: str = "9100",
    ) -> dict:
        """Build a NiFi flow that pulls documents from an SAP repository via
        InvokeHTTP against the SAP endpoint, maps metadata fields, and indexes
        into OpenText IDOL Content. Returns the created group/processor ids."""
        group = await client.create_process_group(parent_group_id, flow_name)
        group_id = group["component"]["id"]

        ctx = await client.create_parameter_context(
            f"{flow_name}-params",
            {
                "SAP_ENDPOINT": sap_endpoint,
                "SAP_REPOSITORY": repository,
                "IDOL_HOST": idol_host,
                "IDOL_PORT": idol_port,
            },
        )
        await client.assign_parameter_context(group_id, ctx["component"]["id"])

        fetch_sap = await client.create_processor(group_id, INVOKE_HTTP, "Fetch from SAP", {"x": 0, "y": 0})
        await client.update_processor_properties(
            fetch_sap["component"]["id"],
            {"HTTP Method": "GET", "Remote URL": "#{SAP_ENDPOINT}/#{SAP_REPOSITORY}"},
        )

        update_attr = await client.create_processor(group_id, UPDATE_ATTRIBUTE, "Map KD Metadata", {"x": 0, "y": 200})
        send_to_idol = await client.create_processor(group_id, INVOKE_HTTP, "Send to IDOL Content", {"x": 0, "y": 400})
        await client.update_processor_properties(
            send_to_idol["component"]["id"],
            {"HTTP Method": "POST", "Remote URL": "http://#{IDOL_HOST}:#{IDOL_PORT}/action=index"},
        )

        ids = [fetch_sap["component"]["id"], update_attr["component"]["id"], send_to_idol["component"]["id"]]
        await _wire_linear(client, group_id, ids)

        return {
            "groupId": group_id,
            "parameterContextId": ctx["component"]["id"],
            "processorIds": ids,
            "summary": f"SAP ({sap_endpoint}/{repository}) -> Metadata mapping -> IDOL Content ({idol_host}:{idol_port})",
        }

    @mcp.tool()
    async def create_kd_enrichment_flow(
        parent_group_id: str,
        flow_name: str,
        enrichment_script: str,
    ) -> dict:
        """Build a standalone enrichment stage (ExecuteScript) that can be
        inserted between an ingestion flow and an indexing flow to add
        KD-specific metadata (language detection, ACL mapping, etc.)."""
        group = await client.create_process_group(parent_group_id, flow_name)
        group_id = group["component"]["id"]

        route = await client.create_processor(group_id, ROUTE_ON_ATTRIBUTE, "Route by Document Type", {"x": 0, "y": 0})
        script = await client.create_processor(group_id, EXECUTE_SCRIPT, "KD Enrichment Script", {"x": 0, "y": 200})
        await client.update_processor_properties(
            script["component"]["id"],
            {"Script Engine": "Groovy", "Script Body": enrichment_script},
        )

        ids = [route["component"]["id"], script["component"]["id"]]
        await _wire_linear(client, group_id, ids)

        return {
            "groupId": group_id,
            "processorIds": ids,
            "summary": "Route by document type -> KD enrichment script",
        }
