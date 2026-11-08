from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path

from installer.build_bundle import (
    FOOTER, MAGIC, SetupBundleError, create_bundle, inspect_bundle, safe_relative,
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
        self.stub.write_bytes(b"MZ" + b"0" * 5000)
        self.profile = self.root / "product.json"
        self.profile.write_text(json.dumps(PRODUCT), encoding="utf-8")
        self.out = self.root / "setup.exe"

    def bundle(self):
        return create_bundle(product_json=self.profile, payload_dir=self.payload,
            stub=self.stub, output=self.out, source_commit="a" * 40, source_tree="b" * 40)

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

    def test_path_traversal_and_windows_aliases_rejected(self):
        for bad in ("../pwn", "/absolute", "C:/system", "foo\\bar", "x/./y", "x/../y",
                    "CON.txt", "a/COM1", "foo//bar", "folder./file", "x:stream"):
            with self.subTest(bad=bad):
                with self.assertRaises(SetupBundleError):
                    safe_relative(bad)
        self.assertEqual(safe_relative("assets/logo.txt"), "assets/logo.txt")

    def test_symlink_and_case_collisions_blocked(self):
        (self.payload / "ASSETS").mkdir()
        (self.payload / "ASSETS" / "logo.txt").write_text("duplicate", encoding="utf-8")
        with self.assertRaisesRegex(SetupBundleError, "duplicate_case"):
            self.bundle()
        (self.payload / "ASSETS" / "logo.txt").unlink()
        (self.payload / "ASSETS").rmdir()
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
