from __future__ import annotations

import copy
import hashlib
import json
import os
import struct
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch
from pathlib import Path

from installer.build_bundle import (
    FOOTER, MAGIC, RESOURCE_MAGIC, MAX_PE_RESOURCE_BYTES, SetupBundleError,
    _build_resource_blob, create_bundle, inspect_bundle, safe_relative,
    validate_product,
)

PRODUCT = {
    "schema": "IWXA_SETUP_PRODUCT/1",
    "id": "iwxa.admin-center",
    "display_name": "IWXA Admin Center",
    "publisher": "IWXA",
    "version": "0.3.0-dev.1",
    "architecture": "windows-x64",
    "install_dir": "IWXA Admin Center",
    "entrypoint": "iwxa-admin-center.exe",
    "data_namespace": "ru.iwxa.admin-center",
    "requirements": ["webview2-evergreen"],
}


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.payload = self.root / "payload"
        self.payload.mkdir()
        (self.payload / "iwxa-admin-center.exe").write_bytes(b"MZ" + b"x" * 4000)
        (self.payload / "assets").mkdir()
        (self.payload / "assets" / "logo.txt").write_text("IWXA", encoding="utf-8")
        self.stub = self.root / "native-stub.exe"
        # Synthetic PE GUI stub sufficient for validating the packaging contract.
        pe = bytearray(b"MZ" + b"0" * 5000)
        struct.pack_into("<I", pe, 0x3C, 0x80)
        pe[0x80:0x84] = b"PE\x00\x00"
        pe[0x98:0x9A] = b"\x0b\x01"
        pe[0xDC:0xDE] = b"\x02\x00"
        self.stub.write_bytes(pe)
        self.profile = self.root / "product.json"
        self.profile.write_text(json.dumps(PRODUCT), encoding="utf-8")
        self.out = self.root / "setup.exe"

    def bundle(self):
        return create_bundle(product_json=self.profile, payload_dir=self.payload,
            stub=self.stub, output=self.out, source_commit="a" * 40, source_tree="b" * 40)


    def test_native_ui_is_product_neutral_and_versions_are_dynamic(self):
        gui = (Path(__file__).resolve().parents[1] / "windows" / "SetupCore.Form.cs").read_text(encoding="utf-8")
        for forbidden in ("IWXA Admin Center", "IWXA Atlas", "IWXA Publisher",
                          "NSIS 0.2", "0.2", "0.3"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, gui)
        self.assertIn("info.Name", gui)
        self.assertIn("info.Version", gui)
        self.assertIn("old.Version", gui)

    def test_post_operation_verification_cannot_reenable_actions_early(self):
        source = (Path(__file__).resolve().parents[1] / "windows" /
                  "SetupCore.Form.cs").read_text(encoding="utf-8")
        self.assertIn("private bool verifyingState = false;", source)
        self.assertIn("UpgradeAssessment verified = await VerifyAsync(true);", source)
        self.assertIn("if (verifyingState || (performingOperation && !fromOperation))", source)
        self.assertIn("!performingOperation && !verifyingState", source)
        self.assertIn("install.Enabled = !performingOperation &&", source)
        self.assertNotIn("performingOperation = false;\n                UpgradeAssessment verified", source)

    def test_native_stub_embeds_single_exe_system_dpi_manifest(self):
        windows = Path(__file__).resolve().parents[1] / "windows"
        manifest = ET.fromstring((windows / "SetupCore.manifest").read_text(encoding="utf-8"))
        aware = manifest.find(".//{http://schemas.microsoft.com/SMI/2005/WindowsSettings}dpiAware")
        execution = manifest.find(".//{urn:schemas-microsoft-com:asm.v3}requestedExecutionLevel")
        self.assertIsNotNone(aware)
        self.assertEqual(aware.text.strip(), "true")
        self.assertIsNotNone(execution)
        self.assertEqual(execution.attrib["level"], "asInvoker")
        script = (windows / "build-stub.ps1").read_text(encoding="utf-8")
        self.assertIn("/win32manifest:$manifestPath", script)
        self.assertIn("IWXA_SETUP_NATIVE_MANIFEST_MISSING", script)

    def test_native_setup_preserves_action_geometry_at_small_sizes(self):
        source = (Path(__file__).resolve().parents[1] / "windows" /
                  "SetupCore.Form.cs").read_text(encoding="utf-8")
        for marker in (
            'MinimumSize = new Size(750, 520)',
            'ArrangeSupportingContent(area, card, note, actions, eyebrow)',
            'Name = "iwxaSetupPackageCard"',
            'Name = "iwxaSetupPreservationNote"',
            'Name = "iwxaSetupActions"',
            'bool shortView = area.ClientSize.Height < 540.0 * scale',
            'FitInitialWindowToWorkingArea()',
            'internal static Size FitToWorkingAreaSize(',
            'bool narrowView = area.ClientSize.Width < 600.0 * scale',
            'packageDetails.Anchor = AnchorStyles.Left | AnchorStyles.Right',
            'status.Anchor = AnchorStyles.Left | AnchorStyles.Right',
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, source)

    def test_native_setup_shows_real_storage_copy_progress_only(self):
        source = (Path(__file__).resolve().parents[1] / "windows" /
                  "SetupCore.Form.cs").read_text(encoding="utf-8")
        native = (Path(__file__).resolve().parents[1] / "windows" /
                  "SetupCore.Install.cs").read_text(encoding="utf-8")
        self.assertIn("ProgressBarStyle.Marquee", source)
        self.assertIn("busyProgress.Visible = true", source)
        self.assertIn("busyProgress.Visible = false", source)
        self.assertIn("busyProgress.AccessibleName", source)
        # General install/upgrade/repair is indeterminate: only a real file
        # copy reports bytes completed and its measured source total.
        self.assertIn("busyProgress.Style = moving ?", source)
        self.assertIn("ProgressBarStyle.Continuous : ProgressBarStyle.Marquee", source)
        self.assertIn("Math.Floor(copied * 100.0 / total)", source)
        self.assertIn("busyProgress.Value = percent;", source)
        self.assertIn("busyProgress.Style = ProgressBarStyle.Marquee;", source)
        self.assertIn("Action<long, long> progress", native)
        self.assertIn("if (bytesCopied != null) bytesCopied(length);", native)
        self.assertNotIn("busyProgress.Value = 100", source)

    def test_native_installed_app_uninstall_is_visible_and_data_preserving(self):
        form = (Path(__file__).resolve().parents[1] / "windows" /
                "SetupCore.Form.cs").read_text(encoding="utf-8")
        program = (Path(__file__).resolve().parents[1] / "windows" /
                   "SetupCore.Program.cs").read_text(encoding="utf-8")
        self.assertIn('iwxaSetupRemoveApplication', form)
        self.assertIn('BeginUninstallAsync()', form)
        self.assertIn('uninstaller, "--uninstall"', form)
        self.assertIn('MessageBoxButtons.YesNo, MessageBoxIcon.Warning', form)
        self.assertIn('plan.Status == "REPAIR_CANDIDATE_NOT_ACTIVATED"', form)
        self.assertIn('plan.Status == "UPGRADE_CANDIDATE_NOT_ACTIVATED"', form)
        self.assertIn('UserUninstallFailure(ex)', program)
        self.assertIn('UNINSTALLED_USER_DATA_PRESERVED', program)
        self.assertNotIn('MessageBox.Show(result.Status, "IWXA Setup"', program)
        self.assertIn('AllowsOwnedUninstall(plan.Status)', form)
        self.assertIn('case "APPLICATION_RUNNING":', form)
        self.assertIn('case "DOWNGRADE_BLOCKED":', form)

    def test_setup_hides_machine_codes_until_technical_details_requested(self):
        form = (Path(__file__).resolve().parents[1] / "windows" /
                "SetupCore.Form.cs").read_text(encoding="utf-8")
        self.assertIn('technicalDetails.Name = "iwxaSetupTechnicalDetails"', form)
        self.assertIn('SetTechnicalReport(info, plan.Status, null)', form)
        self.assertIn('report.AppendLine("Package SHA-256: "', form)
        self.assertIn('ExplainBlockedState(plan.Status)', form)
        self.assertIn('ExplainStorageSettingsError(ex)', form)
        self.assertNotIn('version.Text = ex.Message', form)
        self.assertNotIn('version.Text = failure.Message', form)
        self.assertNotIn('packageDetails.Text = ex.Message', form)
        self.assertNotIn('plan.Status + "   ', form)
        self.assertNotIn('check.Status, versionLine', form)
        self.assertNotIn('version.Text = T("Код диагностики: "', form)
        self.assertIn('SetTechnicalReport(info, plan.Status, "Preflight: " + check.Status)', form)
        self.assertIn('Name = "iwxaSetupTechnicalReport"', form)
        self.assertIn('Name = "iwxaSetupCopyTechnicalReport"', form)
        self.assertIn('Clipboard.SetText(report.Text)', form)
        self.assertNotIn('MessageBox.Show(this, technicalReport,', form)

    def test_clean_vm_webview2_witness_cannot_report_offline_without_proof(self):
        source = (Path(__file__).resolve().parents[1] / "windows" /
                  "qualify-webview2-clean-windows.ps1").read_text(encoding="utf-8")
        native = (Path(__file__).resolve().parents[1] / "windows" /
                  "SetupCore.Program.cs").read_text(encoding="utf-8")
        for marker in ("Assert-OfflineNetworkIsolation",
                       "Get-NetRoute -AddressFamily IPv4",
                       "Get-NetRoute -AddressFamily IPv6",
                       "WEBVIEW2_CLEAN_VM_OFFLINE_HTTPS_REACHABLE",
                       "WEBVIEW2_CLEAN_VM_APP_CONTENT_NOT_FOUND",
                       "ExpectedGuiAccessibleName",
                       "offlineNetworkIsolationVerified",
                       "productUninstallQualified",
                       "Write-Qualification 'NOT_QUALIFIED'"):
            with self.subTest(marker=marker):
                self.assertIn(marker, source)
        self.assertNotIn("iwxa.admin-center", source)
        self.assertNotIn("iwxa-admin-center.exe", source)
        self.assertIn('{"entrypoint", result.Entrypoint}', native)
        self.assertIn('{"requiresWebView2", result.NeedsWebView2}', native)

    def test_two_other_product_profiles_share_same_package_contract(self):
        for suffix in ("alpha", "beta"):
            with self.subTest(product=suffix):
                profile = copy.deepcopy(PRODUCT)
                profile["id"] = "iwxa.fixture-" + suffix
                profile["display_name"] = "IWXA Fixture " + suffix.title()
                profile["install_dir"] = "IWXA Fixture " + suffix.title()
                profile["entrypoint"] = "iwxa-fixture-" + suffix + ".exe"
                profile["data_namespace"] = "ru.iwxa.fixture-" + suffix
                profile["version"] = "1.4.0"
                profile["requirements"] = [] if suffix == "alpha" else ["webview2-evergreen"]
                (self.payload / "iwxa-admin-center.exe").rename(
                    self.payload / profile["entrypoint"])
                self.profile.write_text(json.dumps(profile), encoding="utf-8")
                packed = self.bundle()
                inspected = inspect_bundle(self.out, verify_files=True)
                self.assertEqual(packed["product"], profile["id"])
                self.assertEqual(inspected["product"], profile["id"])
                self.assertEqual(inspected["version"], "1.4.0")
                (self.payload / profile["entrypoint"]).rename(
                    self.payload / "iwxa-admin-center.exe")

    def test_v2_resource_stream_matches_existing_signed_format_exactly(self):
        self.bundle()
        resource = self.root / "v2-resource.bin"
        size, digest = _build_resource_blob(self.out, self.stub, resource)
        overlay = self.out.read_bytes()
        fields = FOOTER.unpack(overlay[-FOOTER.size:])
        expected = overlay[fields[1]:-FOOTER.size] + FOOTER.pack(
            RESOURCE_MAGIC, 0, fields[2], fields[3],
            bytes(32), fields[5], fields[6],
        )
        self.assertEqual(size, len(expected))
        self.assertEqual(resource.read_bytes(), expected)
        self.assertEqual(digest, hashlib.sha256(expected).digest())
        with patch("installer.build_bundle.MAX_PE_RESOURCE_BYTES", size - 1):
            with self.assertRaisesRegex(SetupBundleError, "pe_resource_maximum_payload_exceeded"):
                _build_resource_blob(self.out, self.stub, self.root / "blocked-resource.bin")
        self.assertLess(size, MAX_PE_RESOURCE_BYTES)

    def test_v2_resource_stream_rejects_invalid_overlay_footer(self):
        self.bundle()
        content = bytearray(self.out.read_bytes())
        content[-FOOTER.size] ^= 1
        self.out.write_bytes(content)
        with self.assertRaisesRegex(SetupBundleError, "pe_resource_original_bundle_invalid"):
            _build_resource_blob(self.out, self.stub, self.root / "damaged-resource.bin")

    def test_stable_reproducible_single_exe_and_identity(self):
        result = self.bundle()
        first = self.out.read_bytes()
        self.assertEqual(result["status"], "VERIFIED")
        self.assertEqual(result["product"], "iwxa.admin-center")
        self.assertEqual(result["file_count"], 2)
        self.assertEqual(result["source"], {"commit": "a" * 40, "tree": "b" * 40})
        self.bundle()
        self.assertEqual(self.out.read_bytes(), first)

    def test_stub_package_manifest_and_footer_are_separately_verified(self):
        self.bundle()
        original = self.out.read_bytes()
        fields = FOOTER.unpack(original[-FOOTER.size:])
        self.assertEqual(fields[0], MAGIC)
        offsets = [10, fields[1] + 8, fields[1] + fields[2] + 8]
        codes = ("bundle_stub_sha256_invalid", "bundle_package_sha256_invalid", "bundle_manifest_sha256_invalid")
        for position, code in zip(offsets, codes):
            damaged = bytearray(original)
            damaged[position] ^= 1
            self.out.write_bytes(damaged)
            with self.assertRaisesRegex(SetupBundleError, code):
                inspect_bundle(self.out)
        self.out.write_bytes(original[:-1])
        with self.assertRaisesRegex(SetupBundleError, "bundle_footer_invalid|bundle_layout_invalid"):
            inspect_bundle(self.out)

    def test_console_stub_rejected_without_publishing_output(self):
        pe = bytearray(self.stub.read_bytes())
        pe[0xDC:0xDE] = b"\x03\x00"
        self.stub.write_bytes(pe)
        with self.assertRaisesRegex(SetupBundleError, "native_stub_not_gui"):
            self.bundle()
        self.assertFalse(self.out.exists())

    def test_path_traversal_and_windows_aliases_rejected(self):
        for bad in ("../pwn", "/absolute", "C:/system", "foo\\bar", "x/./y", "x/../y",
                    "CON.txt", "a/COM1", "foo//bar", "folder./file", "x:stream"):
            with self.subTest(bad=bad):
                with self.assertRaises(SetupBundleError):
                    safe_relative(bad)
        self.assertEqual(safe_relative("assets/logo.txt"), "assets/logo.txt")

    def test_symlink_and_case_collisions_blocked(self):
        collision_dir = self.payload / "ASSETS"
        try:
            collision_dir.mkdir()
        except FileExistsError:
            # Default macOS and some Windows volumes have a case-insensitive
            # filesystem, so two case-alias folders cannot be materialized.
            # The independent symlink rejection still runs below.
            pass
        else:
            (collision_dir / "logo.txt").write_text("duplicate", encoding="utf-8")
            with self.assertRaisesRegex(SetupBundleError, "duplicate_case"):
                self.bundle()
            (collision_dir / "logo.txt").unlink()
            collision_dir.rmdir()
        try:
            os.symlink(self.payload / "iwxa-admin-center.exe", self.payload / "linked.exe")
        except (OSError, NotImplementedError):
            self.skipTest("symlink creation not available")
        with self.assertRaisesRegex(SetupBundleError, "symlink"):
            self.bundle()

    def test_product_profile_is_exact_and_has_no_custom_execution_hooks(self):
        for key, invalid in (
            ("id", "../pwn"), ("install_dir", "../other"),
            ("entrypoint", "../../secret.exe"), ("architecture", "win32"),
            ("architecture", "windows-arm64"),
            ("requirements", ["cmd.exe /c something"])
        ):
            with self.subTest(key=key):
                p = copy.deepcopy(PRODUCT)
                p[key] = invalid
                with self.assertRaises(SetupBundleError):
                    validate_product(p)
        self.bundle()
        with self.assertRaisesRegex(SetupBundleError, "source_identity_invalid"):
            create_bundle(product_json=self.profile, payload_dir=self.payload, stub=self.stub,
                          output=self.out, source_commit="fake", source_tree="b" * 40)


if __name__ == "__main__":
    unittest.main()
