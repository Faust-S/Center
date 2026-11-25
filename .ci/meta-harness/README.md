# Meta-Harness qualification admission

This branch runs explicitly requested qualification only. Changes to source pins,
workflow definitions, tests, documentation or qualification scripts are not
requests. Keep the exact private source commit/tree identity in each workflow.

During development, accumulate changes in the private work branch. Do not update
a request while another source candidate is waiting unless the replacement is
intentional. First read outstanding results. Do not run private Actions.

To request a gate, deliberately create or change its JSON file under
`.ci/meta-harness/requests/` in a push to this branch. The file is a trigger
and audit record, not an authority source; the workflow's exact immutable pins
remain authoritative. Record candidate_commit, candidate_tree, purpose and
changed gate. Update the workflow's pin/tree in the same commit if necessary.
Do not create these files merely to document progress.

| Request file | Gate |
| --- | --- |
| source.json | Combined source gate: existing adapter/product and complete composer/Task coverage, one Python/npm setup and Desktop build per OS. |
| installed.json | Installed native Windows GUI and restart. |
| native-qwen.json | Actual four native Qwen scenarios; run after source gate on the same candidate. |
| performance.json | Paired ordinary Agent route timing; only if ordinary paths changed or at final acceptance. |
| integration.json | Exact read-only merge rehearsal; rerun when a target revision or overlapping files change. |
| diagnostic-composer.json | Isolated composer diagnostics only, not an extra routine gate. |
| diagnostic-acp.json | Isolated public native ACP diagnostic. |
| diagnostic-qwen-product.json | Isolated historical native product diagnostic. |
| diagnostic-qwen-tool.json | Isolated native ToolRuntime diagnostic. |

The source gate preserves the previous active ADAPTER_PRODUCT test selection
and COMPOSER_RECOVERY selection, removes duplicate ACP process/state files,
runs every collected original Task node exactly once in four serial shards
(including both ticket regressions), checks witness syntax and compiles Desktop
once per OS. Run the full original source gate, installed GUI, native cases and
the required integration/performance gates for final candidate qualification.
A skipped native test in source CI is not native acceptance.

Each workflow has its own branch-qualified concurrency group; one waiting
candidate supersedes an older waiting candidate in that group. Running jobs are
allowed to finish (including private checkout cleanup). Previously queued jobs
created before this policy are not retroactively canceled. No changes to other
projects, default branches or access permissions are authorized here.
