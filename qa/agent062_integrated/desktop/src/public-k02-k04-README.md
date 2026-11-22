# K02/K04 in-process owner source for Agent 0.5

The original owners are in the public `Faust-S/knowledge` repository.

| Owner | Locked commit | Original Git blob | Adapted Git blob |
| --- | --- | --- | --- |
| K02 `modules/k02-interoperability/index.mjs` | `8f26a071dcb8b0b4a29f05d4fb9979ff883d2b35` | `6dd21b566f6dfe3d2e920d3e877548361653460e` | `bad62b56795b347092c538429ccab121e2c6c4c1` |
| K04 `modules/k04-composer/index.mjs` | `283275ca000374548cad48cc8992fe06048d5cc6` | `fda705e614218aca0f283068a516a3487a674732` | `8dd047319e84acd0565f7aea949cc60093230eee` |
| K02 `model-step-selection.mjs` | `8f26a071dcb8b0b4a29f05d4fb9979ff883d2b35` | `45263714c1c2440406889e4ba5791686bc386c8f` | unchanged |
| Agent K02 recommendation port | Agent integrated candidate `b4b90dfa6011432998a16629f4365018245e6b27` | `40c39c20b8c6dc6032ecfc8411384566b1f95c49` | unchanged |

For the K02 and K04 index files only, the `node:crypto` import is substituted with `../owner-hash-shim.mjs`,
and `Buffer.byteLength` is bound to its UTF-8 implementation. All other
algorithm text is identical to the locked owner source. The shim uses the
already-installed `@noble/hashes@2.4.0`; no Node process, separate EXE,
new Core or new dependency is required at user runtime.

`../owner-plans-inprocess.mjs` preserves the existing K02/K04 owner request
shape, runs the same optional K02 model recommendation adapter (including
negative trial evidence), returns non-executing plans, checks task/model agreement and
keeps the original 1 MB request and 120 KB plan limits. It does not claim
U01-origin receipts. The existing `graph_model_choice_prepare` remains
receipt-bound and must not be fed a fabricated receipt.

Run from `desktop/` after `npm ci`:
```
node --test tests/agent05-inprocess-k02-k04.test.mjs tests/agent05-inprocess-core-task-preview.test.mjs
npm run verify:desktop
```

**Agent 0.5 in-process UI path:** the existing Chain Builder offers a
user-triggered compatibility check for a Graph step linked to a closed,
human-accepted Core Task. It reads `task`, `task_skills`,
`graph_node_configs` and the CURRENT model inventory from Python Core.

The original Task acceptance digest is included in the K04 source revision,
so a changed accepted Result cannot silently reuse an earlier plan. For the
selected model, the adapter uses the already-shipped
`observedLocalModels` normalizer. It excludes cloud/remote models, normalizes
`sha256:` digests and rejects stale or unconfirmed model sources.

A user may preview the **currently active model** without selecting it
again, or preview a **per-step explicitly pinned model**. The UI displays
which of these two choices it checked. For an active-model preview, the
user can explicitly select **Pin this model for the step**. That action
rechecks Core's inventory and uses the original per-step `local_model`
configuration: it does not switch global models, grant inference authority
or create another Graph/store. Core still owns save, human review, execution
and Result readback through the existing Graph workflow.

The preview covers the **Task objective + one text-generation requirement**
and its Task Skill route. It does **not** claim compatibility with external
tools/attachments, observed model quality, task completion or a full
owner-attested multi-model recommendation. It never mints U01 receipts.
No Task content is included in the browser's preview response.

**Verification to date:** isolated JavaScript execution of the pinned K02/K04
owner source passed 18/18 targeted scenarios (including native SHA-256 parity,
active Ollama/GGUF, accepted-result revision binding, stale/remote model
refusal and manual model override). These are NOT the full Node test suite,
Vite/TypeScript build or installed Windows GUI qualifications.


