import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import qualify_acceleration as qa


class SamplerQualificationTests(unittest.TestCase):
    def rows(self):
        return [{"prompt": prompt, "profile": profile, "seed": qa.SEED,
                 "width": qa.SIZE, "height": qa.SIZE, "steps": steps, "cfg": cfg,
                 "pixelSha256": f"{i}-{profile}", "durationMs": 1000 if profile != "lcm-native8" else 1800,
                 "peakRssKiB": 2000, "loraApplication": {"fullCoverageObserved": True},
                 "vaeTiling": None, "sampling": qa.sampling_evidence(
                     f"[I] sampling started: method={qa.sampling_config(profile)[0]}, steps={steps} --- sampling.cpp:60\n"
                     "[I] sampling completed, taking 100.00s --- sampling.cpp:99", profile)}
                for i, prompt in enumerate(qa.PROMPTS) for profile, (steps, cfg) in qa.SAMPLER_PROFILES.items()]

    def test_request_is_separate(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "request.json"
            p.write_text(json.dumps(qa.expected_request(sha, sampler=True)))
            qa.validate_request(p, sha, sampler=True)
            with self.assertRaisesRegex(ValueError, "REQUEST_MISMATCH"):
                qa.validate_request(p, sha)
            with self.assertRaisesRegex(ValueError, "EXPERIMENT"):
                qa.expected_request(sha, memory=True, sampler=True)

    def test_profiles_change_only_method_scheduler_and_steps(self):
        common = [Path("model.gguf"), Path(qa.LORA_NAME + ".safetensors"), qa.PROMPTS[0], Path("a.png")]
        base = qa.profile_args("lcm", *common)
        for profile, steps in (("lcm-native4", "4"), ("lcm-native8", "8")):
            expected = base.copy()
            for flag, value in (("--sampling-method", "lcm"), ("--scheduler", "lcm"), ("--steps", steps)):
                expected[expected.index(flag) + 1] = value
            self.assertEqual(qa.profile_args(profile, *common), expected)

    def test_original_method_and_actual_step_count(self):
        start = "[I] sampling started: method=lcm, steps=4 --- sampling.cpp:60\n"
        end = "[I] sampling completed, taking 72.35s --- sampling.cpp:99"
        self.assertEqual(qa.sampling_evidence(start + end, "lcm-native4"),
                         {"methodObserved": "lcm", "stepsObserved": 4, "schedulerRequested": "lcm"})
        for log in (start.replace("method=lcm", "method=euler_a") + end,
                    start.replace("steps=4", "steps=8") + end, start + start + end):
            with self.assertRaisesRegex(ValueError, "SAMPLING_NOT_CONFIRMED"):
                qa.sampling_evidence(log, "lcm-native4")
        with self.assertRaisesRegex(ValueError, "SAMPLING_NOT_COMPLETED"):
            qa.sampling_evidence(start, "lcm-native4")

    def test_comparable_metrics_not_quality_claim(self):
        pairs = qa.compare_sampler(self.rows())
        self.assertEqual([p["candidates"][1]["latencyRatio"] for p in pairs], [1.8, 1.8])
        self.assertEqual([p["candidates"][0]["memoryReductionPercent"] for p in pairs], [0.0, 0.0])

    def test_incomplete_wrong_or_unobserved_profiles_rejected(self):
        rows = self.rows()
        with self.assertRaisesRegex(ValueError, "PAIR_COUNT"):
            qa.compare_sampler(rows[:-1])
        for field, value, reason in (("seed", 0, "PAIR_CONFIGURATION"), ("sampling", None, "PAIR_SAMPLING_EVIDENCE"),
                                      ("loraApplication", None, "PAIR_LORA_OR_VAE_EVIDENCE"), ("peakRssKiB", 0, "PAIR_MEASUREMENTS")):
            rows = self.rows()
            rows[1][field] = value
            with self.assertRaisesRegex(ValueError, reason):
                qa.compare_sampler(rows)

    def test_same_run_uses_all_profiles_and_keeps_research_status(self):
        rows = self.rows()
        order = [rows[0], rows[1], rows[2], rows[5], rows[4], rows[3]]
        with tempfile.TemporaryDirectory() as tmp:
            result = Path(tmp) / "result"
            with patch.object(qa, "checkout"), patch.object(qa, "build"), patch.object(qa, "download_model"), patch.object(qa, "download_lora", return_value=834), patch.object(qa, "verify_source"), patch.object(qa, "generate_profile", side_effect=order) as generate:
                qa.qualify_acceleration(result, sampler=True)
            self.assertEqual([call.args[-1] for call in generate.call_args_list], [row["profile"] for row in order])
            receipt = json.loads((result / "receipt.json").read_text())
            self.assertEqual(receipt["experiment"], "LCM_SAMPLER")
            self.assertEqual(receipt["semanticQuality"], "NOT_RUN")
            self.assertEqual(receipt["productAdoption"], "NOT_RUN")


if __name__ == "__main__":
    unittest.main()
