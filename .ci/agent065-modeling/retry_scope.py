"""Select prior failure modules, compare only matched pytest case identities."""
from collections import Counter
import xml.etree.ElementTree as ET

CORE_COUNT = 446
MODELING_COUNT = 24
CORE_RETRY = (15,17,47,58,72,80,93,94,95,100,101,102,103,106,107,126,130,234,236,244,245,298,321,334,392,394,399,401,414)
MODELING_RETRY = tuple(range(1,MODELING_COUNT+1))
BASELINE_PIN = '4cecffe7786a0afbf198a847d8368e4e8549e98a'
BASELINE_TREE = 'a3a5ab786f4f9d31e6494e53bd3a67451b6e710d'


def select_modules(catalog, count, ordinals):
    if len(catalog) != count or list(catalog) != sorted(set(catalog)):
        raise ValueError('RETRY_CATALOG_CHANGED')
    if (not ordinals or tuple(ordinals) != tuple(sorted(set(ordinals)))
            or any(type(n) is not int or not 1 <= n <= count for n in ordinals)):
        raise ValueError('RETRY_ORDINAL_INVALID')
    return [catalog[n-1] for n in ordinals]


def parse_outcomes(report, files):
    """Return exact case identities and a finite diagnostic, without private data."""
    allowed = set(files)
    rows = {}
    try:
        for c in ET.parse(report).iter('testcase'):
            path = c.get('file','').replace('\\','/')
            cls, name = c.get('classname',''), c.get('name','')
            # pytest's xunit1 report for module-level collection skips has
            # a real file, empty classname and the module name as testcase.
            # Count only that precise record, never arbitrary empty identities.
            skipped = c.find('skipped')
            if not cls and path in allowed and skipped is not None and (
                    skipped.get('message') == 'collection skipped' and
                    name == path.removesuffix('.py').replace('/','.')):
                cls = '__collection__'
            key = (path,cls,name)
            if path not in allowed:
                return None, 'UNMAPPED_FILE'
            if not cls or not name:
                return None, 'EMPTY_IDENTITY'
            if key in rows:
                return None, 'DUPLICATE_IDENTITY'
            rows[key] = ('FAIL' if c.find('failure') is not None or c.find('error') is not None
                         else 'SKIP' if c.find('skipped') is not None else 'PASS')
    except (OSError, ValueError, ET.ParseError):
        return None, 'INVALID_REPORT'
    if not rows:
        return None, 'EMPTY_REPORT'
    if {key[0] for key in rows} != allowed:
        return None, 'MISSING_MODULE'
    return rows, 'EXACT'


def read_outcomes(report, files):
    return parse_outcomes(report, files)[0]


def failed_modules(outcomes, files):
    if outcomes is None:
        return list(files)
    failed = {key[0] for key,value in outcomes.items() if value == 'FAIL'}
    return [path for path in files if path in failed] or list(files)


def compare_failures(candidate, baseline):
    """Matching failure is not proof of the same root cause."""
    if candidate is None or baseline is None:
        return None
    counts = Counter({'BOTH_FAILED':0,'BASELINE_PASSED':0,'BASELINE_SKIPPED':0,'BASELINE_UNMATCHED':0})
    for key,value in candidate.items():
        if value != 'FAIL':
            continue
        counts[{'FAIL':'BOTH_FAILED','PASS':'BASELINE_PASSED','SKIP':'BASELINE_SKIPPED'}.get(
            baseline.get(key),'BASELINE_UNMATCHED')] += 1
    return dict(counts)
