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
        '-m', 'installer.build_bundle', 'build',
        '--product', $profile, '--payload', $payload, '--stub', $stub,
        '--output', $bundle, '--source-commit', $sourceHead, '--source-tree', $sourceTree
    )
    $details = & python @arguments
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_BUNDLE_BUILD_FAILED' }
    $manifest = $details | ConvertFrom-Json
    if ($manifest.status -ne 'VERIFIED' -or $manifest.product -ne 'iwxa.admin-center') {
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
    if ($native.status -ne 'VERIFIED' -or $native.product -ne $manifest.product -or
        $native.version -ne '0.3.0-dev.1' -or $native.sourceCommit -ne $sourceHead -or
        $native.packageSha256 -ne $manifest.payload_sha256 -or $native.files -ne $manifest.file_count) {
        throw 'SETUP_NATIVE_PYTHON_DISAGREEMENT'
    }
    Write-Host "IWXA_SETUP_NATIVE_PACKAGE_PASS files=$($native.files) version=$($native.version)"

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
    $nextArgs = @('-m', 'installer.build_bundle', 'build', '--product', $upgradeProfile,
        '--payload', $payload, '--stub', $stub, '--output', $upgradeCandidate,
        '--source-commit', $sourceHead, '--source-tree', $sourceTree)
    $null = & python @nextArgs
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_S3_NEW_VERSION_BUILD_FAILED' }
    $nextIdentity = Invoke-NativeInspection $upgradeCandidate (Join-Path $artifact 'setup-core-next-identity.json') 0
    if ($nextIdentity.version -ne '0.3.0-dev.2') { throw 'SETUP_S3_NEW_VERSION_INVALID' }
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

        $refused = Invoke-NativeInspection $bundle $duplicateReport 2 '--install-file'
        if ($refused.status -ne 'ERROR' -or
            $refused.reason -notlike 'SETUP_BLOCKED_EXISTING_INSTALLATION*') {
            throw 'SETUP_NATIVE_DUPLICATE_INSTALL_ACCEPTED'
        }
        Write-Host 'IWXA_SETUP_NATIVE_DUPLICATE_INSTALL_REJECTED_PASS'

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
    } finally {
        Remove-Item -LiteralPath $legacy -Force -Recurse
    }

    # Mutate the authenticated ZIP overlay without touching the PE executable.
    $bytes = [IO.File]::ReadAllBytes($bundle)
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
