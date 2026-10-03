"""Automated tests for version-aware IDOL NiFi NAR resolution.

These tests execute against the in-repo compatibility matrix and an isolated
temporary registry that contains dummy NAR bytes. They prove that 26.2 cannot
select 26.3 artifacts and that unsupported/missing combinations block.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nar.config import NarConfig
from nar.errors import VersionParseError
from nar.flows import REFERENCE_FLOWS, materialize_flow
from nar.intent import extract_version_intent
from nar.registry import NarRegistry
from nar.resolver import NarResolver
from nar.service import IdolNarService
from nar.versions import parse_version
from nar.installer import NarInstaller


REPO_NARS = ROOT.parent / "nars"


def _write_matrix(root: Path) -> None:
    shutil.copytree(REPO_NARS / "26.2", root / "26.2")
    shutil.copytree(REPO_NARS / "26.3", root / "26.3")
    shutil.copy(REPO_NARS / "compatibility-matrix.json", root / "compatibility-matrix.json")


def _drop_nar(folder: Path, filename: str, payload: bytes) -> None:
    (folder / filename).write_bytes(payload)


class VersionParseTests(unittest.TestCase):
    def test_valid_product_versions(self):
        self.assertEqual(parse_version("26.2").major_minor, "26.2")
        self.assertEqual(str(parse_version("26.3.0-nifi2")), "26.3.0-nifi2")
        self.assertEqual(parse_version("2.9.0").dotted, "2.9.0")

    def test_invalid_version_format(self):
        with self.assertRaises(VersionParseError):
            parse_version("twenty-six")
        with self.assertRaises(VersionParseError):
            parse_version("")
        with self.assertRaises(VersionParseError):
            parse_version("26")


class RepoMatrixTests(unittest.TestCase):
    def setUp(self):
        self.registry = NarRegistry(NarConfig.from_env(REPO_NARS), nars_root=REPO_NARS)
        self.resolver = NarResolver(self.registry)

    def test_list_profiles(self):
        ids = [p.id for p in self.registry.profiles()]
        self.assertIn("idol-26.2-nifi-26.2", ids)
        self.assertIn("idol-26.3-nifi-26.3", ids)

    def test_exact_26_2_match(self):
        result = self.resolver.resolve(idol_version="26.2", nifi_version="26.2")
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.profile.id, "idol-26.2-nifi-26.2")
        self.assertTrue(all("26.2" in a.filename for a in result.selected_nars))
        self.assertFalse(any("26.3" in a.filename for a in result.selected_nars))

    def test_exact_26_3_match(self):
        result = self.resolver.resolve(idol_version="26.3", nifi_version="26.3")
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.profile.id, "idol-26.3-nifi-26.3")
        self.assertTrue(all("26.3" in a.filename for a in result.selected_nars))
        self.assertFalse(any("26.2" in a.filename for a in result.selected_nars))

    def test_compatible_patch_match(self):
        result = self.resolver.resolve(idol_version="26.2.0")
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.idol_version, "26.2")

    def test_unsupported_version(self):
        result = self.resolver.resolve(idol_version="24.4", nifi_version="24.4")
        self.assertEqual(result.status, "BLOCKED")
        self.assertIn("No compatible", result.reason or "")

    def test_idol_differs_from_nifi(self):
        result = self.resolver.resolve(idol_version="26.2", nifi_version="26.3")
        self.assertEqual(result.status, "BLOCKED")
        self.assertIsNone(result.profile)

    def test_wrong_nar_version_on_profile(self):
        result = self.resolver.resolve(idol_version="26.2", nar_version="26.3.0-nifi2")
        self.assertEqual(result.status, "BLOCKED")

    def test_processor_unavailable_in_selected_nar(self):
        result = self.resolver.resolve(
            idol_version="26.2",
            requested_processors=["TotallyFakeIdolProcessor"],
        )
        self.assertEqual(result.status, "BLOCKED")
        self.assertIn("TotallyFakeIdolProcessor", result.unavailable_processors)

    def test_apache_nifi_2_9_maps_to_26_3(self):
        result = self.resolver.resolve(nifi_version="2.9.0")
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.profile.id, "idol-26.3-nifi-26.3")

    def test_no_silent_filename_guess(self):
        result = self.resolver.resolve(idol_version="26.20")
        self.assertEqual(result.status, "BLOCKED")


class IsolatedRegistryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="idol-nars-"))
        _write_matrix(self.tmp)
        # Only 26.2 has actual bytes; 26.3 stays catalogued.
        for name in [
            "idol-nifi-framework-api-nar-26.2.0-nifi2.nar",
            "idol-nifi-framework-nar-26.2.0-nifi2.nar",
            "idol-nifi-connector-filesystem-nar-26.2.0-nifi2.nar",
        ]:
            _drop_nar(self.tmp / "26.2", name, f"dummy-26.2::{name}".encode())
        self.registry = NarRegistry(nars_root=self.tmp)
        self.resolver = NarResolver(self.registry, NarConfig.from_env(self.tmp))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_missing_nar_files_block_when_required(self):
        result = self.resolver.resolve(idol_version="26.3", require_files=True)
        self.assertEqual(result.status, "BLOCKED")
        self.assertTrue(result.missing_nars)

    def test_present_26_2_files_pass_require_files(self):
        result = self.resolver.resolve(idol_version="26.2", require_files=True)
        self.assertEqual(result.status, "PASS")
        self.assertTrue(all(a.path and a.path.is_file() for a in result.selected_nars))

    def test_multiple_nar_versions_do_not_cross_select(self):
        _drop_nar(
            self.tmp / "26.3",
            "idol-nifi-framework-api-nar-26.3.0-nifi2.nar",
            b"dummy-26.3-api",
        )
        _drop_nar(
            self.tmp / "26.3",
            "idol-nifi-framework-nar-26.3.0-nifi2.nar",
            b"dummy-26.3-fw",
        )
        _drop_nar(
            self.tmp / "26.3",
            "idol-nifi-connector-filesystem-nar-26.3.0-nifi2.nar",
            b"dummy-26.3-fs",
        )
        self.registry.reload()
        r26 = self.resolver.resolve(idol_version="26.2", require_files=True)
        r27 = self.resolver.resolve(idol_version="26.3", require_files=True)
        self.assertEqual(r26.status, "PASS")
        self.assertEqual(r27.status, "PASS")
        self.assertNotEqual(
            {a.filename for a in r26.selected_nars},
            {a.filename for a in r27.selected_nars},
        )
        self.assertTrue(all("26.2" in a.filename for a in r26.selected_nars))
        self.assertTrue(all("26.3" in a.filename for a in r27.selected_nars))

    def test_wrong_nar_bytes_do_not_satisfy_other_profile(self):
        # A 26.3-named file sitting in the 26.2 folder is ignored by 26.2 manifest.
        _drop_nar(self.tmp / "26.2", "idol-nifi-framework-nar-26.3.0-nifi2.nar", b"wrong-place")
        self.registry.reload()
        result = self.resolver.resolve(idol_version="26.2")
        names = [a.filename for a in result.selected_nars]
        self.assertNotIn("idol-nifi-framework-nar-26.3.0-nifi2.nar", names)

    def test_hash_mismatch_blocks(self):
        manifest = json.loads((self.tmp / "26.2" / "manifest.json").read_text())
        for art in manifest["artifacts"]:
            art["sha256"] = "0" * 64
        (self.tmp / "26.2" / "manifest.json").write_text(json.dumps(manifest))
        self.registry.reload()
        result = self.resolver.resolve(idol_version="26.2", require_files=True)
        self.assertEqual(result.status, "BLOCKED")
        self.assertIn("checksum", (result.reason or "").lower())

    def test_local_install_copies_only_matching_files(self):
        dest = self.tmp / "extensions"
        cfg = NarConfig.from_env(self.tmp)
        cfg.deployment_mode = "local"
        cfg.nifi_extensions_dir = dest
        installer = NarInstaller(cfg)
        resolution = self.resolver.resolve(idol_version="26.2", require_files=True)
        plan = installer.install(resolution, target_dir=dest)
        self.assertEqual(plan["status"], "INSTALLED")
        copied = list(dest.glob("*.nar"))
        self.assertTrue(copied)
        self.assertTrue(all("26.2" in p.name for p in copied))
        self.assertFalse(any("26.3" in p.name for p in copied))

    def test_external_install_refuses_to_copy(self):
        cfg = NarConfig.from_env(self.tmp)
        cfg.deployment_mode = "external"
        installer = NarInstaller(cfg)
        resolution = self.resolver.resolve(idol_version="26.2", require_files=True)
        plan = installer.install(resolution, target_dir=self.tmp / "should-not-exist")
        self.assertEqual(plan["deployment"], "EXTERNAL")
        self.assertEqual(plan["status"], "BLOCKED")
        self.assertFalse((self.tmp / "should-not-exist").exists())


class IntentTests(unittest.TestCase):
    def test_extract_26_2_from_prompt(self):
        intent = extract_version_intent("Create an IDOL Content ingestion flow using version 26.2.")
        self.assertEqual(intent.idol_version, "26.2")
        self.assertEqual(intent.flow_hint, "content-ingestion")

    def test_extract_nifi_26_3(self):
        intent = extract_version_intent("Build an IDOL Content ingestion pipeline using NiFi 26.3.")
        self.assertEqual(intent.nifi_version, "26.3")

    def test_version_omitted(self):
        intent = extract_version_intent("Connect NiFi to IDOL Content.")
        self.assertTrue(intent.clarification_needed)
        self.assertIsNone(intent.idol_version)

    def test_invalid_tokens_do_not_invent_version(self):
        intent = extract_version_intent("Create a flow for the latest IDOL.")
        self.assertTrue(intent.clarification_needed)


class FlowGenerationTests(unittest.TestCase):
    def setUp(self):
        self.svc = IdolNarService(NarConfig.from_env(REPO_NARS), NarRegistry(nars_root=REPO_NARS))

    def test_ten_reference_flows_exist(self):
        self.assertEqual(len(REFERENCE_FLOWS), 10)

    def test_generate_26_2_ingestion(self):
        out = self.svc.generate_flow(prompt="Create an IDOL Content ingestion flow using version 26.2.")
        self.assertEqual(out["status"], "READY")
        self.assertEqual(out["idolVersion"], "26.2")
        self.assertEqual(out["narProfile"], "idol-26.2-nifi-26.2")
        self.assertTrue(all("26.2" in name for name in out["requiredNars"]))
        self.assertFalse(any("26.3" in name for name in out["requiredNars"]))

    def test_generate_same_flow_for_26_3_uses_other_nars(self):
        a = self.svc.generate_flow(prompt="Create an IDOL Content ingestion flow using version 26.2.")
        b = self.svc.generate_flow(prompt="Create the same flow for 26.3.")
        self.assertEqual(b["status"], "READY")
        self.assertEqual(b["idolVersion"], "26.3")
        self.assertNotEqual(a["requiredNars"], b["requiredNars"])
        self.assertTrue(all("26.3" in name for name in b["requiredNars"]))

    def test_generate_blocked_when_unsupported(self):
        out = self.svc.generate_flow(prompt="Create an IDOL ingestion pipeline for 19.1.")
        self.assertEqual(out["status"], "BLOCKED")
        self.assertEqual(out["flow"], "BLOCKED")

    def test_validate_generated_flow_processor_mapping(self):
        resolution = self.svc.resolver.resolve(idol_version="26.3")
        spec = materialize_flow("content-ingestion", resolution)
        report = self.svc.validate_flow_spec(spec, idol_version="26.3")
        self.assertTrue(report["valid"])
        report_wrong = self.svc.validate_flow_spec(spec, idol_version="24.1")
        self.assertFalse(report_wrong["valid"])

    def test_version_omitted_uses_config_or_blocks(self):
        out = self.svc.generate_flow(prompt="Create a passage extraction flow using IDOL.")
        # No env version and no prompt version → blocked, does not invent.
        if not self.svc.config.idol_version:
            self.assertEqual(out["status"], "BLOCKED")

    def test_mcp_response_shape(self):
        out = self.svc.generate_flow(idol_version="26.2", flow_id="enterprise-ingestion")
        for key in (
            "idolVersion",
            "nifiVersion",
            "narProfile",
            "narValidation",
            "requiredNars",
            "processors",
            "deployment",
            "flow",
        ):
            self.assertIn(key, out)


class DependencyTests(unittest.TestCase):
    def test_missing_dependency_listed_on_profile(self):
        registry = NarRegistry(nars_root=REPO_NARS)
        profile = registry.get("idol-26.2-nifi-26.2")
        self.assertTrue(profile.dependencies)
        framework = next(a for a in profile.artifacts if "framework-nar-26.2" in a.filename)
        self.assertTrue(any("framework-api" in dep for dep in framework.dependencies))


if __name__ == "__main__":
    unittest.main()
