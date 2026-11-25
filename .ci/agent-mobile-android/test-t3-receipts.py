import unittest
from t3_receipts import EXPECTED, route_receipts, route_passed


def report(receipts=None, terminal=('PASS',), separator='\n'):
    values = sorted(EXPECTED, reverse=True) if receipts is None else receipts
    return separator.join(['INSTALLED_T3_ROUTE_PASS='+v for v in values]
                          + ['INSTALLED_T3_ROUTE='+v for v in terminal]) + separator


class TestT3Receipts(unittest.TestCase):
    def test_exact_complete(self):
        self.assertEqual(len(EXPECTED), 13)
        self.assertTrue(route_passed(report(), 0))
    def test_digits(self):
        values = route_receipts(report())
        self.assertIn('T3_ENTRY_MODEL_RELEASE', values)
        self.assertIn('T3_MODEL_STAGING_RECOVERY', values)
    def test_missing_receipt(self):
        for missing in EXPECTED:
            self.assertFalse(route_passed(report(sorted(EXPECTED-{missing})), 0))
    def test_duplicate(self):
        self.assertFalse(route_passed(report(sorted(EXPECTED)+['T3_ENTRY_MODEL_RELEASE']), 0))
    def test_unexpected_code(self):
        self.assertFalse(route_passed(report(sorted(EXPECTED)+['UNKNOWN_1']), 0))
    def test_malformed_code(self):
        for malformed in ('', 'private message', ' T3_ENTRY_MODEL_RELEASE', 'EXCHANGE_IMPORTED '):
            self.assertFalse(route_passed(report(sorted(EXPECTED)+[malformed]), 0))
    def test_failed_terminal(self):
        self.assertFalse(route_passed(report(terminal=('FAIL',)), 0))
    def test_conflicting_or_duplicate_terminal(self):
        for terminal in ((), ('PASS','FAIL'), ('PASS','PASS')):
            self.assertFalse(route_passed(report(terminal=terminal), 0))
    def test_failed_process(self):
        self.assertFalse(route_passed(report(), 1))
    def test_crlf(self):
        self.assertTrue(route_passed(report(separator='\r\n'), 0))


if __name__ == '__main__':
    unittest.main()
