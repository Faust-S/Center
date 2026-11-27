"""Bounded diagnostics for captured Gradle failures; never returns raw output."""
import re

# Match known Gradle/JVM/transport failures missed by the original categories.
PATTERNS = (
    ('ARTIFACT_RESOLUTION', r'Could not resolve all artifacts|Could not resolve (?:plugin artifact|[^\s:]+:[^\s:]+:[^\s:]+)|Could not download [^\r\n]+'),
    ('HTTP_TRANSPORT', r'Could not (?:GET|HEAD|POST|PUT)\b|Received status code [1-5][0-9]{2}|HTTP (?:response )?(?:code |status )?[1-5][0-9]{2}'),
    ('NETWORK_TIMEOUT', r'Read timed out|Connect timed out|connection timed out|Timeout waiting for connection|ConnectTimeoutException|SocketTimeoutException'),
    ('NETWORK_CONNECTION', r'Connection reset|Connection refused|Network is unreachable|UnknownHostException|SSLHandshakeException|PKIX path building failed|Remote host terminated the handshake|Broken pipe'),
    ('DAEMON_LOST', r'Gradle build daemon disappeared|DaemonDisappearedException|daemon has disappeared|daemon stopped unexpectedly'),
    ('DAEMON_START', r'Unable to start the daemon process|Could not start (?:the )?Gradle daemon|Could not create the Java Virtual Machine'),
    ('CACHE_LOCK', r'Timeout waiting to lock|Cannot lock (?:file hash|execution history|journal|cache|build logic)|LockTimeoutException|already locked by this process'),
    ('CACHE_IO', r'Could not (?:move temporary workspace|read workspace metadata|create parent directory|create directory|write to cache|load the value of field)|CorruptedCacheException|Failed to create Jar file'),
    ('SERVICE_INITIALIZATION', r'Could not create service of type|Could not initialize class|ExceptionInInitializerError|Unable to load class'),
    ('PLUGIN_APPLICATION', r'Failed to apply plugin|An exception occurred applying plugin request|Error resolving plugin'),
    ('JVM_RESOURCE', r'Could not reserve enough space|unable to create native thread|OutOfMemoryError|GC overhead limit exceeded|Cannot allocate memory'),
    ('FILESYSTEM', r'No space left on device|Read-only file system|Permission denied|AccessDeniedException|FileSystemException'),
    ('SDK_LICENSE', r'license agreements? (?:have )?not (?:been )?accepted|licenses? for the following SDK components have not been accepted'),
    ('SDK_PACKAGE', r'Failed to install the following Android SDK packages|Failed to find target with hash string|Failed to find Build Tools revision'),
    ('CERTIFICATE', r'certificate_unknown|unable to find valid certification path|SSLPeerUnverifiedException'),
    ('CHECKSUM', r'Checksum verification failed|Dependency verification failed|Artifact verification failed|Verification of Gradle distribution failed'),
    ('INCOMPATIBLE_JVM', r'UnsupportedClassVersionError|Unsupported class file major version|requires JVM runtime version|requires at least JVM runtime version'),
    ('COMPILER_DAEMON', r'Could not connect to Kotlin compile daemon|Kotlin daemon compilation failed'),
)


def failure_kinds(report):
    return tuple(kind for kind, pattern in PATTERNS if re.search(pattern, report, re.IGNORECASE)) or ('UNCLASSIFIED',)


def http_statuses(report):
    # Only standard, bounded statuses from actual Gradle transport exceptions.
    values = re.findall(r'Received status code ([45][0-9]{2})\b|HTTP response code: ([45][0-9]{2})\b', report, re.IGNORECASE)
    return tuple(sorted({a or b for a, b in values}))
