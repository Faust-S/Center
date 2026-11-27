import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import qualify_acceleration as qa


class MemoryQualificationTests(unittest.TestCase):
    def rows(self):
        return [{"prompt": prompt, "profile": profile, "seed": qa.SEED,
                 "width": qa.SIZE, "height": qa.SIZE, "steps": steps, "cfg": cfg,
                 "pixelSha256": f"{i}-{profile}", "durationMs": 1000 if profile == "lcm" else 1400,
                 "peakRssKiB": 2000 if profile == "lcm" else 1500,
                 "loraApplication": {"fullCoverageObserved": True},
                 "vaeTiling": None if profile == "lcm" else qa.tiling_evidence(
                     "VAE decode tile size: 256x256 pixels (32x32 latent)", profile)}
                for i, prompt in enumerate(qa.PROMPTS) for profile, (steps, cfg) in qa.MEMORY_PROFILES.items()]

    def test_separate_exact_request(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "request.json"
            p.write_text(json.dumps(qa.expected_request(sha, True)))
            qa.validate_request(p, sha, True)
            with self.assertRaisesRegex(ValueError, "REQUEST_MISMATCH"):
                qa.validate_request(p, sha)

    def test_only_tiling_flags_change(self):
        common = [Path("model.gguf"), Path(qa.LORA_NAME + ".safetensors"), qa.PROMPTS[0], Path("a.png")]
        a = qa.profile_args("lcm", *common)
        b = qa.profile_args("lcm-tiled", *common)
        self.assertEqual(b, a[:-2] + qa.TILE_FLAGS + a[-2:])

    def test_requires_observed_decode_not_just_config(self):
        for log in ("--vae-tiling --vae-tile-size 256x256", "VAE decode tile size: 512x512 pixels (64x64 latent)", "VAE encode tile size: 256x256 pixels (32x32 latent)"):
            with self.assertRaisesRegex(ValueError, "VAE_TILING_NOT_CONFIRMED"):
                qa.tiling_evidence(log, "lcm-tiled")
        log = "\x1b[32m[V] VAE decode tile size: 256x256 pixels (32x32 latent) --- vae.hpp:128\x1b[0m"
        self.assertTrue(qa.tiling_evidence(log, "lcm-tiled")["decodeObserved"])
        with self.assertRaisesRegex(ValueError, "UNEXPECTED_VAE_TILING"):
            qa.tiling_evidence(log, "lcm")

    def test_reports_tradeoff_without_claiming_improvement(self):
        rows = self.rows()
        pairs = qa.compare_memory(rows)
        self.assertEqual([(p["savedRssKiB"], p["memoryReductionPercent"], p["latencyRatio"]) for p in pairs], [(500, 25.0, 1.4)] * 2)
        rows[1]["peakRssKiB"] = 2200
        rows[1]["pixelSha256"] = rows[0]["pixelSha256"]
        pairs = qa.compare_memory(rows)
        self.assertEqual(pairs[0]["memoryReductionPercent"], -10.0)
        self.assertTrue(pairs[0]["identicalPixels"])

    def test_rejects_unproven_or_noncomparable_pair(self):
        for field, value, reason in (("vaeTiling", None, "PAIR_TILING_EVIDENCE"), ("seed", 0, "PAIR_CONFIGURATION"), ("loraApplication", None, "PAIR_LORA_EVIDENCE"), ("peakRssKiB", 0, "PAIR_MEASUREMENTS")):
            rows = self.rows()
            rows[1][field] = value
            with self.assertRaisesRegex(ValueError, reason):
                qa.compare_memory(rows)

    def test_same_owner_full_memory_experiment(self):
        a, b, c, d = self.rows()
        with tempfile.TemporaryDirectory() as tmp:
            result = Path(tmp) / "result"
            with patch.object(qa, "checkout"), patch.object(qa, "build"), patch.object(qa, "download_model"), patch.object(qa, "download_lora", return_value=834), patch.object(qa, "verify_source"), patch.object(qa, "generate_profile", side_effect=[a,b,d,c]) as generate:
                qa.qualify_acceleration(result, True)
            self.assertEqual([call.args[-1] for call in generate.call_args_list], ["lcm", "lcm-tiled", "lcm-tiled", "lcm"])
            receipt = json.loads((result / "receipt.json").read_text())
            self.assertEqual(receipt["experiment"], "VAE_TILING")
            self.assertEqual(receipt["semanticQuality"], "NOT_RUN")
            self.assertEqual(receipt["productAdoption"], "NOT_RUN")


if __name__ == "__main__":
    unittest.main()
