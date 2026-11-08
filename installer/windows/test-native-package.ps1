[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $root
try {
    $artifact = Join-Path $root 'artifacts'
    New-Item -ItemType Directory -Path $artifact -Force | Out-Null
    $stub = Join-Path $artifact 'iwxa-setup-core-stub.exe'
    $bundle = Join-Path $artifact 'iwxa-setup-core-center-0.3-preview.exe'
    $payload = Join-Path $artifact 'setup-core-test-payload'
    $report = Join-Path $artifact 'setup-core-native-inspection.json'
    $damaged = Join-Path $artifact 'setup-core-tampered.exe'
    $badReport = Join-Path $artifact 'setup-core-tampered-report.json'
    $exe = Join-Path $root 'src-tauri/target/release/iwxa-admin-center.exe'
    if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'SETUP_CENTER_EXE_MISSING' }

    & (Join-Path $PSScriptRoot 'build-stub.ps1') -Output $stub
    $profile = Join-Path $root 'installer/products/center.json'
    $product = Get-Content -LiteralPath $profile -Raw | ConvertFrom-Json
    if ($product.version -ne '0.3.0-dev.1') { throw 'SETUP_PRODUCT_VERSION_MISMATCH' }

    New-Item -ItemType Directory -Path $payload -Force | Out-Null
    Copy-Item -LiteralPath $exe -Destination (Join-Path $payload 'iwxa-admin-center.exe') -Force
    $sourceHead = [string]$env:GITHUB_SHA
    $sourceTree = [string](& git rev-parse 'HEAD^{tree}').Trim()
    if ($sourceHead -notmatch '^[0-9a-f]{40}$' -or $sourceTree -notmatch '^[0-9a-f]{40}$') {
        throw 'SETUP_SOURCE_IDENTITY_MISSING'
    }

    $arguments = @(
        '-m', 'installer.build_bundle', 'build-resource',
        '--product', $profile, '--payload', $payload, '--stub', $stub,
        '--output', $bundle, '--source-commit', $sourceHead, '--source-tree', $sourceTree
    )
    $details = & python @arguments
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_BUNDLE_BUILD_FAILED' }
    $manifest = $details | ConvertFrom-Json
    if ($manifest.status -ne 'VERIFIED' -or
        $manifest.product -ne 'iwxa.admin-center' -or
        $manifest.format -ne 'PE_RESOURCE_V2') {
        throw 'SETUP_BUNDLE_MANIFEST_INVALID'
    }

    function Invoke-NativeInspection([string]$binary, [string]$jsonPath, [int]$expected, [string]$mode = '--inspect-file') {
        $cmd = Start-Process -FilePath $binary -ArgumentList ('{0} "{1}"' -f $mode, $jsonPath) -PassThru
        try {
            if (!$cmd.WaitForExit(90000)) {
                Stop-Process -Id $cmd.Id -Force -ErrorAction SilentlyContinue
                throw 'SETUP_NATIVE_INSPECTION_TIMEOUT'
            }
            if ($cmd.ExitCode -ne $expected) {
                throw ('SETUP_NATIVE_INSPECTION_EXIT actual={0} expected={1}' -f $cmd.ExitCode, $expected)
            }
        } finally { $cmd.Dispose() }
        if (!(Test-Path -LiteralPath $jsonPath -PathType Leaf)) {
            throw 'SETUP_NATIVE_INSPECTION_REPORT_MISSING'
        }
        return Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
    }

    $native = Invoke-NativeInspection $bundle $report 0
    $disk = Invoke-NativeInspection $bundle (
        Join-Path $artifact 'setup-core-disk-plan.json') 0 '--disk-plan-file'
    if ($disk.status -ne 'DISK_SPACE_READY' -or
        $disk.product -ne 'iwxa.admin-center' -or
        $disk.packageBytes -ne (Get-Item -LiteralPath $bundle).Length -or
        $disk.requiredBytes -lt ($disk.packageBytes + $disk.payloadBytes) -or
        $disk.availableBytes -lt $disk.requiredBytes) {
        throw 'SETUP_DISK_PLAN_INVALID_OR_INSUFFICIENT_ON_CI'
    }
    Write-Host "IWXA_SETUP_NATIVE_DISK_CAPACITY_PLAN_PASS required=$($disk.requiredBytes) available=$($disk.availableBytes)"
    if ($native.status -ne 'VERIFIED' -or $native.product -ne $manifest.product -or
        $native.entrypoint -ne $product.entrypoint -or
        !$native.requiresWebView2 -or
        $native.version -ne '0.3.0-dev.1' -or $native.sourceCommit -ne $sourceHead -or
        $native.packageSha256 -ne $manifest.payload_sha256 -or
        $native.packageFormat -ne 'PE_RESOURCE_V2' -or
        $native.files -ne $manifest.file_count) {
        throw 'SETUP_NATIVE_PYTHON_DISAGREEMENT'
    }
    Write-Host "IWXA_SETUP_NATIVE_PACKAGE_PASS files=$($native.files) version=$($native.version)"

    # The actual Center 0.3 installation candidate above is now V2.
    # Retain an explicitly named V1 overlay as an independent
    # backward-compatibility / tampering test only.
    $overlayFile = Join-Path $artifact 'setup-core-legacy-overlay-v1-compat.exe'
    $overlayArgs = @('-m', 'installer.build_bundle', 'build',
        '--product', $profile, '--payload', $payload, '--stub', $stub,
        '--output', $overlayFile, '--source-commit', $sourceHead,
        '--source-tree', $sourceTree)
    $overlayBuild = & python @overlayArgs
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_OVERLAY_V1_COMPAT_BUILD_FAILED' }
    $overlayManifest = ($overlayBuild | Out-String) | ConvertFrom-Json
    $overlayNative = Invoke-NativeInspection $overlayFile (
        Join-Path $artifact 'setup-core-overlay-v1-compat-inspect.json') 0
    if ($overlayNative.packageFormat -ne 'ZIP_OVERLAY_V1' -or
        $overlayNative.status -ne 'VERIFIED' -or
        $overlayNative.packageSha256 -ne $native.packageSha256 -or
        $overlayManifest.payload_sha256 -ne $manifest.payload_sha256) {
        throw 'SETUP_OVERLAY_V1_BACKWARD_COMPAT_INVALID'
    }
    Write-Host 'IWXA_SETUP_OVERLAY_V1_READ_COMPAT_PASS'

    # Separate V2 packaging is retained for authenticated extraction and
    # test-certificate signing evidence; it is not the primary distribution.
    # The primary distribution itself is now a PE-resource V2 EXE.
    $resourceFile=Join-Path $artifact 'iwxa-setup-core-resource-v2.exe'
    $resourceArgs=@('-m','installer.build_bundle','build-resource',
        '--product',$profile,'--payload',$payload,'--stub',$stub,
        '--output',$resourceFile,'--source-commit',$sourceHead,'--source-tree',$sourceTree)
    $resourceBuild=& python @resourceArgs
    if($LASTEXITCODE -ne 0){throw 'SETUP_RESOURCE_V2_BUILD_FAILED'}
    $resourceManifest=($resourceBuild|Out-String)|ConvertFrom-Json
    if($resourceManifest.status -ne 'VERIFIED' -or
       $resourceManifest.format -ne 'PE_RESOURCE_V2'){
      throw 'SETUP_RESOURCE_V2_BUILD_RECEIPT_INVALID'
    }
    $resourceNative=Invoke-NativeInspection $resourceFile (
        Join-Path $artifact 'setup-resource-v2-inspect.json') 0
    if($resourceNative.status -ne 'VERIFIED' -or
       $resourceNative.sourceCommit -ne $sourceHead -or
       $resourceNative.packageSha256 -ne $manifest.payload_sha256 -or
       $resourceNative.packageFormat -ne 'PE_RESOURCE_V2'){
      throw 'SETUP_RESOURCE_V2_NATIVE_INSPECTION_INVALID'
    }
    $resourceStage=Invoke-NativeInspection $resourceFile (
        Join-Path $artifact 'setup-resource-v2-stage.json') 0 '--stage-test-file'
    if($resourceStage.status -ne 'STAGED_VERIFIED' -or
       $resourceStage.files -ne $native.files -or
       $resourceStage.packageSha256 -ne $native.packageSha256){
      throw 'SETUP_RESOURCE_V2_NATIVE_STAGING_INVALID'
    }
    Write-Host 'IWXA_SETUP_RESOURCE_V2_PACK_INSPECT_STAGE_PASS'
    # A developer self-signed code-signing key must never pass the production
    # signing gate, even if the PE-resource V2 payload itself is valid.
    $probeCert = New-SelfSignedCertificate -Type CodeSigningCert -HashAlgorithm SHA256 -Subject 'CN=IWXA Test Not Trusted' -CertStoreLocation 'Cert:\CurrentUser\My'
    try {
        $refusedOutput = Join-Path $artifact 'setup-core-v2-selfsigned-release-rejected.exe'
        if (Test-Path -LiteralPath $refusedOutput) {
            throw 'SETUP_RELEASE_TEST_OUTPUT_ALREADY_EXISTS'
        }
        $rejected = $false
        try {
            & (Join-Path $PSScriptRoot 'sign-release-v2.ps1') -UnsignedSetupExe $resourceFile -SignedSetupExe $refusedOutput -CertificateThumbprint $probeCert.Thumbprint -ExpectedCertificateSubject $probeCert.Subject -ExpectedUnsignedSha256 (Get-FileHash -LiteralPath $resourceFile -Algorithm SHA256).Hash -ExpectedSourceCommit $sourceHead
        } catch {
            if ($_.Exception.Message -notlike '*SETUP_RELEASE_SELF_SIGNED_CERTIFICATE_FORBIDDEN*') {
                throw
            }
            $rejected = $true
        }
        if (!$rejected -or (Test-Path -LiteralPath $refusedOutput)) {
            throw 'SETUP_RELEASE_SELF_SIGNED_CERTIFICATE_ACCEPTED'
        }
        Write-Host 'IWXA_SETUP_RELEASE_SELF_SIGNED_CERTIFICATE_REFUSED_PASS'
    } finally {
        Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $probeCert.Thumbprint) -Force -ErrorAction SilentlyContinue
    }

    # Exercise the common installer verification with an unsigned Setup EXE,
    # independently of whether the hosted Windows image has WebView2.
    $badComponentReport = Join-Path $artifact 'setup-core-webview2-unsigned.json'
    $badComponent = Start-Process -FilePath $stub -ArgumentList (
        '--verify-webview2-installer-file "{0}" "{1}"' -f $stub, $badComponentReport
    ) -PassThru
    try {
        if (!$badComponent.WaitForExit(45000)) {
            Stop-Process -Id $badComponent.Id -Force -ErrorAction SilentlyContinue
            throw 'SETUP_WEBVIEW2_UNSIGNED_CHECK_TIMEOUT'
        }
        if ($badComponent.ExitCode -ne 2) {
            throw 'SETUP_WEBVIEW2_UNSIGNED_EXE_ACCEPTED'
        }
    } finally { $badComponent.Dispose() }
    $badComponentResult = Get-Content -LiteralPath $badComponentReport -Raw |
        ConvertFrom-Json
    if ($badComponentResult.status -ne 'ERROR' -or
        $badComponentResult.reason -notlike '*SETUP_WEBVIEW2_AUTHENTICODE_INVALID*') {
        throw 'SETUP_WEBVIEW2_UNSIGNED_REJECTION_INVALID'
    }
    Write-Host 'IWXA_SETUP_WEBVIEW2_UNSIGNED_EXE_REJECTED_PASS'


    $preflightReport = Join-Path $artifact 'setup-core-preflight.json'
    $stagingReport = Join-Path $artifact 'setup-core-staged-readback.json'
    $preflight = Invoke-NativeInspection $bundle $preflightReport 0 '--preflight-file'
    if ($preflight.product -ne 'iwxa.admin-center' -or
        $preflight.status -notin @(
            'READY_FOR_FIRST_INSTALL', 'WEBVIEW2_MISSING',
            'EXISTING_INSTALLATION', 'LEGACY_INSTALLATION',
            'ARCHITECTURE_UNSUPPORTED'
        )) { throw 'SETUP_NATIVE_PREFLIGHT_INVALID' }
    Write-Host "IWXA_SETUP_NATIVE_PREFLIGHT_PASS status=$($preflight.status)"
    # When WebView2 is already installed, ensuring the dependency must be
    # idempotent and must not download or launch an installer.
    if ($preflight.webview2Version) {
        # The clean-Windows qualification must refuse an ordinary hosted
        # runner that already has Runtime; never falsely award first-install PASS.
        $negativeRoot = Join-Path $artifact 'setup-core-webview2-not-clean'
        $witness = Join-Path $PSScriptRoot 'qualify-webview2-clean-windows.ps1'
        $shell = (Get-Process -Id $PID).Path
        $negativeArgs = ('-NoProfile -NonInteractive -File "{0}" -SetupExe "{1}" -Mode Online -ExpectedGuiAccessibleName "{2}" -ReportDirectory "{3}"' -f
            $witness, $bundle, 'Организация', $negativeRoot)
        $negative = Start-Process -FilePath $shell -ArgumentList $negativeArgs -PassThru
        try {
            if (!$negative.WaitForExit(60000)) {
                Stop-Process -Id $negative.Id -Force -ErrorAction SilentlyContinue
                throw 'SETUP_WEBVIEW2_CLEAN_HOST_NEGATIVE_TIMEOUT'
            }
            if ($negative.ExitCode -eq 0) {
                throw 'SETUP_WEBVIEW2_PRESENT_HOST_FALSE_PASS'
            }
        } finally { $negative.Dispose() }
        $negativeReceipt = Join-Path $negativeRoot 'qualification.json'
        if (!(Test-Path -LiteralPath $negativeReceipt -PathType Leaf)) {
            throw 'SETUP_WEBVIEW2_NEGATIVE_RECEIPT_MISSING'
        }
        $negativeEvidence = Get-Content -LiteralPath $negativeReceipt -Raw | ConvertFrom-Json
        if ($negativeEvidence.status -ne 'NOT_QUALIFIED' -or
            $negativeEvidence.reason -ne 'WEBVIEW2_CLEAN_VM_REQUIRED_RUNTIME_ALREADY_PRESENT_OR_UNEXPECTED_STATE' -or
            $negativeEvidence.runtimeAbsentBefore -or
            $negativeEvidence.installedBySetup -or
            $negativeEvidence.installedProductGuiOpened) {
            throw 'SETUP_WEBVIEW2_EXISTING_RUNTIME_FALSE_CLEAN_EVIDENCE'
        }
        Write-Host 'IWXA_WEBVIEW2_EXISTING_RUNTIME_CLEAN_VM_REFUSED_PASS'
        $componentFile = Join-Path $artifact 'setup-core-webview2-available.json'
        $component = Invoke-NativeInspection $bundle $componentFile 0 '--ensure-webview2-file'
        if ($component.status -ne 'WEBVIEW2_ALREADY_INSTALLED' -or
            !$component.webview2Version) {
            throw 'SETUP_WEBVIEW2_ALREADY_PRESENT_NOT_IDEMPOTENT'
        }
        Write-Host 'IWXA_SETUP_WEBVIEW2_PRESENT_NO_BOOTSTRAP_PASS'
        # Exercising the production offline CLI on a runner with WebView2.
        # The idempotent branch must not touch or inspect a nonexistent file.
        $offlineReport = Join-Path $artifact 'setup-core-webview2-offline-present.json'
        $missingFile = Join-Path $artifact 'never-exists-webview2-standalone.exe'
        if (Test-Path -LiteralPath $missingFile) {
            throw 'SETUP_WEBVIEW2_OFFLINE_PROBE_FILE_UNEXPECTED'
        }
        $offlineProcess = Start-Process -FilePath $bundle -ArgumentList (
            '--ensure-webview2-offline-file "{0}" "{1}"' -f $missingFile, $offlineReport
        ) -PassThru
        try {
            if (!$offlineProcess.WaitForExit(45000)) {
                Stop-Process -Id $offlineProcess.Id -Force -ErrorAction SilentlyContinue
                throw 'SETUP_WEBVIEW2_OFFLINE_PRESENT_PROBE_TIMEOUT'
            }
            if ($offlineProcess.ExitCode -ne 0) {
                throw 'SETUP_WEBVIEW2_OFFLINE_PRESENT_PROBE_EXIT'
            }
        } finally { $offlineProcess.Dispose() }
        $offlineState = Get-Content -LiteralPath $offlineReport -Raw | ConvertFrom-Json
        if ($offlineState.status -ne 'WEBVIEW2_ALREADY_INSTALLED' -or
            !$offlineState.webview2Version) {
            throw 'SETUP_WEBVIEW2_OFFLINE_PRESENT_NOT_IDEMPOTENT'
        }
        Write-Host 'IWXA_SETUP_WEBVIEW2_OFFLINE_ALREADY_PRESENT_PASS'
    }
    $upgradePlanFile = Join-Path $artifact 'setup-core-upgrade-plan.json'
    $freshPlan = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
    if ($freshPlan.status -ne 'NO_OWNED_INSTALLATION' -or
        $freshPlan.product -ne $manifest.product) {
        throw 'SETUP_S3_FRESH_PLAN_INVALID'
    }
    Write-Host 'IWXA_SETUP_S3_FRESH_PLAN_PASS'
    $stage = Invoke-NativeInspection $bundle $stagingReport 0 '--stage-test-file'
    if ($stage.status -ne 'STAGED_VERIFIED' -or
        $stage.product -ne $manifest.product -or
        $stage.files -ne $manifest.file_count -or
        $stage.packageSha256 -ne $manifest.payload_sha256 -or
        $stage.bytes -le 0) {
        throw 'SETUP_NATIVE_STAGE_READBACK_INVALID'
    }
    Write-Host "IWXA_SETUP_NATIVE_STAGING_PASS files=$($stage.files) bytes=$($stage.bytes)"

    if ($preflight.status -ne 'READY_FOR_FIRST_INSTALL') {
        throw "SETUP_NATIVE_FRESH_INSTALL_BLOCKED_$($preflight.status)"
    }
    # Build a second package with the same payload and a newer profile.
    $upgradeProfile = Join-Path $artifact 'setup-core-upgrade-product.json'
    $upgradeCandidate = Join-Path $artifact 'setup-core-center-upgrade.exe'
    $upgradeProduct = Get-Content -LiteralPath $profile -Raw | ConvertFrom-Json
    $upgradeProduct.version = '0.3.0-dev.2'
    $upgradeProduct | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $upgradeProfile -Encoding UTF8
    $nextArgs = @('-m', 'installer.build_bundle', 'build-resource', '--product', $upgradeProfile,
        '--payload', $payload, '--stub', $stub, '--output', $upgradeCandidate,
        '--source-commit', $sourceHead, '--source-tree', $sourceTree)
    $null = & python @nextArgs
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_S3_NEW_VERSION_BUILD_FAILED' }
    $nextIdentity = Invoke-NativeInspection $upgradeCandidate (Join-Path $artifact 'setup-core-next-identity.json') 0
    if ($nextIdentity.version -ne '0.3.0-dev.2' -or
        $nextIdentity.packageFormat -ne 'PE_RESOURCE_V2') {
        throw 'SETUP_S3_NEW_VERSION_INVALID'
    }
    $installedReport = Join-Path $artifact 'setup-core-installed.json'
    $duplicateReport = Join-Path $artifact 'setup-core-duplicate.json'
    $removedReport = Join-Path $artifact 'setup-core-uninstalled.json'
    $userData = Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/setup-core-preserved.txt'
    New-Item -ItemType Directory -Path (Split-Path -Parent $userData) -Force | Out-Null
    Set-Content -LiteralPath $userData -Value 'unchanged-after-first-install' -NoNewline
    try {
        $installed = Invoke-NativeInspection $bundle $installedReport 0 '--install-file'
        if ($installed.status -ne 'INSTALLED_NOT_LAUNCHED' -or
            $installed.product -ne $manifest.product -or
            $installed.version -ne '0.3.0-dev.1' -or
            !(Test-Path -LiteralPath (Join-Path $installed.installRoot 'iwxa-admin-center.exe'))) {
            throw 'SETUP_NATIVE_FIRST_INSTALL_INVALID'
        }
        $registered = Get-ItemProperty -Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center'
        if ($registered.InstallLocation -ne $installed.installRoot) {
            throw 'SETUP_NATIVE_INSTALL_AUTHORITY_MISMATCH'
        }
        $startMenuLink = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\IWXA Admin Center.lnk'
        if (!(Test-Path -LiteralPath $startMenuLink -PathType Leaf)) {
            throw 'SETUP_NATIVE_START_MENU_SHORTCUT_MISSING'
        }
        Write-Host "IWXA_SETUP_NATIVE_FIRST_INSTALL_PASS root=$($installed.installRoot)"
        # The actual product's registered uninstall executable must be an
        # identical self-contained PE-resource V2 package, not a V1 overlay.
        $installedUninstaller = Join-Path $installed.installRoot 'IWXA.SetupCore.Uninstall.exe'
        if (!(Test-Path -LiteralPath $installedUninstaller -PathType Leaf) -or
            (Get-FileHash -LiteralPath $installedUninstaller -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash) {
            throw 'SETUP_PRIMARY_V2_UNINSTALLER_NOT_EXACT_COPY'
        }
        $uninstallIdentity = Invoke-NativeInspection $installedUninstaller (
            Join-Path $artifact 'setup-core-owned-uninstaller-identity.json') 0 '--inspect-file'
        if ($uninstallIdentity.status -ne 'VERIFIED' -or
            $uninstallIdentity.packageFormat -ne 'PE_RESOURCE_V2' -or
            $uninstallIdentity.sourceCommit -ne $sourceHead -or
            $uninstallIdentity.packageSha256 -ne $native.packageSha256) {
            throw 'SETUP_PRIMARY_V2_UNINSTALLER_IDENTITY_MISMATCH'
        }
        Write-Host 'IWXA_SETUP_PRIMARY_V2_INSTALLED_UNINSTALLER_IDENTITY_PASS'
        $ownedPlan = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
        if ($ownedPlan.status -ne 'REPAIR_CANDIDATE_NOT_ACTIVATED' -or
            $ownedPlan.installedVersion -ne '0.3.0-dev.1' -or
            $ownedPlan.installRoot -ne $installed.installRoot) {
            throw 'SETUP_S3_OWNED_PLAN_INVALID'
        }
        $ownerKey = 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center'
        $originalHash = [string]$registered.PackageSha256
        Set-ItemProperty -Path $ownerKey -Name PackageSha256 -Value ('0' * 64)
        try {
            $refusedPlan = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
            if ($refusedPlan.status -ne 'OWNERSHIP_MISMATCH') {
                throw 'SETUP_S3_MISMATCHED_OWNER_ACCEPTED'
            }
        } finally {
            Set-ItemProperty -Path $ownerKey -Name PackageSha256 -Value $originalHash
        }
        Write-Host 'IWXA_SETUP_S3_OWNERSHIP_PLAN_PASS'
        $noLegacy = Invoke-NativeInspection $bundle (Join-Path $artifact 'setup-core-no-legacy.json') 0 '--legacy-inspect-file'
        if ($noLegacy.status -ne 'LEGACY_NOT_PRESENT') {
            throw 'SETUP_S3_NEW_SETUP_MISTAKEN_FOR_LEGACY'
        }

        $refused = Invoke-NativeInspection $bundle $duplicateReport 2 '--install-file'
        if ($refused.status -ne 'ERROR' -or
            $refused.reason -notlike 'SETUP_BLOCKED_EXISTING_INSTALLATION*') {
            throw 'SETUP_NATIVE_DUPLICATE_INSTALL_ACCEPTED'
        }
        Write-Host 'IWXA_SETUP_NATIVE_DUPLICATE_INSTALL_REJECTED_PASS'

        # Repair real deliberately corrupted bytes of the existing application;
        # stage the exact original package and preserve user files.
        $installedExe = Join-Path $installed.installRoot 'iwxa-admin-center.exe'
        $cleanHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
        $handle = [IO.File]::Open($installedExe, [IO.FileMode]::Open,
            [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try {
            [void]$handle.Seek(4096, [IO.SeekOrigin]::Begin)
            $byte = $handle.ReadByte()
            if ($byte -lt 0) { throw 'SETUP_REPAIR_FIXTURE_TOO_SMALL' }
            [void]$handle.Seek(4096, [IO.SeekOrigin]::Begin)
            $handle.WriteByte([byte]($byte -bxor 1))
        } finally { $handle.Dispose() }
        if ((Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash -eq $cleanHash) {
            throw 'SETUP_REPAIR_FIXTURE_NOT_MODIFIED'
        }
        $repaired = Invoke-NativeInspection $bundle (
            Join-Path $artifact 'setup-core-repaired.json') 0 '--repair-file'
        if ($repaired.status -ne 'REPAIRED_BACKUP_RETAINED' -or
            $repaired.version -ne '0.3.0-dev.1' -or
            (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash -ne $cleanHash) {
            throw 'SETUP_NATIVE_REPAIR_DID_NOT_RESTORE_BINARY'
        }
        if (!(Test-Path -LiteralPath ($installed.installRoot + '.iwxa-previous'))) {
            throw 'SETUP_NATIVE_REPAIR_PREVIOUS_RELEASE_NOT_RETAINED'
        }
        $repairPending = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
        if ($repairPending.status -ne 'UPGRADE_PENDING_CONFIRMATION') {
            throw 'SETUP_NATIVE_REPAIR_CONFIRM_GATE_MISSING'
        }
        $repairConfirm = Invoke-NativeInspection $bundle (
            Join-Path $artifact 'setup-core-repair-confirmed.json') 0 '--confirm-upgrade-file'
        if ($repairConfirm.status -ne 'UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED' -or
            (Test-Path -LiteralPath ($installed.installRoot + '.iwxa-previous'))) {
            throw 'SETUP_NATIVE_REPAIR_CONFIRM_FAILED'
        }
        if ((Get-Content -LiteralPath $userData -Raw) -ne 'unchanged-after-first-install') {
            throw 'SETUP_NATIVE_REPAIR_USER_DATA_CHANGED'
        }
        Write-Host 'IWXA_SETUP_NATIVE_SAME_VERSION_REPAIR_PASS'

        # Emulate a crash immediately after moving the old release aside.
        $previousRoot = $installed.installRoot + '.iwxa-previous'
        [IO.Directory]::Move($installed.installRoot, $previousRoot)
        $missingPlan = Invoke-NativeInspection $upgradeCandidate $upgradePlanFile 0 '--upgrade-plan-file'
        if ($missingPlan.status -ne 'UPGRADE_RECOVERY_REQUIRED') {
            throw 'SETUP_S3_MISSING_ROOT_NOT_DETECTED'
        }
        $recovered = Invoke-NativeInspection $upgradeCandidate (Join-Path $artifact 'setup-core-recovered-missing.json') 0 '--recover-upgrade-file'
        if ($recovered.status -ne 'RECOVERED_PREVIOUS_RELEASE' -or
            $recovered.version -ne '0.3.0-dev.1' -or
            !(Test-Path -LiteralPath (Join-Path $installed.installRoot 'iwxa-admin-center.exe')) -or
            (Test-Path -LiteralPath $previousRoot)) {
            throw 'SETUP_S3_MISSING_ROOT_RECOVERY_FAILED'
        }
        Write-Host 'IWXA_SETUP_S3_RECOVER_AFTER_OLD_MOVE_PASS'

        $planNext = Invoke-NativeInspection $upgradeCandidate $upgradePlanFile 0 '--upgrade-plan-file'
        if ($planNext.status -ne 'UPGRADE_CANDIDATE_NOT_ACTIVATED') {
            throw 'SETUP_S3_UPGRADE_PLAN_INVALID'
        }
        $changed = Invoke-NativeInspection $upgradeCandidate (Join-Path $artifact 'setup-core-upgrade-applied.json') 0 '--upgrade-file'
        if ($changed.status -ne 'UPGRADED_BACKUP_RETAINED' -or
            $changed.version -ne '0.3.0-dev.2') {
            throw 'SETUP_S3_UPGRADE_NOT_APPLIED'
        }
        if (!(Test-Path -LiteralPath ($installed.installRoot + '.iwxa-previous'))) {
            throw 'SETUP_S3_PREVIOUS_RELEASE_NOT_RETAINED'
        }
        $pending = Invoke-NativeInspection $upgradeCandidate $upgradePlanFile 0 '--upgrade-plan-file'
        if ($pending.status -ne 'UPGRADE_PENDING_CONFIRMATION') {
            throw 'SETUP_S3_CONFIRMATION_GATE_MISSING'
        }
        $stillPending = Invoke-NativeInspection $upgradeCandidate (Join-Path $artifact 'setup-core-recovery-pending.json') 0 '--recover-upgrade-file'
        if ($stillPending.status -ne 'UPGRADE_PENDING_CONFIRMATION') {
            throw 'SETUP_S3_COMPLETED_SWITCH_ROLLED_BACK'
        }

        # Model a terminated process between activation and HKCU commit.
        Set-ItemProperty -Path $ownerKey -Name PackageSha256 -Value $originalHash
        Set-ItemProperty -Path $ownerKey -Name Version -Value '0.3.0-dev.1'
        $interrupted = Invoke-NativeInspection $upgradeCandidate $upgradePlanFile 0 '--upgrade-plan-file'
        if ($interrupted.status -ne 'UPGRADE_RECOVERY_REQUIRED') {
            throw 'SETUP_S3_PRE_REGISTRATION_CRASH_NOT_DETECTED'
        }
        $recoveredRegistration = Invoke-NativeInspection $upgradeCandidate (Join-Path $artifact 'setup-core-recovered-registration.json') 0 '--recover-upgrade-file'
        if ($recoveredRegistration.status -ne 'RECOVERED_PREVIOUS_RELEASE' -or
            $recoveredRegistration.version -ne '0.3.0-dev.1' -or
            (Test-Path -LiteralPath $previousRoot)) {
            throw 'SETUP_S3_PRE_REGISTRATION_RECOVERY_FAILED'
        }
        Write-Host 'IWXA_SETUP_S3_RECOVER_AFTER_NEW_MOVE_PASS'
        $reapplied = Invoke-NativeInspection $upgradeCandidate (Join-Path $artifact 'setup-core-upgrade-reapplied.json') 0 '--upgrade-file'
        if ($reapplied.status -ne 'UPGRADED_BACKUP_RETAINED') {
            throw 'SETUP_S3_REAPPLY_AFTER_RECOVERY_FAILED'
        }
        $rolled = Invoke-NativeInspection $upgradeCandidate (Join-Path $artifact 'setup-core-rollback.json') 0 '--rollback-upgrade-file'
        if ($rolled.status -ne 'ROLLBACK_RESTORED_PREVIOUS' -or
            $rolled.version -ne '0.3.0-dev.1') {
            throw 'SETUP_S3_ROLLBACK_FAILED'
        }
        $restored = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
        if ($restored.status -ne 'REPAIR_CANDIDATE_NOT_ACTIVATED') {
            throw 'SETUP_S3_ROLLBACK_READBACK_INVALID'
        }
        if ((Get-Content -LiteralPath $userData -Raw) -ne 'unchanged-after-first-install') {
            throw 'SETUP_S3_ROLLBACK_USER_DATA_CHANGED'
        }
        Write-Host 'IWXA_SETUP_S3_NATIVE_UPGRADE_ROLLBACK_PASS'
    }
    finally {
        if (Test-Path -LiteralPath $installedReport -PathType Leaf) {
            # A late read-only uninstaller used to leave a half-removed app:
            # the entrypoint could be deleted before the uninstaller refused
            # deletion. Fail the whole removal before modifying ANY owned file.
            $installedUninstaller = Join-Path $installed.installRoot 'IWXA.SetupCore.Uninstall.exe'
            $liveApp = Join-Path $installed.installRoot 'iwxa-admin-center.exe'
            $liveReceipt = Join-Path $installed.installRoot '.iwxa-setup-ownership.json'
            $appBefore = (Get-FileHash -LiteralPath $liveApp -Algorithm SHA256).Hash
            $uninstallBefore = (Get-FileHash -LiteralPath $installedUninstaller -Algorithm SHA256).Hash
            $beforeAttr = [IO.File]::GetAttributes($installedUninstaller)
            try {
                [IO.File]::SetAttributes($installedUninstaller,
                    ($beforeAttr -bor [IO.FileAttributes]::ReadOnly))
                $denied = Invoke-NativeInspection $bundle (
                    Join-Path $artifact 'setup-core-readonly-uninstall-denied.json') 2 '--uninstall-file'
                if ($denied.status -ne 'ERROR' -or
                    $denied.reason -ne 'SETUP_UNINSTALL_READONLY_FILE' -or
                    !(Test-Path -LiteralPath $liveApp -PathType Leaf) -or
                    !(Test-Path -LiteralPath $liveReceipt -PathType Leaf) -or
                    (Get-FileHash -LiteralPath $liveApp -Algorithm SHA256).Hash -ne $appBefore -or
                    (Get-FileHash -LiteralPath $installedUninstaller -Algorithm SHA256).Hash -ne $uninstallBefore -or
                    !(Test-Path -LiteralPath $ownerKey)) {
                    throw 'SETUP_UNINSTALL_READONLY_CHANGED_INSTALLED_STATE'
                }
            } finally {
                if (Test-Path -LiteralPath $installedUninstaller -PathType Leaf) {
                    [IO.File]::SetAttributes($installedUninstaller, $beforeAttr)
                }
            }
            Write-Host 'IWXA_SETUP_UNINSTALL_PRECHECK_READONLY_NO_PARTIAL_REMOVAL_PASS'
            $removed = Invoke-NativeInspection $bundle $removedReport 0 '--uninstall-file'
            if ($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED') {
                throw 'SETUP_NATIVE_UNINSTALL_INVALID'
            }
            if (Test-Path -LiteralPath $installed.installRoot) {
                throw 'SETUP_NATIVE_UNINSTALL_ROOT_REMAINS'
            }
        }
        if ((Get-Content -LiteralPath $userData -Raw) -ne 'unchanged-after-first-install') {
            throw 'SETUP_NATIVE_USER_DATA_CHANGED'
        }
        Remove-Item -LiteralPath $userData -Force
    }
    if (Test-Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center') {
        throw 'SETUP_NATIVE_UNINSTALL_AUTHORITY_REMAINS'
    }
    if (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\IWXA.SetupCore.iwxa.admin-center') {
        throw 'SETUP_NATIVE_UNINSTALL_APP_REGISTRY_REMAINS'
    }
    Write-Host 'IWXA_SETUP_NATIVE_UNINSTALL_PRESERVES_DATA_PASS'

    # An existing Tauri/NSIS installation is an explicit migration blocker.
    # Never install the new package alongside a legacy Center directory.
    $legacy = Join-Path $env:LOCALAPPDATA 'IWXA Admin Center'
    if (Test-Path -LiteralPath $legacy) {
        throw 'SETUP_NATIVE_LEGACY_FIXTURE_CONFLICT'
    }
    New-Item -ItemType Directory -Path $legacy -Force | Out-Null
    try {
        $legacyReport = Join-Path $artifact 'setup-core-legacy-preflight.json'
        $legacyResult = Invoke-NativeInspection $bundle $legacyReport 0 '--preflight-file'
        if ($legacyResult.status -ne 'LEGACY_INSTALLATION') {
            throw 'SETUP_NATIVE_LEGACY_OVERWRITE_NOT_BLOCKED'
        }
        Write-Host 'IWXA_SETUP_NATIVE_LEGACY_INSTALLATION_HOLD_PASS'
        $legacyPlan = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
        if ($legacyPlan.status -ne 'LEGACY_MIGRATION_HOLD') {
            throw 'SETUP_S3_LEGACY_MIGRATION_NOT_BLOCKED'
        }
        Write-Host 'IWXA_SETUP_S3_LEGACY_PLAN_PASS'

        $legacyProbe = Join-Path $artifact 'setup-core-legacy-inspection.json'
        $unregistered = Invoke-NativeInspection $bundle $legacyProbe 0 '--legacy-inspect-file'
        if ($unregistered.status -ne 'LEGACY_DIRECTORY_UNREGISTERED_HOLD') {
            throw 'SETUP_S3_LEGACY_UNREGISTERED_NOT_BLOCKED'
        }

        # Use only an isolated synthetic HKCU entry, never a real NSIS
        # uninstaller. The original 0.2 is tested separately.
        $legacyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\IWXA.Setup.Legacy.Fixture'
        if (Test-Path -LiteralPath $legacyKey) { throw 'SETUP_LEGACY_FIXTURE_KEY_ALREADY_PRESENT' }
        $oldExe = Join-Path $legacy 'iwxa-admin-center.exe'
        $oldUninstaller = Join-Path $legacy 'uninstall.exe'
        [IO.File]::WriteAllText($oldExe, 'IWXA_FIXTURE_APPLICATION')
        [IO.File]::WriteAllText($oldUninstaller, 'IWXA_FIXTURE_UNINSTALLER_NOT_EXECUTABLE')
        New-Item -Path $legacyKey -Force | Out-Null
        try {
            New-ItemProperty -LiteralPath $legacyKey -Name DisplayName -Value 'IWXA Admin Center' -PropertyType String | Out-Null
            New-ItemProperty -LiteralPath $legacyKey -Name DisplayVersion -Value '0.2.0' -PropertyType String | Out-Null
            New-ItemProperty -LiteralPath $legacyKey -Name InstallLocation -Value ('"{0}"' -f $legacy) -PropertyType String | Out-Null
            New-ItemProperty -LiteralPath $legacyKey -Name UninstallString -Value ('"{0}"' -f $oldUninstaller) -PropertyType String | Out-Null
            New-ItemProperty -LiteralPath $legacyKey -Name Publisher -Value 'IWXA' -PropertyType String | Out-Null
            $matched = Invoke-NativeInspection $bundle $legacyProbe 0 '--legacy-inspect-file'
            if ($matched.status -ne 'LEGACY_CONFIRMED_READ_ONLY' -or
                $matched.installedVersion -ne '0.2.0' -or
                $matched.installRoot -ne $legacy -or
                !(Test-Path -LiteralPath $oldUninstaller)) {
                throw 'SETUP_S3_LEGACY_OWNERSHIP_PROBE_FAILED'
            }

            $oldApplicationHash = (Get-FileHash -LiteralPath $oldExe -Algorithm SHA256).Hash
            $oldUninstallerHash = (Get-FileHash -LiteralPath $oldUninstaller -Algorithm SHA256).Hash
            $oldRegistry = (Get-ItemProperty -LiteralPath $legacyKey).DisplayVersion
            $stagedLegacy = Invoke-NativeInspection $bundle (Join-Path $artifact 'setup-core-legacy-staged.json') 0 '--stage-legacy-file'
            if ($stagedLegacy.status -ne 'LEGACY_MIGRATION_STAGED_NSIS_PRESERVED' -or
                $stagedLegacy.version -ne '0.3.0-dev.1' -or
                !(Test-Path -LiteralPath (Join-Path $stagedLegacy.installRoot 'iwxa-admin-center.exe'))) {
                throw 'SETUP_S3_LEGACY_PREVIEW_NOT_STAGED'
            }
            $pendingLegacy = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
            if ($pendingLegacy.status -ne 'LEGACY_MIGRATION_PENDING_GUI_READBACK') {
                throw 'SETUP_S3_LEGACY_PREVIEW_STATUS_INVALID'
            }
            if ((Get-ItemProperty -LiteralPath $legacyKey).DisplayVersion -ne $oldRegistry -or
                (Get-FileHash -LiteralPath $oldExe -Algorithm SHA256).Hash -ne $oldApplicationHash -or
                (Get-FileHash -LiteralPath $oldUninstaller -Algorithm SHA256).Hash -ne $oldUninstallerHash) {
                throw 'SETUP_S3_LEGACY_0_2_MODIFIED_DURING_PREVIEW'
            }
            # NSIS original binary changes must invalidate the staged handoff.
            # Each fixture byte is restored before the cancellation test.
            foreach ($target in @($oldExe, $oldUninstaller)) {
                $original = [IO.File]::ReadAllBytes($target)
                try {
                    [IO.File]::WriteAllText($target, 'CHANGED_AFTER_PREVIEW')
                    $review = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
                    if ($review.status -ne 'LEGACY_MIGRATION_REVIEW_REQUIRED') {
                        throw ('SETUP_LEGACY_MODIFIED_BINARY_STILL_ACCEPTED_' + (Split-Path -Leaf $target))
                    }
                } finally {
                    [IO.File]::WriteAllBytes($target, $original)
                }
                $restoredPlan = Invoke-NativeInspection $bundle $upgradePlanFile 0 '--upgrade-plan-file'
                if ($restoredPlan.status -ne 'LEGACY_MIGRATION_PENDING_GUI_READBACK') {
                    throw 'SETUP_LEGACY_BINARY_RECOVERY_NOT_RECOGNIZED'
                }
            }
            Write-Host 'IWXA_SETUP_S3_LEGACY_BINARY_SNAPSHOT_REVIEW_GATE_PASS'
            $previewRemoved = Invoke-NativeInspection $bundle (Join-Path $artifact 'setup-core-legacy-preview-removed.json') 0 '--uninstall-file'
            if ($previewRemoved.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
                (Test-Path -LiteralPath $stagedLegacy.installRoot) -or
                !(Test-Path -LiteralPath $oldExe) -or
                !(Test-Path -LiteralPath $oldUninstaller) -or
                !(Test-Path -LiteralPath $legacyKey)) {
                throw 'SETUP_S3_LEGACY_PREVIEW_CANCEL_BROKE_NSIS'
            }
            Write-Host 'IWXA_SETUP_S3_LEGACY_PREVIEW_AND_CANCEL_PRESERVE_NSIS_PASS'

            # A conflicting duplicate NSIS record must block adoption.
            $second = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\IWXA.Setup.Legacy.Fixture2'
            if (Test-Path -LiteralPath $second) { throw 'SETUP_LEGACY_SECOND_KEY_ALREADY_PRESENT' }
            New-Item -Path $second -Force | Out-Null
            try {
                New-ItemProperty -LiteralPath $second -Name DisplayName -Value 'IWXA Admin Center' -PropertyType String | Out-Null
                $ambiguous = Invoke-NativeInspection $bundle $legacyProbe 0 '--legacy-inspect-file'
                if ($ambiguous.status -ne 'LEGACY_AMBIGUOUS_HOLD') {
                    throw 'SETUP_S3_LEGACY_DUPLICATE_REGISTRY_ACCEPTED'
                }
                $denied = Invoke-NativeInspection $bundle (Join-Path $artifact 'setup-core-legacy-ambiguous-rejected.json') 2 '--stage-legacy-file'
                if ($denied.status -ne 'ERROR' -or
                    $denied.reason -notlike '*SETUP_LEGACY_OWNER_NOT_CONFIRMED*') {
                    throw 'SETUP_S3_LEGACY_AMBIGUOUS_STAGE_ALLOWED'
                }
            } finally {
                Remove-Item -LiteralPath $second -Recurse -Force -ErrorAction SilentlyContinue
            }
        } finally {
            Remove-Item -LiteralPath $legacyKey -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Host 'IWXA_SETUP_S3_LEGACY_READ_ONLY_DISCOVERY_PASS'
    } finally {
        Remove-Item -LiteralPath $legacy -Force -Recurse
    }

    # Mutate the deprecated V1 overlay; it remains read-only compatible,
    # but never becomes the user-facing signed distribution.
    $bytes = [IO.File]::ReadAllBytes($overlayFile)
    $start = [int][BitConverter]::ToUInt64($bytes, ($bytes.Length - 136 + 16))
    if ($start -le 1024 -or $start + 40 -ge $bytes.Length - 136) {
        throw 'SETUP_TAMPER_TEST_LAYOUT_INVALID'
    }
    $bytes[$start + 40] = [byte]($bytes[$start + 40] -bxor 1)
    [IO.File]::WriteAllBytes($damaged, $bytes)
    $rejected = Invoke-NativeInspection $damaged $badReport 2
    if ($rejected.status -ne 'ERROR' -or $rejected.reason -ne 'SETUP_PACKAGE_HASH_INVALID') {
        throw 'SETUP_NATIVE_TAMPER_ACCEPTED'
    }
    Write-Host 'IWXA_SETUP_NATIVE_TAMPER_REJECTED_PASS'

    # The native form is not an installer yet; check real Windows GUI / title.
    $gui = Start-Process -FilePath $bundle -PassThru
    try {
        $found = $false
        for ($i = 0; $i -lt 45; $i++) {
            Start-Sleep -Milliseconds 500
            $gui.Refresh()
            if ($gui.HasExited) { throw 'SETUP_GUI_EXITED_BEFORE_DISPLAY' }
            if ($gui.MainWindowHandle -ne [IntPtr]::Zero -and
                $gui.MainWindowTitle -like '*IWXA Admin Center*') {
                $found = $true
                break
            }
        }
        if (!$found) { throw 'SETUP_GUI_PRODUCT_NAME_NOT_VISIBLE' }
        Write-Host "IWXA_SETUP_NATIVE_GUI_PASS title=$($gui.MainWindowTitle)"

        Add-Type -AssemblyName System.Drawing
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName UIAutomationClient
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($gui.MainWindowHandle)
        $windowBounds = $window.Current.BoundingRectangle
        $screenBounds = [System.Windows.Forms.Screen]::FromHandle($gui.MainWindowHandle).Bounds
        $left = [int][Math]::Max($screenBounds.Left, $windowBounds.Left)
        $top = [int][Math]::Max($screenBounds.Top, $windowBounds.Top)
        $right = [int][Math]::Min($screenBounds.Right, $windowBounds.Right)
        $bottom = [int][Math]::Min($screenBounds.Bottom, $windowBounds.Bottom)
        if ($right - $left -lt 400 -or $bottom - $top -lt 300) {
            throw 'SETUP_VISUAL_WINDOW_BOUNDS_INVALID'
        }
        $bitmap = [System.Drawing.Bitmap]::new($right - $left, $bottom - $top)
        $drawing = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $drawing.CopyFromScreen(
                [System.Drawing.Point]::new($left, $top),
                [System.Drawing.Point]::Empty,
                $bitmap.Size)
            $imagePath = Join-Path $artifact 'setup-core-visual-first-install.png'
            $bitmap.Save($imagePath, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Host "IWXA_SETUP_NATIVE_GUI_VISUAL_CAPTURED $imagePath"
        } finally {
            $drawing.Dispose()
            $bitmap.Dispose()
        }
        # Accessibility tree details vary between Windows UIA providers.
        # Check the real user-visible product heading and window geometry;
        # do not require implementation-only Panel controls to be exposed.
        $descendants = $window.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        $titleElement = $null
        foreach ($element in $descendants) {
            try {
                if ($element.Current.Name -eq 'IWXA setup product heading' -or
                    $element.Current.Name -eq 'IWXA Admin Center') {
                    $rect = $element.Current.BoundingRectangle
                    if ($rect.Width -gt 100 -and $rect.Height -gt 20) {
                        $titleElement = $element
                        break
                    }
                }
            } catch {}
        }
        if ($null -eq $titleElement) {
            Write-Host ("IWXA_SETUP_UIA_NAMES=" +
                ((@($descendants | ForEach-Object { try { $_.Current.Name } catch {} }) |
                    Where-Object { $_ } | Select-Object -First 25) -join '|'))
            throw 'SETUP_VISUAL_PRODUCT_TITLE_UIA_MISSING'
        }
        $titleBounds = $titleElement.Current.BoundingRectangle
        $minLeft = $windowBounds.Left + $windowBounds.Width * 0.265
        if ($titleBounds.Left -lt $minLeft) {
            throw ('SETUP_VISUAL_SIDEBAR_OVERLAP titleLeft={0} requiredLeft={1}' -f
                $titleBounds.Left, $minLeft)
        }
        Write-Host ('IWXA_SETUP_VISUAL_NO_SIDEBAR_OVERLAP_PASS titleLeft={0}' -f
            $titleBounds.Left)

    } finally {
        if (!$gui.HasExited) {
            $null = $gui.CloseMainWindow()
            if (!$gui.WaitForExit(10000)) {
                Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue
            }
        }
        $gui.Dispose()
    }
    $hash = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash
    Write-Host "IWXA_SETUP_CORE_S1_PASS SHA256=$hash SIZE=$((Get-Item $bundle).Length)"
}
finally { Pop-Location }
