"""Regression: Admin Center 0.4 must ship the shared IWXA Setup Core 1.0
and one canonical red mark, not the retired stub/icon placeholders.

This tests source/asset identity; native GUI acceptance is separate.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SETUP = ROOT / "installer" / "windows"


class Admin04UnifiedDesign(unittest.TestCase):
    def test_shared_setup_core_1_0_is_the_real_experience(self):
        sources = sorted(SETUP.glob("SetupCore.*.cs"))
        self.assertEqual(len(sources), 11)
        form = (SETUP / "SetupCore.Form.cs").read_text(encoding="utf-8")
        experience = (SETUP / "SetupCore.Experience.cs").read_text(encoding="utf-8")
        unified = (SETUP / "SetupCore.Unified.cs").read_text(encoding="utf-8")
        program = (SETUP / "SetupCore.Program.cs").read_text(encoding="utf-8")
        installer = (SETUP / "SetupCore.Install.cs").read_text(encoding="utf-8")
        stub = (SETUP / "build-stub.ps1").read_text(encoding="utf-8")
        self.assertIn("internal sealed partial class SetupForm", form)
        self.assertIn("BuildExperienceLayout();", form)
        self.assertIn("BuildUnifiedLayout();", experience)
        self.assertIn("private void BuildUnifiedLayout()", unified)
        self.assertIn("priorDataChoices", unified)
        self.assertIn("locationInputs", experience)
        self.assertIn("CopyVerifiedStorage", installer)
        self.assertIn('AssemblyInformationalVersion("1.0.0")', program)
        self.assertIn("if ($sources.Count -ne 11)", stub)
        self.assertIn("/win32manifest:$manifestPath", stub)
        self.assertIn("create-brand-icon.ps1", stub)

    def test_windows_launcher_and_react_use_one_approved_iwxa_red_mark(self):
        official = (SETUP / "iwxa-admin-center.svg").read_bytes()
        self.assertEqual(official, (ROOT / "src/assets/iwxa-admin-center.svg").read_bytes())
        self.assertEqual(official, (ROOT / "public/favicon.svg").read_bytes())
        self.assertIn(b'fill="#EF5350"', official)
        self.assertIn(b'd="M29 14 L51 50 M51 14 L29 50"', official)
        self.assertGreater((ROOT / "src-tauri/icons/icon.ico").stat().st_size, 4096)
        self.assertGreater((ROOT / "src-tauri/icons/icon.png").stat().st_size, 4096)
        self.assertIn(
            "FromArgb(239,83,80)",
            (SETUP / "create-brand-icon.ps1").read_text(encoding="utf-8"),
        )
        app = (ROOT / "src/App.tsx").read_text(encoding="utf-8")
        self.assertIn("import iwxaBrandMark from './assets/iwxa-admin-center.svg?url'", app)
        self.assertIn('src={iwxaBrandMark}', app)
        self.assertNotIn('<svg className="v8-logo"', app)
        self.assertNotIn('fill="#eb4e58"', app)

    def test_product_version_and_desktop_shell_match_prototype(self):
        versions = [
            json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"],
            json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["version"],
            json.loads((ROOT / "installer/products/center.json").read_text(encoding="utf-8"))["version"],
        ]
        cargo = (ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8")
        self.assertEqual(versions, ["0.4.0"] * 3)
        self.assertIn('version = "0.4.0"', cargo)
        app = (ROOT / "src/App.tsx").read_text(encoding="utf-8")
        theme = (ROOT / "src/admin-v8.css").read_text(encoding="utf-8")
        self.assertIn("Версия программы: 0.4.0", app)
        self.assertIn('className="v8-page-location"', app)
        self.assertIn('className="v8-profile-mark"', app)
        self.assertIn('className="v8-rail"', app)
        self.assertIn('className="v8-titlebar"', app)
        self.assertIn('className="v8-inspector-grip"', app)
        self.assertIn("v8-app .main .nested-form", theme)
        self.assertIn(".v8-page-location", theme)
        self.assertNotIn('className="v8-dock-toggle"', app)


if __name__ == "__main__":
    unittest.main()
