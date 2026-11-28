"""Public, bounded admission of the installed Android T3 route receipts."""
EXPECTED = frozenset((
    'T3_ENTRY_MODEL_RELEASE', 'T3_MODEL_STAGING_RECOVERY', 'CREATE_OFFLINE',
    'NATIVE_TRANSCRIPT_ENCRYPTED', 'NATIVE_TRANSCRIPT_COLD', 'NATIVE_TRANSCRIPT_CLEANUP',
    'NATIVE_DRAFT_SAVED', 'COLD_RESTART', 'NATIVE_DRAFT_REOPENED', 'LIFECYCLE_RESTORE',
    'EXCHANGE_SAVE_CANCELLED', 'EXCHANGE_FILE_SAVED', 'EXCHANGE_STAGING_RECOVERY',
    'EXCHANGE_PREVIEW_CANCELLED', 'EXCHANGE_IMPORTED', 'EXCHANGE_COLD_READBACK',
    'HISTORY_ORIGINAL_SAVED', 'HISTORY_NEW_CHAT', 'HISTORY_COLD_REOPENED',
))


def values(report, key):
    prefix = key + '='
    return [line[len(prefix):] for line in report.splitlines() if line.startswith(prefix)]


def route_receipts(report):
    return values(report, 'INSTALLED_T3_ROUTE_PASS')


def route_passed(report, returncode):
    return (returncode == 0 and sorted(route_receipts(report)) == sorted(EXPECTED)
            and values(report, 'INSTALLED_T3_ACTIVE_COPY_ISOLATED') == ['PASS']
            and values(report, 'INSTALLED_T3_ACTIVE_COPY_RESTORED') == ['PASS']
            and values(report, 'INSTALLED_T3_ROUTE') == ['PASS'])
