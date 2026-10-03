"""Unit tests for the Knowledge Discovery MCP layer (no live KD servers)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from kd.catalog import build_capabilities
from kd.client import AciClient
from kd.config import KdConfig
from kd.errors import CapabilityError, ConfirmationRequired, ParameterError, VersionError
from kd.mapping import map_task
from kd.registry import CapabilityRegistry
from kd.safety import classify, require_confirmation
from kd.service import KnowledgeDiscoveryService
from kd.versions import parse_product_version, resolve_version, speech_model_note


class VersionTests(unittest.TestCase):
    def test_parse_26_3(self):
        self.assertEqual(parse_product_version("26.3").train, "26.3")
        self.assertEqual(parse_product_version("26.3.0").dotted, "26.3.0")

    def test_invalid(self):
        with self.assertRaises(VersionError):
            parse_product_version("idol")

    def test_resolve_target(self):
        resolved = resolve_version("26.3")
        self.assertEqual(resolved.status, "supported")
        self.assertTrue(resolved.target_is_26_3)
        ids = {d["id"] for d in resolved.deltas}
        self.assertIn("media.speech.medium_large_merged", ids)
        self.assertIn("content.suggest.use_vectors", ids)

    def test_speech_26_3_medium_merged(self):
        note = speech_model_note("26.3", "Medium")
        self.assertIsNotNone(note)
        self.assertIn("combined", note["warning"].lower())

    def test_speech_legacy_removed(self):
        note = speech_model_note("26.2", "legacy")
        self.assertTrue(note and note.get("error"))


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.registry = CapabilityRegistry()

    def test_has_core_content_actions(self):
        ids = {c.id for c in self.registry.all()}
        for needed in (
            "content.query",
            "content.getcontent",
            "content.suggest",
            "content.dreadddata",
            "content.dreinitial",
            "eduction.educefromtext",
            "media.ocr",
            "media.speech",
            "media.image_description",
            "dah.suggest",
            "fce.keyview_filter",
            "nifi.putidol",
            "answer.ask",
            "kg.getneighbors",
            "media.trainface",
            "community.userdecryptsecurityinfo",
            "ogs.getallusers",
            "connectors.catalog",
        ):
            self.assertIn(needed, ids)

    def test_every_capability_has_docs(self):
        for cap in self.registry.all():
            self.assertTrue(cap.documentation, cap.id)
            self.assertTrue(str(cap.documentation).startswith("http"), cap.id)

    def test_26_3_image_description_available(self):
        cap = self.registry.get("media.image_description")
        self.assertTrue(cap.available_in("26.3"))
        self.assertFalse(cap.available_in("26.1"))

    def test_export_roundtrip(self):
        payload = self.registry.export_json()
        self.assertEqual(payload["targetVersion"], "26.3")
        self.assertGreaterEqual(len(payload["capabilities"]), 80)
        json.dumps(payload)

    def test_skills_and_workflows(self):
        self.assertGreaterEqual(len(self.registry.skills()), 20)
        self.assertGreaterEqual(len(self.registry.workflows()), 20)


class MappingTests(unittest.TestCase):
    def test_ocr_maps_to_media(self):
        result = map_task("Run the Media Server OCR operation on 26.3.", "26.3")
        self.assertEqual(result["version"]["train"], "26.3")
        self.assertTrue(result["matches"])
        self.assertEqual(result["matches"][0]["capability"]["id"], "media.ocr")

    def test_pii_maps_to_eduction(self):
        result = map_task("Find PII in this contract")
        self.assertEqual(result["matches"][0]["capability"]["component"], "Eduction")

    def test_ask_maps_to_answer_server(self):
        result = map_task("Ask Answer Server a question about contracts")
        self.assertEqual(result["matches"][0]["capability"]["id"], "answer.ask")

    def test_graph_maps_to_kg(self):
        result = map_task("Knowledge Graph neighbors of Chemistry")
        self.assertTrue(result["matches"][0]["capability"]["id"].startswith("kg."))


class SafetyTests(unittest.TestCase):
    def test_classify(self):
        self.assertEqual(classify("Query"), "READ_ONLY")
        self.assertEqual(classify("DREADDDATA"), "SAFE_WRITE")
        self.assertEqual(classify("DREINITIAL"), "DESTRUCTIVE")

    def test_confirm_required(self):
        with self.assertRaises(ConfirmationRequired):
            require_confirmation("DREINITIAL", False)
        require_confirmation("DREINITIAL", True)
        require_confirmation("Query", False)


class ClientMockTests(unittest.TestCase):
    def test_query_mocked(self):
        xml = """<?xml version="1.0"?><autnresponse><action>QUERY</action><responsedata>
        <numhits>1</numhits></responsedata></autnresponse>"""

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertIn("action=Query", str(request.url) + str(request.content))
            return httpx.Response(200, text=xml, headers={"content-type": "application/xml"})

        transport = httpx.MockTransport(handler)
        config = KdConfig.from_env()
        client = AciClient(config, transport=transport)
        result = client.request("Content", "Query", {"Text": "hello"}, response_format="xml")
        self.assertTrue(result["ok"])
        self.assertIn("autnresponse", result["response"])


class ServiceMockTests(unittest.TestCase):
    def setUp(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                text="<?xml version='1.0'?><autnresponse><action>OK</action></autnresponse>",
                headers={"content-type": "application/xml"},
            )

        self.service = KnowledgeDiscoveryService(
            client=AciClient(KdConfig.from_env(), transport=httpx.MockTransport(handler))
        )

    def test_missing_required(self):
        with self.assertRaises(ParameterError):
            self.service.invoke("content.suggestontext", params={})

    def test_destructive_blocked(self):
        with self.assertRaises(ConfirmationRequired):
            self.service.invoke("content.dreinitial")

    def test_destructive_with_confirm(self):
        result = self.service.invoke("content.dreinitial", confirm=True)
        self.assertEqual(result["classification"], "DESTRUCTIVE")
        self.assertTrue(result["ok"])

    def test_dry_run(self):
        result = self.service.invoke("content.query", params={"Text": "x"}, dry_run=True)
        self.assertTrue(result["dryRun"])

    def test_image_description_blocked_on_26_1(self):
        with self.assertRaises(CapabilityError):
            self.service.invoke("media.image_description", params={"SourcePath": "/tmp/a.jpg"}, version="26.1")


class ToolRegistrationTests(unittest.TestCase):
    def test_register_without_fastmcp(self):
        recorded: list[str] = []

        class Dummy:
            def tool(self):
                def deco(fn):
                    recorded.append(fn.__name__)
                    return fn

                return deco

        from tools import knowledge_discovery

        knowledge_discovery.register(Dummy(), None)
        self.assertIn("kd_content_query", recorded)
        self.assertIn("kd_media_ocr", recorded)
        self.assertIn("kd_list_capabilities", recorded)
        self.assertIn("kd_workflow_nifi_ingest", recorded)
        self.assertIn("kd_answer_ask", recorded)
        self.assertIn("kd_kg_get_neighbors", recorded)
        self.assertIn("kd_media_train_face", recorded)
        self.assertIn("kd_list_connectors", recorded)
        self.assertGreaterEqual(len(recorded), 85)


class CatalogIntegrityTests(unittest.TestCase):
    def test_no_duplicate_ids(self):
        caps = build_capabilities()
        ids = [c["id"] for c in caps]
        self.assertEqual(len(ids), len(set(ids)))

    def test_implemented_ratio(self):
        caps = build_capabilities()
        implemented = [c for c in caps if c["implementation_status"] == "implemented"]
        self.assertGreaterEqual(len(implemented) / len(caps), 0.8)


if __name__ == "__main__":
    unittest.main()
