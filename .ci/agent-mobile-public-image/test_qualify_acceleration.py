import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import qualify_acceleration as qa


class Source(io.BytesIO):
    def geturl(self):
        return "https://fixture.invalid/weights"


def fixture_bytes(offsets=(0, 4), name="model.lora_up.weight"):
    header = json.dumps({name: {"dtype": "F32", "shape": [1], "data_offsets": list(offsets)}}).encode()
    return len(header).to_bytes(8, "little") + header + b"\x00\x00\x80\x3f"


class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.lora = self.root / (qa.LORA_NAME + ".safetensors")

    def tearDown(self):
        self.tmp.cleanup()

    def test_request_exact(self):
        p = self.root / "request.json"
        rev = "a" * 40
        p.write_text(json.dumps(qa.expected_request(rev)))
        qa.validate_request(p, rev)
        with self.assertRaisesRegex(ValueError, "REQUEST_MISMATCH"):
            qa.validate_request(p, "b" * 40)
        with self.assertRaisesRegex(ValueError, "PREPARED_SHA"):
            qa.expected_request("main")

    def test_download_pinned_and_header(self):
        data = fixture_bytes()
        with patch.object(qa.urllib.request, "urlopen", return_value=Source(data)):
            self.assertEqual(qa.download_lora(self.lora, size=len(data), digest=hashlib.sha256(data).hexdigest()), 1)
        self.assertEqual(self.lora.read_bytes(), data)
        self.assertFalse(self.lora.with_suffix(".safetensors.part").exists())

    def test_wrong_identity_cleans_partial(self):
        data = fixture_bytes()
        with patch.object(qa.urllib.request, "urlopen", return_value=Source(data)):
            with self.assertRaisesRegex(ValueError, "LORA_IDENTITY"):
                qa.download_lora(self.lora, size=len(data), digest="0" * 64)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_oversized_download_rejected(self):
        with patch.object(qa.urllib.request, "urlopen", return_value=Source(fixture_bytes())):
            with self.assertRaisesRegex(ValueError, "LORA_SIZE"):
                qa.download_lora(self.lora, size=4)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_header_rejects_bad_offsets(self):
        self.lora.write_bytes(fixture_bytes((0, 5)))
        with self.assertRaisesRegex(ValueError, "LORA_OFFSETS"):
            qa.verify_lora_header(self.lora)

    def test_header_rejects_non_lora(self):
        self.lora.write_bytes(fixture_bytes(name="unrelated.weight"))
        with self.assertRaisesRegex(ValueError, "LORA_TENSORS"):
            qa.verify_lora_header(self.lora)

    def test_header_rejects_gap(self):
        self.lora.write_bytes(fixture_bytes((1, 4)))
        with self.assertRaisesRegex(ValueError, "LORA_PAYLOAD"):
            qa.verify_lora_header(self.lora)

    def test_profiles_control_parameters(self):
        common = [self.root / "model.gguf", self.lora, qa.PROMPTS[0], self.root / "a.png"]
        a, b = (qa.profile_args(p, *common) for p in qa.PROFILES)
        def val(args, key):
            return args[args.index(key) + 1]
        for key in ("-m", "--width", "--height", "--threads", "--seed", "--sampling-method", "--scheduler"):
            self.assertEqual(val(a, key), val(b, key))
        self.assertEqual((val(a, "--steps"), val(b, "--steps")), ("12", "4"))
        self.assertEqual((val(a, "--cfg-scale"), val(b, "--cfg-scale")), ("7", "1"))
        self.assertNotIn("--lora-model-dir", a)
        self.assertEqual(val(b, "--lora-apply-mode"), "at_runtime")
        self.assertEqual(val(b, "-p"), qa.PROMPTS[0] + "<lora:lcm-lora-sdv1-5:1>")

    def test_actual_lora_positive_count(self):
        out = qa.lora_evidence(f"(10 / 20) LoRA tensors have been applied, lora_file_path = {self.lora}", self.lora)
        self.assertEqual(out["observations"], [{"applied": 10, "compatible": 20}])
        self.assertFalse(out["fullCoverageObserved"])
        out = qa.lora_evidence(f"(20 / 20) LoRA tensors have been applied, lora_file_path = {self.lora}", self.lora)
        self.assertTrue(out["fullCoverageObserved"])

    def test_no_or_wrong_or_zero_lora_evidence_rejected(self):
        for log in ("loaded model", f"(0 / 20) LoRA tensors have been applied, lora_file_path = {self.lora}",
                    "(20 / 20) LoRA tensors have been applied, lora_file_path = /other.safetensors"):
            with self.subTest(log=log), self.assertRaisesRegex(ValueError, "LORA_APPLICATION_MISSING"):
                qa.lora_evidence(log, self.lora)

    def test_incompatible_lora_rejected(self):
        log = f"(20 / 20) LoRA tensors have been applied, lora_file_path = {self.lora}\n(2 / 20) incompatible LoRA tensors have been skipped"
        with self.assertRaisesRegex(ValueError, "LORA_INCOMPATIBLE"):
            qa.lora_evidence(log, self.lora)

    def rows(self):
        return [{"prompt": prompt, "profile": profile, "seed": qa.SEED, "width": qa.SIZE, "height": qa.SIZE,
                 "steps": steps, "cfg": cfg, "pixelSha256": f"{i}-{profile}",
                 "durationMs": 3000 if profile == "baseline" else 1000,
                 "peakRssKiB": 100 if profile == "baseline" else 150,
                 "loraApplication": None if profile == "baseline" else {"fullCoverageObserved": True}}
                for i, prompt in enumerate(qa.PROMPTS) for profile, (steps, cfg) in qa.PROFILES.items()]

    def test_same_runner_comparison(self):
        pairs = qa.compare(self.rows())
        self.assertEqual([p["speedup"] for p in pairs], [3.0, 3.0])
        self.assertEqual([p["lcmPeakRssKiB"] for p in pairs], [150, 150])

    def test_comparison_requires_all_pairs(self):
        with self.assertRaisesRegex(ValueError, "PAIR_COUNT"):
            qa.compare(self.rows()[:-1])

    def test_comparison_rejects_mismatched_seed(self):
        rows = self.rows()
        rows[1]["seed"] = 9
        with self.assertRaisesRegex(ValueError, "PAIR_CONFIGURATION"):
            qa.compare(rows)

    def test_comparison_rejects_repeated_pixels(self):
        rows = self.rows()
        rows[1]["pixelSha256"] = rows[0]["pixelSha256"]
        with self.assertRaisesRegex(ValueError, "PAIR_IDENTICAL_PIXELS"):
            qa.compare(rows)

    def test_comparison_requires_positive_metrics(self):
        rows = self.rows()
        rows[1]["durationMs"] = 0
        with self.assertRaisesRegex(ValueError, "PAIR_MEASUREMENTS"):
            qa.compare(rows)


if __name__ == "__main__":
    unittest.main()
