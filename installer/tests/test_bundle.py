from __future__ import annotations

import copy
import json
import os
import struct
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

    def test_qualified_one_dist_is_preserved_inside_the_original_setup_core(self):
        """The Setup Core packages an existing original Kernel and signed UI.

        These bytes are packaging fixtures, not a production Kernel proof.
        Qualification of the real T2 artifact is performed by One Core
        *before* the private installer stages this exact directory.
        """
        import hashlib

        root = self.payload / "t3" / "one-dist"
        entries = {
            "_iwxa/loader.js": b"unchanged original t2 loader",
            "_iwxa/runtime/0.3.6/runtime.js": b"unchanged original t2 kernel",
            "_iwxa/domain.json": b'{"origin":"http://127.0.0.1:18883"}',
            "_iwxa/service-catalog.json": b'{"count":1,"entries":[]}',
            "workspace/workspace.config.json": b'{"workspace_service_id":"example"}',
            "workspace/trusted-kernel-realm.html": b"<html>original trusted realm</html>",
            "workspace/isolated-signed-workspace.html": b"<html>original signed UI</html>",
            "workspace/assets/compiled-signed.js": b"compiled original One Core",
        }
        for name, content in entries.items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        receipt = self.bundle()
        self.assertEqual(receipt["status"], "VERIFIED")
        self.assertEqual(receipt["file_count"], len(entries) + 2)
        self.assertEqual(inspect_bundle(self.out, verify_files=True)["status"],
                         "VERIFIED")
        packed = self.out.read_bytes()
        _, stub_size, zip_size, meta_size, *_ = FOOTER.unpack(packed[-FOOTER.size:])
        manifest = json.loads(packed[stub_size + zip_size:
                                     stub_size + zip_size + meta_size])
        index = {item["path"]: item for item in manifest["files"]}
        for name, content in entries.items():
            item = index["t3/one-dist/" + name]
            self.assertEqual(item["bytes"], len(content))
            self.assertEqual(item["sha256"], hashlib.sha256(content).hexdigest())
        # The installer remains self-contained and independently verifiable
        # even if the original staging folder disappears after publication.
        import shutil
        shutil.rmtree(root)
        self.assertEqual(inspect_bundle(self.out, verify_files=True)["status"],
                         "VERIFIED")

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
