"""Finite, non-private evidence from the original Node and pytest runners."""
import re


NODE_KEYS = ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo')
NODE_COUNT = re.compile(r'# (' + '|'.join(NODE_KEYS) + r') (0|[1-9][0-9]{0,8})')


def node_counts(output):
    """Read a single complete, internally consistent Node TAP summary."""
    if type(output) is not str:
        return None
    counts = {}
    for line in output.splitlines():
        match = NODE_COUNT.fullmatch(line)
        if match is None:
            continue
        key, number = match.groups()
        if key in counts:
            return None
        counts[key] = int(number)
    if set(counts) != set(NODE_KEYS):
        return None
    if counts['tests'] != sum(counts[k] for k in ('pass', 'fail', 'cancelled', 'skipped', 'todo')):
        return None
    return counts


def node_accepted(exit_code, native_gate, counts):
    """No skipped, todo, cancelled or incomplete tests in the release gate."""
    return (type(exit_code) is int and exit_code == 0 and native_gate is True
            and counts is not None and counts['tests'] > 0
            and counts['pass'] == counts['tests']
            and not any(counts[k] for k in ('fail', 'cancelled', 'skipped', 'todo')))


def skip_kind(skipped, collection):
    if collection:
        return 'COLLECTION'
    return {'pytest.skip': 'CASE_SKIP', 'pytest.xfail': 'EXPECTED_FAILURE'}.get(
        skipped.get('type'), 'OTHER_SKIP')


def skip_report(label, catalog, emit):
    """Emit only original catalog ordinals, fixed categories and counts."""
    if len(catalog) != len(set(catalog)):
        raise ValueError('SKIP_CATALOG_INVALID')
    ordinals = {owner: i + 1 for i, owner in enumerate(catalog)}

    def report(owner, kind, count):
        if (owner not in ordinals or kind not in ('COLLECTION', 'CASE_SKIP', 'EXPECTED_FAILURE', 'OTHER_SKIP')
                or type(count) is not int or count < 1):
            raise ValueError('SKIP_EVIDENCE_INVALID')
        emit(label + '_SKIP_MODULE', f'{ordinals[owner]}:{kind}:{count}')

    return report
