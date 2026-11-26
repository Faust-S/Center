"""Select prior failure modules, compare only matched pytest case identities."""
from collections import Counter
import xml.etree.ElementTree as ET

CORE_COUNT = 445
MODELING_COUNT = 24
CORE_RETRY = (15,17,47,58,72,80,93,94,95,100,101,102,103,106,107,126,130,234,236,244,245,298,321,334,392,394,399)
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


def read_outcomes(report, files):
    """None means collection/infrastructure/ambiguous evidence, never a PASS."""
    allowed = set(files)
    rows = {}
    try:
        for c in ET.parse(report).iter('testcase'):
            path = c.get('file','').replace('\\','/')
            cls, name = c.get('classname',''), c.get('name','')
            key = (path,cls,name)
            if path not in allowed or not cls or not name or key in rows:
                return None
            rows[key] = ('FAIL' if c.find('failure') is not None or c.find('error') is not None
                         else 'SKIP' if c.find('skipped') is not None else 'PASS')
    except (OSError, ValueError, ET.ParseError):
        return None
    return rows if rows and {key[0] for key in rows} == allowed else None


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
