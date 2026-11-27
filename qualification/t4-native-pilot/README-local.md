# T4 local original K036 qualification

This branch is a local alternative to the blocked public Center run 45952015270. No private Actions, no automatic CI on this branch, no release acceptance. It shares the original reconstruction, build, archive identity and product recipe witness with the existing Center qualification. The only added route supplies exact local Git inputs. No private source files or built artifacts are committed here.

Use an already authorized local clone of Faust-S/T2, Faust-S/T3 and Faust-S/knowledge on Linux or WSL. Fetch the exact revisions through the owner's normal authorized Git access if they are missing. Do not put a PAT, private key or source archive in this repository. The launcher reads local Git objects only; it does not fetch or read mutable worktrees. Node 22.16.0, Python 3.11 (available as python as well), Git, npm and OpenSSL are required for the full qualification. Locked npm installation needs registry access.

From the root of this Center branch:

```sh
python3 qualification/t4-native-pilot/qualify_local.py --t2-checkout /path/to/T2 --t3-checkout /path/to/T3 --core-checkout /path/to/knowledge --preflight-only
python3 qualification/t4-native-pilot/qualify_local.py --t2-checkout /path/to/T2 --t3-checkout /path/to/T3 --core-checkout /path/to/knowledge --qualify
```

Preflight checks the original packaging parent/delta, exact commit/tree, all selected regular Git blobs and their hashes. Full qualification additionally runs native owner regressions (including original mixed Vault, dedicated key custody and live key evidence in both native roles), real mutual TLS startup and original peer-history carrier tests, original K036 reconstruction, locked builds, the exact candidate archive hash, and converged corporate roundtrip and pilot recipe tests on original Runtime. The previous exact source regression is reused as in the Center recipe. Temporary source/build trees and the credential-free build home are removed at the end. Only bounded result codes and test counts are printed. The native qualification remains an original-source test, not an installed Windows GUI or real two-device test.

Exact pins: T2 packaging c28e01876f3230307b7f20449f7ef54374367c93 (parent 4e4ad5c5e566a74f24243b9d0744a6d64652a199), T3 owner 378a2e8ca6de662b5e28562e334c2a97a00ed331, knowledge ee94c259489c6c54720edb18a603ba6be16cb1bb. Candidate archive SHA-256 5320dcb6c42d5fca410880677c8a8b595d4c9a2a6cedf51089b5f60f4ceeb52a. No mutable release pin is promoted.

Local launcher tests: Python 10/10; Node 5/5 (synthetic Git/descriptor fixtures); witness syntax PASS. Full original peer-history carrier suite, original private Kernel qualification and original three-checkout preflight NOT_RUN in this environment; no locally authorized clones available. Ordinary graph exchange does not require five independent additional mutation grants; the optional-mutation test is included in the same owner run. The first installed candidate uses DB8; DB9 is not a first release gate. The corrected DB8 artifact is pending separate T2 acceptance. The fixed profile and full existing native owner tests are included once in the integrated local qualification. Only launcher fixtures have been executed locally; no claim of installed readiness.

The candidate also includes original pilot employee enrollment, device key custody and key lifecycle regression. The local launcher keeps those tests in the same grouped qualification; it does not send private source to Actions.

First-use preparation: the local Admin owner can export the original signed Registry before network admission. Build the private Admin owner with `-BuildCenter -PrepareT4Pilot` for this separate, ordinary T3 passport stage. The later installed network profile requires a real provider; original business Workspace must exist and local technical Workspace creation needs explicit preparation confirmation. No physical deployment or private CI run is implied by these pins.

Native self-hosted transport: the selected HTTPS endpoint derives the existing indexed topology. The private native owner binds endpoint, leaf certificate, peer certificates and transport credentials; CurrentUser DPAPI is required for persisted Windows settings. Qualification of the Core transport on Apache does not establish a working installed Windows product. Original baseline, phase and dependency evidence providers and full native activation remain unqualified.

### Original fresh Workspace baseline

The working candidate now pins the shared creation-event baseline. The first pilot uses the same empty original Workspace on both roles via the existing .iwxa Exchange, not two separately created Workspaces. The native Admin preparation command can derive the selection with `prepareFreshWorkspaceBaseline: true` and explicit confirmation. Component admission passed; actual installed K036 Exchange, Windows DPAPI and product startup remain unqualified. This is not a release authorization.

Current working candidate: the component-qualified native phase provider and the exact one/two shared original Workspace creation prefix. Both independent empty Workspace creations may be retained only after an original signed Exchange roundtrip has produced the identical ordered prefix on both roles. Existing grant sets are unchanged; object deletion still requires its independent dependency witness when granted. The new fourth original Kernel recipe is mandatory in the local exact candidate qualification; its execution, full private runtime and Windows remain NOT_RUN. No release promotion.
