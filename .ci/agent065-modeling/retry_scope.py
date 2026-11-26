"""Select prior failure modules, compare only matched pytest case identities."""
from collections import Counter
import re
import xml.etree.ElementTree as ET
from report_evidence import skip_kind

CORE_COUNT = 446
MODELING_COUNT = 24
CORE_RETRY = (15,17,47,58,72,80,81,93,94,95,100,101,102,103,106,107,126,130,234,236,244,245,298,321,334,392,394,399,401,414,443)
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


def read_outcomes(report, files, diagnostic=None, *, skip_diagnostic=None):
    """None means missing collection/infrastructure/ambiguous evidence, never PASS.

    xunit1's file attribute is the definition location, not always the
    collector's module (e.g. imported test functions). The classname is
    derived from the collected pytest nodeid. Preserve each collector's
    identity instead of crediting its tests to the definition location.
    """
    allowed = set(files)
    modules = {p.removesuffix('.py').replace('/','.'):p for p in files}
    ordinals = {p:i+1 for i,p in enumerate(files)}
    rows = {}
    skips = Counter()

    def reject(reason, owner=None):
        if diagnostic is not None:
            diagnostic(reason, ordinals.get(owner,0))
        return None

    try:
        for c in ET.parse(report).iter('testcase'):
            path = c.get('file','').replace('\\','/')
            cls, name = c.get('classname',''), c.get('name','')
            skipped = c.find('skipped')
            collection = (not cls and path in allowed and skipped is not None and
                          skipped.get('message') == 'collection skipped' and
                          name == path.removesuffix('.py').replace('/','.'))
            if collection:
                cls = '__collection__'
            candidates = [owner for module,owner in modules.items()
                          if cls == module or cls.startswith(module+'.')]
            if len(candidates) > 1:
                return reject('AMBIGUOUS_COLLECTOR',path)
            owner = candidates[0] if candidates else path
            # A canonical Python definition path may differ from the selected
            # collector only when its exact module identity is known.
            if (path not in allowed and
                    (not candidates or not re.fullmatch(r'tests/(?:[A-Za-z0-9_]+/)*[A-Za-z0-9_]+\.py',path))):
                return reject('UNKNOWN_DEFINITION',owner)
            if owner not in allowed or not cls or not name:
                return reject('MISSING_IDENTITY',owner)
            key = (owner,cls,name)
            if key in rows:
                return reject('DUPLICATE_IDENTITY',owner)
            rows[key] = ('FAIL' if c.find('failure') is not None or c.find('error') is not None
                         else 'SKIP' if skipped is not None else 'PASS')
            if rows[key] == 'SKIP':
                skips[owner, skip_kind(skipped, collection)] += 1
    except (OSError, ValueError, ET.ParseError):
        return reject('REPORT_UNREADABLE')
    if not rows:
        return reject('EMPTY_REPORT')
    missing = allowed - {key[0] for key in rows}
    if missing:
        for owner in sorted(missing):
            reject('MODULE_NOT_COLLECTED',owner)
        return None
    if skip_diagnostic is not None:
        for (owner, kind), count in sorted(skips.items()):
            skip_diagnostic(owner, kind, count)
    return rows

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