**Existing Core Graph execution settings (Agent 0.5):** Each model node
now exposes its existing `timeout_seconds` (1-600) and
`max_output_tokens` (1-65536) as optional expanded inputs. Defaults remain
120 seconds / 2048 tokens. They are stored in the original immutable
GraphNodeConfig, restored by `savedSteps` on reopen and used by the same
ModelProviderPort. IWXA LLM Engine no longer silently caps Graph output at 2048 tokens.
The original llama.cpp provider now allocates a bounded context for
each request using the selected GGUF architecture context metadata.
Its warm server can restart its *owned* session with a larger context
when the user requests more output. A too-small model context produces
an explicit error, not a fabricated complete Result. The shared
ModelProviderPort maximum is 65536 output tokens, with a 131072
backend context bound; actual feasibility depends on the model, memory
and CPU time. Reasoning effort remains the user's separate model
preference and is not simulated by output-token limits.

The existing Graph's `max_elapsed_ms` is derived from its selected
step timeouts with a 20-minute minimum for short workflows, respecting the
Core's 24-hour upper bound. During a real `graph_advance` call, the
editor shows elapsed wall time only, no fabricated ETA or cancellation.
No command is automatically replayed if a response is lost.

Runtime transport tests are in
`tests/test_iwxa_basic_generation_budget.py`,
`tests/test_iwxa_gguf_metadata.py`,
`tests/test_iwxa_basic_model_binding.py`,
`tests/test_iwxa_llm_warm_session.py` and
`tests/test_daily_driver.py`. These cover model-specific context
observation, ordinary Task output, cold CLI arguments and warm context
growth/reuse. The selected model's recorded training context is
visible in Models without reparsing its GGUF on every UI poll.
Historical selected GGUF bindings without the optional context field
are still accepted.

The regression tests `desktop/tests/graph-config-stable-id.test.mjs` and
`tests/test_agent05_pinned_graph_restart.py` now cover custom budget
readback, the native Graph model pin, persisted final Result and absence
of duplicate invocation after reopening. The Python tests use a deterministic
in-memory model fixture and are **authored, not executed** on the private
checkout in this environment.


**2026-11-13 follow-up: verified isolated Python work.** The exact source
Git blobs for `runtime/iwxa_basic_generation_budget.py`,
`tests/test_iwxa_basic_generation_budget.py`,
`runtime/iwxa_gguf_metadata.py`, and
`tests/test_iwxa_gguf_metadata.py` were copied into a local isolated
Python 3/pytest 9.0.2 harness. Their SHA-1 Git blob identities were
verified against this private branch; 22/22 existing tests passed.
Only the `gguf_header` dependency was represented by a small synthetic
header stub for these metadata tests. That is **not** full application
pytest or any inference/model/Windows qualification.

The normal conversation route now uses the existing Core
`defaults.max_output_tokens` preference instead of always forcing
2048 tokens on detailed replies. Simple questions retain a fast
512-token default (or a smaller configured preference); explicit
detailed requests and source-bearing chat use the configured budget.
This applies equally to Ollama and IWXA GGUF, without inspecting model
wording to choose a model. Existing reasoning-effort controls remain
independent. Context-budget failures retain exact Core codes and
surface a specific actionable message instead of a generic failure.
Regressions were authored in `tests/test_daily_driver.py` and
`desktop/tests/dialog-conversation.test.mjs`; the latter UI error
function was separately executed using the committed function body.

**Windows private-source qualification update (13.11.2026):** Public Center
run [43477979826](https://github.com/Faust-S/Center/actions/runs/43477979826)
completed SUCCESS against exact private product commit
`a86af63fda308793a4526ea0a25695e7ac311db4` (before this documentation
amendment). The run executed real Python GGUF metadata / cold / warm / Graph
/ Task tests, targeted plus full desktop Node suites and the TypeScript/Vite
build. It included the full Graph Result UI and 65536-token port-boundary
regressions. This validates source and built frontend, **not** installed
Windows GUI or true GGUF inference. The separate native run
[43477935504](https://github.com/Faust-S/Center/actions/runs/43477935504)
is the required additional checkpoint. Private build outputs stay only in
Center runner temporary directories, without uploaded artifacts.

The old receipt-backed K02/K04 path remains available only as an advanced
option for existing U01 receipts. Actual origin attestation of the new
in-process owner output in immutable Core Graph provenance is **not yet
implemented**; it must not be confused with this real but non-authoritative
local compatibility preview. The full desktop Node/Vite build and installed
Windows qualification have not yet run on this branch.
