"""Public fixed aggregate diagnostics. Never emit private logs or test contents."""
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
path, label, minimum, mode = sys.argv[1:]
if not Path(path).is_file():
    print(label + "_REPORT_MISSING")
    raise SystemExit(1)
root = ET.parse(path).getroot()
cases = list(root.iter("testcase"))
fail = skipped = 0
for n, case in enumerate(cases, 1):
    errors = [x for x in case if x.tag in ("failure", "error")]
    if errors:
        fail += 1
        print(label + "_FAILED_CASE=" + str(n))
        for error in errors:
            for code in sorted(set(re.findall(r"\b(?:allocation|schedule|modeling|u01|program|simpy|network_flow|routing|road_matrix|qgis|valhalla)_[a-z0-9_]+\b", (error.get("message") or "") + (error.text or ""))))[:8]:
                print(label + "_CODE=" + code)
            # Fixed connection diagnostics, never arbitrary exception strings.
            for status in sorted(set(re.findall(r"\b(?:VALHALLA_CORE_CONNECT_(?:VERSION_UNVERIFIED|NOT_FOUND|CONNECTED|CLI_EXECUTION_FAILED|CLI_TIMED_OUT|CLI_OUTPUT_ENCODING_UNSUPPORTED|INSTALLATION_MISMATCH|CONNECTION_LOST|None)|QGIS_(?:NATIVE_PROBE_(?:EXIT_NONZERO|MARKER_MISSING)|(?:DIRECT|CORE)_CONNECT_(?:VERSION_UNVERIFIED|NOT_FOUND|CONNECTED|CLI_EXECUTION_FAILED|CLI_TIMED_OUT|CLI_OUTPUT_ENCODING_UNSUPPORTED|INSTALLATION_MISMATCH|CONNECTION_LOST|None)))\b", (error.get("message") or "") + (error.text or "")))):
                print(label + "_NATIVE_STATUS=" + status)
            # Fixed exception classes and line numbers only; no private source or error text.
            message = (error.get("message") or "") + (error.text or "")
            for kind in sorted(set(re.findall(r"\b(?:AssertionError|ValueError|TypeError|KeyError|RuntimeError|ProviderError|ToolProviderPortError|InteractionSurfaceError|WitnessError|OSError|AttributeError)\b", message)))[:6]:
                print(label + "_ERROR_TYPE=" + kind)
            for location in re.findall(r"test_agent067_(?:ortools_(?:allocation|scheduling|network_flow|vehicle_routing)|road_matrix_input|qgis_points|qgis_road_input|valhalla_road_table|valhalla_fleet_input)\.py:(\d+)", message)[:8]:
                print(label + "_TEST_LINE=" + location)
    if case.find("skipped") is not None:
        skipped += 1
print(label + "_TESTS=" + str(len(cases)))
print(label + "_PASS=" + str(len(cases)-fail-skipped))
print(label + "_FAIL=" + str(fail))
print(label + "_SKIP=" + str(skipped))
raise SystemExit(int(fail != 0 or len(cases) < int(minimum) or mode == "strict" and skipped != 0))
