# Original T4 Kernel DB9 qualification from local authorized source
26.11.2026. This does not activate or release the Kernel.

Two routes share the original qualification body: the previous exact Center
workflow and the local Linux/WSL launcher. The local route does not require a
GitHub Actions secret. It needs an already authorized Git clone of Faust-S/T2
containing commit ba821f351f95b2c986e9d748a156daf7bddc2acc and tree
52d51591b10cbbc9fd88e4d7ee12a8571dd49dcf. No branch checkout or reset is needed.

From this Center work branch, run:
    cd qualification/t4-db9
    python3 -m unittest -v test_local_source.py test_qualify_local.py
    python3 qualify_local.py --t2-checkout /path/to/authorized/T2 --preflight-only

The source preflight reads immutable Git objects, verifies every selected
blob, creates a private temporary subtree, and removes it. It does not
read the dirty worktree, copy .git, fetch a remote, run the Kernel, or change
any original branch. DB9_FOCUSED_QUALIFICATION=NOT_RUN is expected.

For full qualification install the exact toolchain already required by
Center (Node v24.18.1, npm 11.16.0, Python 3 with Path.is_relative_to,
Git, and the supported local headless browser at one of the witness paths).
The private build gets a new isolated HOME/cache and no inherited user
token variables. An npm ci from the original lock may need access to the
public npm registry. No private source is published.
    python3 qualify_local.py --t2-checkout /path/to/authorized/T2 --qualify

The shared qualifier reconstructs the original predecessor, DB8 and DB9,
checks the exact change hashes, typechecks/builds, runs five focused test
files and the original native IndexedDB witness. Only successful execution
may produce DB9_FOCUSED_QUALIFICATION=PASS. This is a DB9 qualification,
not installed T4, Windows GUI or independent Codex acceptance.

The local launcher refuses GitHub Actions. The existing Center workflow
and its exact runner/branch gate are unchanged; do not trigger it until
the owner restores the authorized T2 source read grant. Do not add a
workflow for the local launcher.

Local tests on synthetic Git objects: 12/12 PASS; launcher boundary tests
with a qualification double: 5/5 PASS. Original source and shared DB9
execution: NOT_RUN. No fake original runtime or qualified DB9 distribution
is created.
