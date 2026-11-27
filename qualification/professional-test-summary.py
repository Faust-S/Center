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
            for code in sorted(set(re.findall(r"\\b(?:allocation|modeling|u01|program)_[a-z0-9_]+\\b", (error.get("message") or "") + (error.text or ""))))[:8]:
                print(label + "_CODE=" + code)
    if case.find("skipped") is not None:
        skipped += 1
print(label + "_TESTS=" + str(len(cases)))
print(label + "_PASS=" + str(len(cases)-fail-skipped))
print(label + "_FAIL=" + str(fail))
print(label + "_SKIP=" + str(skipped))
raise SystemExit(int(fail != 0 or len(cases) < int(minimum) or mode == "strict" and skipped != 0))
