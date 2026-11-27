import unittest
from qualify import X86_FEATURES, x86_flags
from qualify_android_cpu import common_flags, command_args, comparison, observed_steps


class AndroidCpuExperimentTests(unittest.TestCase):
    def test_flags_are_intersection_across_cores(self):
        self.assertEqual(common_flags("flags : sse4_2 avx avx2\nflags : sse4_2 avx\n"), {"sse4_2", "avx"})
        with self.assertRaisesRegex(ValueError, "ANDROID_CPU_FLAGS"):
            common_flags("Features: neon")
        self.assertEqual(x86_flags(True), ["-D" + name + "=ON" for name in X86_FEATURES])
        self.assertEqual(x86_flags(False), ["-D" + name + "=OFF" for name in X86_FEATURES])

    def test_only_binary_and_output_change(self):
        directory = "/data/local/tmp/iwxa-image-cpu-" + "a" * 32
        a, b = (command_args(directory, name) for name in ("portable", "simd"))
        self.assertEqual([i for i, (x, y) in enumerate(zip(a, b)) if x != y], [4, len(a) - 1])
        with self.assertRaisesRegex(ValueError, "ANDROID_QA_PATH"):
            command_args("/data/local/tmp", "simd")

    def test_timeout_never_reported_as_speedup(self):
        a = {"profile": "portable", "status": "TIME_LIMIT", "durationMs": 1200000}
        b = {"profile": "simd", "status": "PASS", "durationMs": 300000}
        self.assertIsNone(comparison([a, b])["speedup"])
        a["status"] = "PASS"
        self.assertEqual(comparison([a, b])["speedup"], 4.0)

    def test_steps_only_after_original_sampling_start(self):
        line = "\r  |====>                                             |  1/12 -  31.29s/it - ETA 05:44\x1b[K"
        self.assertEqual(observed_steps(line), [])
        self.assertEqual(observed_steps(line + "\n[I] sampling started: method=euler_a, steps=12 --- sampling.cpp:60\n" + line), [1])


if __name__ == "__main__":
    unittest.main()
