# Installed original T3 corporate owner

The signed Windows owner executable is compiled from the **private** Faust-S/T3
source by the trusted release builder. It is NEVER checked into the public Center
repository or downloaded through public Center Actions. The executable contains
the original AccessRegistry, Reconciliation, receipt recovery and issuer custody.

Private packaging uses `src-tauri/tauri.private-d3.conf.json` as an additional
Tauri build configuration. Public builds omit this resource and return
`NOT_CONNECTED` to the corporate workbench. This is not a TEST owner fallback.

Build from the private T3 repo, then compile Center with:
`npx tauri build --config src-tauri/tauri.private-d3.conf.json`.
Do not promote a public build or a TEST-only license issuer to signed D3.
