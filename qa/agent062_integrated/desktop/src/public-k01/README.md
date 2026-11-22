# Frozen K01 0.3.5 owner source for Personal Agent 0.5

Source: Faust-S/knowledge at commit `aacd5b2a118a446a274b181009daf0e7bf1345c5`.

The five .mjs files in this directory are **exact byte copies** of the public
K01 owner source, not an Agent-maintained fork or second Context Engine. Their
Git blob SHA-1 values are locked by `desktop/tests/k01-owner-pin.test.mjs`.
Update only after a new owner release, by byte-for-byte replacement and re-running
the owner parity test, K01 acceptance cases, and installed Windows qualification.

Required original hash implementation: `@noble/hashes@2.4.0`, exactly pinned
in `desktop/package.json` and `desktop/package-lock.json`.

The local bundle is compiled by the existing Vite Desktop build; end users need
no Internet access and no added process to run this K01 comparison.

K01 selection and refresh semantics remain owned by `Faust-S/knowledge`.
`desktop/src/k01-accepted-project.mjs` supplies only Core-scoped, human-approved
readbacks to those owner functions. A human-accepted Agent Result is **not** a
signed commercial supersession. Contradictions must stay unresolved.
