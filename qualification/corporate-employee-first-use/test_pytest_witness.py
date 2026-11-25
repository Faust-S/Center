import tempfile
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET

from pytest_witness import CLASS_SUFFIX, REQUIRED, validate


class WitnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "report.xml"
        self.root = ET.Element("testsuites")
        self.suite = ET.SubElement(self.root, "testsuite", tests="3", failures="0", errors="0", skipped="0")
        for name in sorted(REQUIRED):
            ET.SubElement(self.suite, "testcase", classname="tests." + CLASS_SUFFIX, name=name)

    def check(self):
        ET.ElementTree(self.root).write(self.path, encoding="utf-8")
        return validate(self.path)

    def test_exact_three(self):
        self.assertEqual(self.check(), 3)

    def test_additional_success(self):
        ET.SubElement(self.suite, "testcase", classname="tests." + CLASS_SUFFIX, name="test_new")
        self.suite.set("tests", "4")
        self.assertEqual(self.check(), 4)

    def test_missing_required(self):
        self.suite.remove(self.suite[0])
        self.suite.set("tests", "2")
        with self.assertRaises(ValueError):
            self.check()

    def test_wrong_class(self):
        self.suite[0].set("classname", "other")
        with self.assertRaises(ValueError):
            self.check()

    def test_duplicate(self):
        self.suite[0].set("name", self.suite[1].get("name"))
        with self.assertRaises(ValueError):
            self.check()

    def test_unsuccessful_case(self):
        for tag in ("failure", "error", "skipped"):
            with self.subTest(tag=tag):
                item = ET.SubElement(self.suite[0], tag)
                with self.assertRaises(ValueError):
                    self.check()
                self.suite[0].remove(item)

    def test_unsuccessful_suite(self):
        for key in ("failures", "errors", "skipped"):
            with self.subTest(key=key):
                self.suite.set(key, "1")
                with self.assertRaises(ValueError):
                    self.check()
                self.suite.set(key, "0")

    def test_count_mismatch(self):
        self.suite.set("tests", "2")
        with self.assertRaises(ValueError):
            self.check()

    def test_single_suite(self):
        self.root = self.suite
        self.assertEqual(self.check(), 3)

    def test_missing_report(self):
        with self.assertRaises(OSError):
            validate(self.path)

    def test_malformed_report(self):
        self.path.write_text("<testsuite", encoding="utf-8")
        with self.assertRaises(ET.ParseError):
            validate(self.path)


if __name__ == "__main__":
    unittest.main()
