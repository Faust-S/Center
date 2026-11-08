# S3 installed GUI acceptance follows installed-windows-center.ps1 (two
# organizations, Atlas native projects, and saved manager drafts).
# Version dev.2 has the same application payload; test validates setup lifecycle.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$artifact = Join-Path $env:GITHUB_WORKSPACE 'artifacts'
$oldSetup = Join-Path $artifact 'iwxa-setup-core-center-0.3-preview.exe'
$newSetup = Join-Path $artifact 'setup-core-center-upgrade.exe'
$root = Join-Path $env:LOCALAPPDATA 'Programs/IWXA Admin Center'
$dataRoot = Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/atlas-store-v1'
$draft = Join-Path $dataRoot 'preparation/draft.json'
$orgRoot = Join-Path $dataRoot 'organizations'
foreach ($file in @($oldSetup,$newSetup,$draft,$orgRoot)) {
    if (!(Test-Path -LiteralPath $file)) { throw "S3_E2E_INPUT_MISSING $file" }
}
$draftData = Get-Content -LiteralPath $draft -Raw | ConvertFrom-Json -Depth 100
if (@($draftData.organizations).Count -ne 2) { throw 'S3_E2E_EXPECTED_TWO_ORGANIZATIONS' }

function Snapshot-Data {
    $files = @(Get-ChildItem -LiteralPath $dataRoot -Recurse -File)
    $rows = @($files | ForEach-Object {
        [string]$relative = $_.FullName.Substring($dataRoot.Length)
        $relative + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    })
    return (($rows | Sort-Object) -join [Environment]::NewLine)
}
function Invoke-Setup([string]$setup,[string]$mode,[string]$tag) {
    $report = Join-Path $artifact "setup-core-e2e-$tag.json"
    if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force }
    $p = Start-Process -FilePath $setup -ArgumentList ('{0} "{1}"' -f $mode,$report) -PassThru
    try {
        if (!$p.WaitForExit(100000)) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            throw "S3_E2E_TIMEOUT $mode"
        }
        if ($p.ExitCode -ne 0) { throw "S3_E2E_EXIT $mode $($p.ExitCode)" }
    } finally { $p.Dispose() }
    if (!(Test-Path -LiteralPath $report)) { throw 'S3_E2E_REPORT_MISSING' }
    return Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
}
$before = Snapshot-Data
$plan = Invoke-Setup $oldSetup '--upgrade-plan-file' 'old-plan'
if ($plan.status -ne 'REPAIR_CANDIDATE_NOT_ACTIVATED') {
    throw "S3_E2E_PREVIOUS_VERSION_MISSING $($plan.status)"
}
# Exercise the actual Setup GUI Update button, not only its CLI equivalent.
$setupUi = Start-Process -FilePath $newSetup -PassThru
try {
    $clicked = $false
    for ($i=0; $i -lt 75; $i++) {
        Start-Sleep -Milliseconds 400
        $setupUi.Refresh()
        if ($setupUi.HasExited) { throw 'S3_SETUP_GUI_EARLY_EXIT' }
        if ($setupUi.MainWindowHandle -eq [IntPtr]::Zero) { continue }
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($setupUi.MainWindowHandle)
        if ($null -eq $window) { continue }
        $condition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::NameProperty,'Обновить')
        $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
        foreach ($button in $buttons) {
            try {
                if ($button.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
                    $button.Current.IsEnabled) {
                    $pattern = $button.GetCurrentPattern(
                        [System.Windows.Automation.InvokePattern]::Pattern)
                    $pattern.Invoke()
                    $clicked = $true
                    break
                }
            } catch {}
        }
        if ($clicked) { break }
    }
    if (!$clicked) { throw 'S3_SETUP_GUI_UPDATE_BUTTON_MISSING' }
    $switched = $false
    for ($i=0; $i -lt 90; $i++) {
        Start-Sleep -Milliseconds 350
        $installed = Get-ItemProperty -Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center' -ErrorAction SilentlyContinue
        if ($installed.Version -eq '0.3.0-dev.2' -and
            (Test-Path -LiteralPath ($root + '.iwxa-previous'))) {
            $switched = $true
            break
        }
    }
    if (!$switched) { throw 'S3_SETUP_GUI_UPDATE_NOT_ACTIVATED' }
    Write-Host 'IWXA_SETUP_S3_REAL_GUI_UPDATE_BUTTON_PASS'
} finally {
    if (!$setupUi.HasExited) {
        $null = $setupUi.CloseMainWindow()
        if (!$setupUi.WaitForExit(10000)) {
            Stop-Process -Id $setupUi.Id -Force -ErrorAction SilentlyContinue
        }
    }
    $setupUi.Dispose()
}
if ((Snapshot-Data) -ne $before) { throw 'S3_E2E_DATA_CHANGED_ON_UPGRADE' }
Write-Host 'IWXA_SETUP_S3_TWO_ORGANIZATIONS_NATIVE_READBACK_PASS'

# Check actual installed GUI, not only an installer receipt and a process ID.
$exe = Join-Path $root 'iwxa-admin-center.exe'
$gui = Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
try {
    $visible = $false
    for ($i=0; $i -lt 75; $i++) {
        Start-Sleep -Milliseconds 400
        $gui.Refresh()
        if ($gui.HasExited) { throw 'S3_E2E_GUI_EXITED' }
        if ($gui.MainWindowHandle -eq [IntPtr]::Zero) { continue }
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($gui.MainWindowHandle)
        $nodes = $window.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($node in $nodes) {
            try {
                if ($node.Current.Name -eq 'Организация' -and
                    $node.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox) {
                    $visible = $true
                    break
                }
            } catch {}
        }
        if ($visible) { break }
    }
    if (!$visible) { throw 'S3_E2E_ORGANIZATION_SELECTOR_MISSING' }
    Write-Host 'IWXA_SETUP_S3_GUI_REOPEN_AFTER_UPGRADE_PASS'
} finally {
    if (!$gui.HasExited) {
        $null = $gui.CloseMainWindow()
        if (!$gui.WaitForExit(10000)) {
            Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue
            throw 'S3_E2E_GUI_CLOSE_FAILED'
        }
    }
    $gui.Dispose()
}
if ((Snapshot-Data) -ne $before) { throw 'S3_E2E_DATA_CHANGED_ON_REOPEN' }
$confirmation = Invoke-Setup $newSetup '--confirm-upgrade-file' 'confirm'
if ($confirmation.status -ne 'UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED' -or
    (Test-Path -LiteralPath ($root + '.iwxa-previous'))) {
    throw 'S3_E2E_CONFIRM_FAILED'
}
$final = Invoke-Setup $newSetup '--upgrade-plan-file' 'final-plan'
if ($final.status -ne 'REPAIR_CANDIDATE_NOT_ACTIVATED' -or
    (Snapshot-Data) -ne $before) { throw 'S3_E2E_DATA_CHANGED_ON_CONFIRM' }
Write-Host 'IWXA_SETUP_S3_GUI_DATA_READBACK_CONFIRM_PASS'
