# Original signed T3 and original age in the same Admin Center Setup Core

The public Center repository contains **no private T3 source, vault keys,
licensed business rights, or original owner executables**. The two original
Windows operators are built from private Faust-S/T3 source by the private
local release recipe, not by public Center Actions.

    pwsh scripts/build-admin-center-d3-owner.ps1 -CenterRoot CENTER_CHECKOUT -BuildCenter

That recipe builds ONE original IWXA Setup Core containing exactly seven
payload files, with the native Tauri binary in the installed root:

1. iwxa-admin-center.exe
2. t3/iwxa-t3-product-owner.exe (original private signed D3 owner)
3. t3/iwxa-t3-age-desktop.exe (original private age transport/DPAPI owner)
4. t3/age.exe (unmodified upstream age v1.3.2)
5. t3/age-keygen.exe (unmodified upstream age v1.3.2)
6. t3/age-LICENSE.txt (original BSD redistribution notice)
7. t3/age-toolchain.json (upstream executable SHA-256 pins)

The Windows release recipe checks the official upstream ZIP SHA-256 before
extracting tools. Center embeds both original owner executable SHA-256 pins
at compilation. Each age/age-keygen SHA-256 is checked through the already
existing native T3 age-toolchain verifier. Setup Core checks the entire
7-file payload and exact original product entrypoint; no other EXE or
installer is presented to the user.

Public Center Actions intentionally ship none of those private resources
and therefore corporate D3 reports NOT_CONNECTED. Signed first-use enrollment,
the independent Personal Agent Result and original D1 Kernel Apply are
**not accepted as installed product capabilities** without a real original
private Windows run and cold readback. Acceptance is not conferred by
a successful public Center CI.
