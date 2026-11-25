"""Validate a private pytest JUnit witness without exposing its contents."""
from __future__ import annotations

import argparse
from pathlib import Path
import xml.etree.ElementTree as ET


REQUIRED = frozenset({
    "test_first_use_mount_is_after_explicit_active_organization",
    "test_original_dist_port_not_inferred_from_agent_port",
    "test_supervised_server_configures_same_original_owner_before_serving",
})
CLASS_SUFFIX = "test_agent06_t3_installed_kernel_origin.TestOriginalInstalledT2Origin"


def validate(path: Path) -> int:
    root = ET.parse(path).getroot()
    if root.tag == "testsuites":
        suites = list(root)
    elif root.tag == "testsuite":
        suites = [root]
    else:
        raise ValueError("report root")
    if not suites or any(s.tag != "testsuite" for s in suites):
        raise ValueError("report suites")
    seen = set()
    required_seen = set()
    for suite in suites:
        cases = suite.findall("testcase")
        if int(suite.attrib["tests"]) != len(cases):
            raise ValueError("count mismatch")
        if any(int(suite.attrib[key]) != 0 for key in ("failures", "errors", "skipped")):
            raise ValueError("unsuccessful suite")
        for case in cases:
            cls = case.attrib["classname"]
            name = case.attrib["name"]
            identity = (cls, name)
            if not cls or not name or identity in seen:
                raise ValueError("invalid or duplicate case")
            if any(case.find(tag) is not None for tag in ("failure", "error", "skipped")):
                raise ValueError("unsuccessful case")
            seen.add(identity)
            if cls == CLASS_SUFFIX or cls.endswith("." + CLASS_SUFFIX):
                if name in required_seen:
                    raise ValueError("duplicate required case")
                required_seen.add(name)
    if not REQUIRED <= required_seen:
        raise ValueError("required case absent")
    return len(seen)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    try:
        count = validate(args.report)
    except (OSError, ET.ParseError, ValueError, KeyError):
        print("CORPORATE_AGENT_STARTUP_WITNESS_INVALID")
        return 1
    print(f"CORPORATE_AGENT_STARTUP_WITNESS_PASSED={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
