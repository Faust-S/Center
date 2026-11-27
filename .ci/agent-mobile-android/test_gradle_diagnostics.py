import unittest
from gradle_diagnostics import failure_kinds, http_statuses


class GradleDiagnosticsTests(unittest.TestCase):
    def test_artifact_resolution_and_transport(self):
        report = "Could not resolve all artifacts for configuration ':classpath'.\nCould not GET 'https://example.invalid/private'. Received status code 503 from server: Service Unavailable"
        self.assertEqual(failure_kinds(report), ('ARTIFACT_RESOLUTION', 'HTTP_TRANSPORT'))
        self.assertEqual(http_statuses(report), ('503',))

    def test_network_timeout_and_connection(self):
        self.assertEqual(failure_kinds('Caused by: java.net.SocketTimeoutException: Read timed out'), ('NETWORK_TIMEOUT',))
        self.assertEqual(failure_kinds('Caused by: java.net.SocketException: Connection reset'), ('NETWORK_CONNECTION',))

    def test_daemon_and_resource(self):
        self.assertEqual(failure_kinds('Gradle build daemon disappeared unexpectedly'), ('DAEMON_LOST',))
        self.assertEqual(failure_kinds('Unable to start the daemon process. Could not reserve enough space'), ('DAEMON_START', 'JVM_RESOURCE'))

    def test_cache_and_filesystem(self):
        self.assertEqual(failure_kinds('Timeout waiting to lock file hash cache'), ('CACHE_LOCK',))
        self.assertEqual(failure_kinds('Could not move temporary workspace: AccessDeniedException'), ('CACHE_IO', 'FILESYSTEM'))

    def test_plugin_sdk_and_checksum(self):
        self.assertEqual(failure_kinds('Failed to apply plugin x'), ('PLUGIN_APPLICATION',))
        self.assertEqual(failure_kinds('Failed to find Build Tools revision 35.0.0'), ('SDK_PACKAGE',))
        self.assertEqual(failure_kinds('Dependency verification failed'), ('CHECKSUM',))

    def test_no_raw_private_text_and_unclassified(self):
        self.assertEqual(failure_kinds('BUILD FAILED\nprivate token abc123\n/private/source:123'), ('UNCLASSIFIED',))
        self.assertEqual(http_statuses('private number 503\nReceived status code 200\nHTTP response code: 999'), ())
        self.assertEqual(http_statuses('Received status code 503\nReceived status code 401\nHTTP response code: 503'), ('401', '503'))


if __name__ == '__main__':
    unittest.main()
