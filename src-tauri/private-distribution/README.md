# Original private T3, original Consumer and age in one Admin Center Setup Core

The public Center repository contains no private original T3 technology,
issuer keys or compiled private EXEs. Local Windows private release source
remains in Faust-S/T3. The ORIGINAL consumer receives TEST/PERSON signed
licensing with separately installed trust; the corporate owner receives
signed D3 Task/Result. These are different original T3 roles.

    pwsh scripts/build-admin-center-d3-owner.ps1 -CenterRoot CENTER_CHECKOUT -BuildCenter

The recipe builds ONE IWXA Setup Core with exactly EIGHT payload files:

1. iwxa-admin-center.exe (native Windows app)
2. t3/iwxa-t3-product-owner.exe (original signed issuer and D3 owner)
3. t3/iwxa-t3-product-consumer.exe (original TEST/installed recipient Consumer)
4. t3/iwxa-t3-age-desktop.exe (original age/X25519 transport owner)
5. t3/age.exe (upstream age v1.3.2)
6. t3/age-keygen.exe (upstream age v1.3.2)
7. t3/age-LICENSE.txt (original BSD redistributable license)
8. t3/age-toolchain.json (original age executable SHA-256 pins)

The private script checks the official upstream ZIP SHA-256 before extracting.
Center embeds SHA-256 pins for both the ORIGINAL consumer and signed D3
owner, plus the original age operator, at Windows compilation.
age.exe and age-keygen.exe are independently verified against the
pinned age-toolchain.json by the original T3 transport. Setup Core
verifies all eight bundled files. No separate installed application
or copied license Store is created.

Public Center CI contains none of these private executables and
therefore does not qualify the final private installed release.
First-use signed trust, independently received signed license,
revocation/replay check, true Personal Agent organizational Result
and original D1 Kernel Apply remain NOT_ACCEPTED until actual
private native Windows verification and cold readback.
