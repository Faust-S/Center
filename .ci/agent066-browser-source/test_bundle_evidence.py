import unittest
from bundle_evidence import summarize, REQUIRED, COUNT

OK = '\n'.join([f'{k}={v}' for k,v in REQUIRED.items()] + [COUNT+'=27'])


class BundleEvidenceTests(unittest.TestCase):
    def test_complete(self):
        ok, summary = summarize(0, OK)
        self.assertTrue(ok)
        self.assertEqual(len(summary), 6)

    def test_missing(self):
        for key in REQUIRED:
            with self.subTest(key=key):
                self.assertFalse(summarize(0, '\n'.join(s for s in OK.splitlines() if not s.startswith(key+'=')))[0])

    def test_nonzero(self):
        self.assertFalse(summarize(1, OK)[0])

    def test_duplicate(self):
        self.assertFalse(summarize(0, OK+'\n'+COUNT+'=27')[0])

    def test_out_of_range(self):
        for count in ('0', '7', '501', '999999', 'private text'):
            with self.subTest(count=count):
                ok, summary = summarize(0, OK.replace(COUNT+'=27', COUNT+'='+count))
                self.assertFalse(ok)
                self.assertNotIn(COUNT, summary)

    def test_bounded_failure(self):
        ok, summary = summarize(1, 'B066_BUNDLE_STAGE=MCP_INITIALIZE\nB066_BUNDLE_CODE=stdio_unsupported_negotiation')
        self.assertFalse(ok)
        self.assertEqual(summary['B066_BUNDLE_CODE'], 'stdio_unsupported_negotiation')

    def test_unknown_fields_not_forwarded(self):
        ok, summary = summarize(0, OK+'\nB066_BUNDLE_SECRET=private text\nB066_BUNDLE_CODE=private text')
        self.assertFalse(ok)
        self.assertNotIn('B066_BUNDLE_SECRET', summary)
        self.assertNotIn('B066_BUNDLE_CODE', summary)

    def test_raw_logs_not_forwarded(self):
        ok, summary = summarize(0, OK+'\nraw server stderr: private text')
        self.assertTrue(ok)
        self.assertNotIn('private text', str(summary))

    def test_success_with_failure_markers(self):
        self.assertFalse(summarize(0, OK+'\nB066_BUNDLE_STAGE=MCP_CATALOG')[0])


if __name__ == '__main__':
    unittest.main()
