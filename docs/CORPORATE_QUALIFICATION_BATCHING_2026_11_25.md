# Corporate qualification batching (2026-11-25)

The installed qualification branch is not a production release.
Use the existing two isolated installed witnesses: signed license lifecycle
(24 receipts) and independent employee (14 + 18 receipts). No receipt is removed.
The license lifecycle ends in revocation; it cannot reuse the active employee
fixture. The employee workflow builds and qualifies the original Agent itself.
A shared change should be pushed once with `ci(admin):` to run both relevant
witnesses without an additional standalone Agent job when Agent/T3/One Core
pins did not change. A change to Agent or its dependencies requires its normal
qualification. Do not interpret a skipped job as a new PASS.

Before expensive packaging run the cheap exact regressions for the changed
witness/owner. Collect independent results from unchanged immutable revisions;
do not rerun their full standalone product matrix after a witness-only edit.
Product development branches can batch interim commits with [skip ci]. A final
changed product still requires its own affected qualification before release.

Known open gates:
- installed employee Center cold roster recovery;
- signed renewal after persisted successor preparation;
- actual installed original Kernel successor. The original accepted archive
  is still pinned in One Core, Center and Agent. The source-built candidate
  passed 43 source tests and 2 cross-product tests on each OS in
  Faust-S/knowledge run 45596499435, but is explicitly unaccepted and
  cannot be relabeled as the old release or silently patched into an installer.
  Use the canonical T2 successor identity and matching bytes in all products
  before accepting the final cross-product return route.

Never upload private source, native packages, raw logs, credentials or
private .iwxa evidence from public Center CI. Keep stable branches unchanged.
