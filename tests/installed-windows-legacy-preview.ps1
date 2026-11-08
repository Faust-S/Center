# Real NSIS 0.2 -> Setup Core 0.3 preview; no uninstall of original NSIS.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$artifact = Join-Path $env:GITHUB_WORKSPACE 'artifacts'
$bundle = Join-Path $artifact 'iwxa-setup-core-center-0.3-preview.exe'
$oldRoot = Join-Path $env:LOCALAPPDATA 'IWXA Admin Center'
$newRoot = Join-Path $env:LOCALAPPDATA 'Programs/IWXA Admin Center'
$dataRoot = Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/atlas-store-v1'
$draft = Join-Path $dataRoot 'preparation/draft.json'
$orgs = Join-Path $dataRoot 'organizations'
$oldExe = Join-Path $oldRoot 'iwxa-admin-center.exe'
$oldUninstaller = Join-Path $oldRoot 'uninstall.exe'
foreach ($p in @($bundle, $draft, $orgs, $oldExe, $oldUninstaller)) {
    if (!(Test-Path -LiteralPath $p)) { throw "LEGACY_REAL_INPUT_MISSING $p" }
}
if (Test-Path -LiteralPath $newRoot) { throw 'LEGACY_NEW_ROOT_ALREADY_EXISTS' }
$draftState = Get-Content -LiteralPath $draft -Raw | ConvertFrom-Json -Depth 100
if (@($draftState.organizations).Count -ne 2) {
    throw 'LEGACY_TWO_ORG_STATE_MISSING'
}
function Snapshot {
    $files = @(Get-ChildItem -LiteralPath $dataRoot -Recurse -File)
    $rows = @($files | ForEach-Object {
        $name = $_.FullName.Substring($dataRoot.Length)
        $sha = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        $name + '|' + $sha
    })
    return (($rows | Sort-Object) -join [Environment]::NewLine)
}
function Run-Setup([string]$mode,[string]$label) {
    $output = Join-Path $artifact "legacy-nsis-preview-$label.json"
    if (Test-Path -LiteralPath $output) {
        Remove-Item -LiteralPath $output -Force
    }
    $p = Start-Process -FilePath $bundle -ArgumentList (
        '{0} "{1}"' -f $mode,$output) -PassThru
    try {
        if (!$p.WaitForExit(90000)) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            throw "LEGACY_SETUP_TIMEOUT $mode"
        }
        if ($p.ExitCode -ne 0) { throw "LEGACY_SETUP_FAILED_$mode $($p.ExitCode)" }
    } finally { $p.Dispose() }
    if (!(Test-Path -LiteralPath $output)) {
        throw "LEGACY_SETUP_REPORT_MISSING $mode"
    }
    return Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
}
$before = Snapshot
$hashExe = (Get-FileHash -LiteralPath $oldExe -Algorithm SHA256).Hash
$hashUninstaller = (Get-FileHash -LiteralPath $oldUninstaller -Algorithm SHA256).Hash
$legacy = Run-Setup '--legacy-inspect-file' 'inspect'
Write-Host ("IWXA_REAL_NSIS_0_2_DISCOVERY status={0} version={1} registry={2} root={3} uninstaller={4}" -f
    $legacy.status,$legacy.installedVersion,$legacy.registryName,
    $legacy.installRoot,$legacy.uninstaller)
if ($legacy.status -ne 'LEGACY_CONFIRMED_READ_ONLY' -or
    $legacy.installedVersion -ne '0.2.0' -or
    $legacy.installRoot -ne $oldRoot) {
    throw "LEGACY_REAL_NSIS_0_2_IDENTITY_UNVERIFIED $($legacy.status)"
}
$preflight = Run-Setup '--preflight-file' 'preflight'
if ($preflight.status -ne 'LEGACY_INSTALLATION') {
    throw "LEGACY_PREVIEW_WRONG_PREFLIGHT $($preflight.status)"
}
$stage = Run-Setup '--stage-legacy-file' 'stage'
if ($stage.status -ne 'LEGACY_MIGRATION_STAGED_NSIS_PRESERVED' -or
    $stage.version -ne '0.3.0-dev.1' -or
    $stage.installRoot -ne $newRoot -or
    !(Test-Path -LiteralPath (Join-Path $newRoot 'iwxa-admin-center.exe'))) {
    throw 'LEGACY_PREVIEW_STAGE_FAILED'
}
if ((Get-FileHash -LiteralPath $oldExe -Algorithm SHA256).Hash -ne $hashExe -or
    (Get-FileHash -LiteralPath $oldUninstaller -Algorithm SHA256).Hash -ne $hashUninstaller -or
    (Snapshot) -ne $before) {
    throw 'LEGACY_PREVIEW_CHANGED_ORIGINAL_NSIS_OR_DATA'
}
$pending = Run-Setup '--upgrade-plan-file' 'pending'
if ($pending.status -ne 'LEGACY_MIGRATION_PENDING_GUI_READBACK') {
    throw "LEGACY_PREVIEW_PENDING_NOT_RECOGNIZED $($pending.status)"
}
$exe = Join-Path $newRoot 'iwxa-admin-center.exe'
$gui = Start-Process -FilePath $exe -WorkingDirectory $newRoot -PassThru
try {
    $found = $false
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Milliseconds 400
        $gui.Refresh()
        if ($gui.HasExited) { throw 'LEGACY_PREVIEW_NEW_GUI_EXITED' }
        if ($gui.MainWindowHandle -eq [IntPtr]::Zero) { continue }
        $window = [System.Windows.Automation.AutomationElement]::FromHandle(
            $gui.MainWindowHandle)
        $elements = $window.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($element in $elements) {
            try {
                if ($element.Current.Name -eq 'Организация' -and
                    $element.Current.ControlType -eq
                        [System.Windows.Automation.ControlType]::ComboBox) {
                    $found = $true
                    break
                }
            } catch {}
        }
        if ($found) { break }
    }
    if (!$found) { throw 'LEGACY_PREVIEW_NEW_GUI_ORGANIZATION_MISSING' }
    Write-Host 'IWXA_REAL_NSIS_TO_NATIVE_GUI_READBACK_PASS'
} finally {
    if (!$gui.HasExited) {
        $null = $gui.CloseMainWindow()
        if (!$gui.WaitForExit(10000)) {
            Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue
            throw 'LEGACY_PREVIEW_NEW_GUI_CLOSE_FAILED'
        }
    }
    $gui.Dispose()
}
if ((Snapshot) -ne $before) {
    throw 'LEGACY_PREVIEW_DATA_CHANGED_AFTER_NEW_GUI'
}
$cancel = Run-Setup '--uninstall-file' 'cancel'
if ($cancel.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
    (Test-Path -LiteralPath $newRoot) -or
    !(Test-Path -LiteralPath $oldExe) -or
    !(Test-Path -LiteralPath $oldUninstaller) -or
    (Get-FileHash -LiteralPath $oldExe -Algorithm SHA256).Hash -ne $hashExe -or
    (Snapshot) -ne $before) {
    throw 'LEGACY_PREVIEW_CANCEL_DAMAGED_STABLE_NSIS'
}
$check = Run-Setup '--legacy-inspect-file' 'after-cancel'
if ($check.status -ne 'LEGACY_CONFIRMED_READ_ONLY') {
    throw 'LEGACY_PREVIEW_CANCEL_REMOVED_ORIGINAL_REGISTRATION'
}
Write-Host 'IWXA_REAL_NSIS_0_2_TO_NATIVE_0_3_PREVIEW_CANCEL_PASS'
