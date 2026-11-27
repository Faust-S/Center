from pathlib import Path
import unittest
from unittest.mock import patch

import qualify_opencl as qa


class OpenCLTests(unittest.TestCase):
    header = "  Class:                             ELF64\n  Machine:                           AArch64\n"
    cli_dynamic = " 0x0000000000000001 (NEEDED) Shared library: [libOpenCL.so.1]\n 0x1 (NEEDED) Shared library: [libc.so]\n"
    loader_dynamic = " 0x000000000000000e (SONAME) Library soname: [libOpenCL.so.1]\n"
    symbols = " 1: 00000100 64 FUNC GLOBAL DEFAULT 4 clGetPlatformIDs@@OPENCL_1.0\n 2: 00000200 64 FUNC GLOBAL DEFAULT 4 clGetDeviceIDs@@OPENCL_1.0\n"

    def evidence(self, **overrides):
        args = dict(cli_header=self.header, loader_header=self.header, cli_dynamic=self.cli_dynamic,
                    loader_dynamic=self.loader_dynamic, loader_symbols=self.symbols)
        args.update(overrides)
        return qa.verify_binary_evidence(**args)

    def test_exact_dependency_pins_in_request(self):
        request = qa.expected_request("a" * 40)
        self.assertEqual(request["headers"], qa.HEADERS[1])
        self.assertEqual(request["loader_tree"], qa.LOADER[2])
        with self.assertRaisesRegex(ValueError, "PREPARED_SHA"):
            qa.expected_request("main")

    def test_dependency_tree_required(self):
        with patch.object(qa, "run", side_effect=[qa.HEADERS[1], "wrong"]):
            with self.assertRaisesRegex(ValueError, "DEPENDENCY_TREE"):
                qa.verify_dependency(Path("/headers"), qa.HEADERS)

    def test_dependency_cleanliness_required(self):
        with patch.object(qa, "run", side_effect=[qa.HEADERS[1], qa.HEADERS[2], " M CL/cl.h"]):
            with self.assertRaisesRegex(ValueError, "DEPENDENCY_DIRTY"):
                qa.verify_dependency(Path("/headers"), qa.HEADERS)

    def test_build_uses_documented_backend_and_separate_sdk_inputs(self):
        args = qa.engine_args(Path("/src"), Path("/out"), Path("/headers"), Path("/build/libOpenCL.so.1"), Path("/ndk"))
        for flag in ("-DANDROID_ABI=arm64-v8a", "-DANDROID_PLATFORM=android-33", "-DSD_OPENCL=ON",
                     "-DSD_VULKAN=OFF", "-DGGML_OPENCL_EMBED_KERNELS=ON", "-DGGML_OPENCL_USE_ADRENO_KERNELS=ON",
                     "-DOpenCL_INCLUDE_DIR=/headers", "-DOpenCL_LIBRARY=/build/libOpenCL.so.1"):
            self.assertIn(flag, args)
        loader = qa.loader_args(Path("/loader"), Path("/out"), Path("/headers"), Path("/ndk"))
        self.assertIn("-DOPENCL_ICD_LOADER_HEADERS_DIR=/headers", loader)
        self.assertIn("-DOPENCL_ICD_LOADER_BUILD_SHARED_LIBS=ON", loader)

    def test_real_linkage_and_exports_evidence(self):
        self.assertEqual(self.evidence()["loaderSoname"], "libOpenCL.so.1")

    def test_cpu_only_linkage_rejected(self):
        with self.assertRaisesRegex(ValueError, "OPENCL_LINK_MISSING"):
            self.evidence(cli_dynamic="Shared library: [libc.so]")

    def test_wrong_arch_rejected(self):
        with self.assertRaisesRegex(ValueError, "OPENCL_ELF_ARCH"):
            self.evidence(loader_header=self.header.replace("AArch64", "X86-64"))

    def test_missing_loader_export_rejected(self):
        with self.assertRaisesRegex(ValueError, "OPENCL_LOADER_EXPORTS"):
            self.evidence(loader_symbols=self.symbols.replace("DEFAULT 4 clGetDeviceIDs", "DEFAULT UND clGetDeviceIDs"))

    def test_unexpected_runtime_rejected(self):
        with self.assertRaisesRegex(ValueError, "OPENCL_UNEXPECTED_RUNTIME"):
            self.evidence(cli_dynamic=self.cli_dynamic + "Shared library: [libggml.so]\n")

    def test_wrong_soname_rejected(self):
        with self.assertRaisesRegex(ValueError, "OPENCL_LOADER_SONAME"):
            self.evidence(loader_dynamic="Library soname: [unknown.so]")


if __name__ == "__main__":
    unittest.main()
