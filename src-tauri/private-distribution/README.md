# Original private corporate T3 D3 owner

This public repository never contains private T3 source, keys or signed
product-owner executable. The ignored resource is compiled from Faust-S/T3
using original AccessRegistry, OfflinePackageReconciler and Windows DPAPI,
not a reference TEST owner.

The private T3 repository owns this Windows release recipe:

    pwsh scripts/build-admin-center-d3-owner.ps1 -CenterRoot CENTER_CHECKOUT -BuildCenter

The recipe builds the existing IWXA Setup Core installer with TWO executable
payload files: iwxa-admin-center.exe and t3/iwxa-t3-product-owner.exe.
Their checksums are verified using the existing Setup Core verifier.
The Tauri resource overlay is not an alternative end-user application.

Public Center Actions contain NO private binary and show NOT_CONNECTED.
The original corporate Kernel Apply remains unavailable until the native
signed D1 commitObjectGraph/getObject and original sealed application-host
binding are included in the real T3 product.
