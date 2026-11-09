# Verify real WinForms geometry without installing any IWXA application.
# Scale the native form to mimic 100%, 150%, 200% and 250% DPI layouts.
[CmdletBinding()]
param([string]$Stub = 'artifacts/iwxa-setup-core-early.exe')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$stubFull = [IO.Path]::GetFullPath($Stub)
if (-not (Test-Path -LiteralPath $stubFull -PathType Leaf)) {
    throw 'SETUP_LAYOUT_NATIVE_STUB_MISSING'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne
    [Threading.ApartmentState]::STA) {
    throw 'SETUP_LAYOUT_STA_REQUIRED'
}
$assembly = [Reflection.Assembly]::LoadFrom($stubFull)
# Windows Details and CLR identity must show Setup Core 1.0, not the
# generic "stub" filename or an unspecified version.
$details = [Diagnostics.FileVersionInfo]::GetVersionInfo($stubFull)
if ($assembly.GetName().Version.ToString() -ne '1.0.0.0' -or
    $details.FileVersion -ne '1.0.0.0' -or
    $details.ProductName -ne 'IWXA Setup Core' -or
    $details.CompanyName -ne 'IWXA' -or
    $details.ProductVersion -ne '1.0.0') {
    throw ('SETUP_RELEASE_FILE_IDENTITY_INVALID version=' +
        $details.FileVersion + ' product=' + $details.ProductName +
        ' productVersion=' + $details.ProductVersion)
}
Write-Host 'IWXA_SETUP_1_0_WINDOWS_FILE_IDENTITY_PASS'
# Destination disk preflight uses a deterministic, overflow-checked
# budget. Test the actual compiled native routine, not a test duplicate.
$engine = $assembly.GetType('IwxaSetup.SetupInstallation', $true)
$storageBudget = $engine.GetMethod('RequiredStorageMoveBytes',
    [Reflection.BindingFlags]'Static, NonPublic')
if ($null -eq $storageBudget) {
    throw 'SETUP_STORAGE_CAPACITY_PREFLIGHT_MISSING'
}
$measured = [long]$storageBudget.Invoke($null,
    [object[]]@([long]100000000, [long]100))
if ($measured -ne [long]169518464) {
    throw ('SETUP_STORAGE_CAPACITY_MULTIFILE_BUDGET_WRONG_' + $measured)
}
$zero = [long]$storageBudget.Invoke($null,
    [object[]]@([long]0, [long]0))
if ($zero -ne [long]67108864) {
    throw ('SETUP_STORAGE_CAPACITY_RESERVE_WRONG_' + $zero)
}
Write-Host 'IWXA_SETUP_STORAGE_DESTINATION_CAPACITY_PREFLIGHT_PASS'
# Exercise the real cancellable copy helper on a local directory. Cancellation
# must not create a destination, and a normal copy must pass hash readback.
$copyMethod = $engine.GetMethod('CopyVerifiedStorage',
    [Reflection.BindingFlags]'Static, NonPublic')
if ($null -eq $copyMethod) {
    throw 'SETUP_STORAGE_CANCELLABLE_COPY_MISSING'
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) (
    'iwxa-setup-cancel-' + [Guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $testRoot 'original'
$cancelledRoot = Join-Path $testRoot 'cancelled'
$copiedRoot = Join-Path $testRoot 'copied'
$cancelSource = New-Object 'System.Threading.CancellationTokenSource'
try {
    New-Item -ItemType Directory -Force -Path $sourceRoot | Out-Null
    $fixture = Join-Path $sourceRoot 'model.fixture'
    [IO.File]::WriteAllBytes($fixture, (New-Object byte[] 2097152))
    $cancelSource.Cancel()
    $copyArgs = New-Object 'System.Object[]' 4
    $copyArgs[0] = [string]$sourceRoot
    $copyArgs[1] = [string]$cancelledRoot
    $copyArgs[2] = [Threading.CancellationToken]$cancelSource.Token
    $copyArgs[3] = $null
    $cancelled = $false
    try {
        $null = $copyMethod.Invoke($null, $copyArgs)
    } catch [Reflection.TargetInvocationException] {
        if ($_.Exception.InnerException -isnot [OperationCanceledException]) {
            throw
        }
        $cancelled = $true
    }
    if (!$cancelled -or (Test-Path -LiteralPath $cancelledRoot)) {
        throw 'SETUP_STORAGE_CANCEL_CREATED_TARGET'
    }
    $copyArgs[1] = [string]$copiedRoot
    $copyArgs[2] = [Threading.CancellationToken]::None
    $null = $copyMethod.Invoke($null, $copyArgs)
    $after = Join-Path $copiedRoot 'model.fixture'
    if (!(Test-Path -LiteralPath $after) -or
        (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $after -Algorithm SHA256).Hash) {
        throw 'SETUP_STORAGE_CHUNKED_HASH_READBACK_FAILED'
    }
    Write-Host 'IWXA_SETUP_STORAGE_COPY_CANCEL_AND_READBACK_PASS'
} finally {
    $cancelSource.Dispose()
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
$formType = $assembly.GetType('IwxaSetup.SetupForm', $true)
function One([System.Windows.Forms.Control]$form, [string]$name) {
    $items = @($form.Controls.Find($name,$true))
    if ($items.Count -ne 1) { throw ('SETUP_LAYOUT_WIDGET_MISSING_' + $name) }
    return [System.Windows.Forms.Control]$items[0]
}
function Assert-Layout([System.Windows.Forms.Form]$form,[string]$case) {
    $form.PerformLayout()
    $shell = $form.Controls[0]
    $shell.PerformLayout()
    $area = One $form 'iwxaSetupContent'
    $area.PerformLayout()
    $card = One $form 'iwxaSetupPackageCard'
    $card.PerformLayout()
    $note = One $form 'iwxaSetupPreservationNote'
    $related = One $form 'iwxaSetupRelatedAction'
    $actions = One $form 'iwxaSetupActions'
    $progress = One $form 'iwxaSetupActivity'
    $preferences = One $form 'iwxaSetupPreferences'
    if ($preferences.Left -lt 0 -or
        $preferences.Right -gt $area.ClientSize.Width -or
        $preferences.Bottom -gt (One $form 'iwxaSetupPackageCard').Top) {
        throw ('SETUP_LAYOUT_PREFERENCES_OUT_OF_BOUNDS_' + $case)
    }
    if ($card.Left -lt 0 -or $card.Right -gt $area.ClientSize.Width -or
        $card.Bottom -gt $actions.Top -or $note.Top -lt $card.Bottom -or
        $note.Bottom -gt $related.Top -or
        $related.Bottom -gt $actions.Top -or
        $actions.Bottom -gt $area.ClientSize.Height) {
        throw ('SETUP_LAYOUT_CONTENT_OVERLAP_' + $case +
            ' area=' + $area.ClientSize + ' card=' + $card.Bounds +
            ' note=' + $note.Bounds + ' link=' + $related.Bounds +
            ' actions=' + $actions.Bounds)
    }
    foreach ($name in @('iwxaSetupStatus', 'iwxaSetupVersion',
            'iwxaSetupDetails', 'iwxaSetupActivity')) {
        $element = One $form $name
        if ($element.Right -gt $card.ClientSize.Width -or $element.Left -lt 0) {
            throw ('SETUP_LAYOUT_CARD_CONTENT_CLIPPED_' + $case + '_' + $name)
        }
    }
    if ($note.Height -lt $note.Font.Height * 2) {
        throw ('SETUP_LAYOUT_PRESERVATION_TEXT_CLIPPED_' + $case +
            ' height=' + $note.Height + ' font=' + $note.Font.Height)
    }
    # Check the widest native state: primary + Rollback + Verify again.
    $needed = $actions.Padding.Horizontal
    foreach ($button in @($actions.Controls | Where-Object {
            $_ -is [System.Windows.Forms.Button] })) {
        $needed += $button.Width + $button.Margin.Horizontal
    }
    if ($needed -gt $actions.ClientSize.Width) {
        throw ('SETUP_LAYOUT_ACTIONS_CLIPPED_' + $case +
            ' needed=' + $needed + ' available=' + $actions.ClientSize.Width)
    }
    Write-Host ('IWXA_SETUP_LAYOUT_PASS case=' + $case +
        ' area=' + $area.ClientSize + ' noteHeight=' + $note.Height +
        ' actionsWidth=' + $actions.ClientSize.Width)
}
# Qualify the same WinForms recovery controls for both a fresh install
# and an already installed product whose WebView2 Runtime has disappeared.
# This does not mutate the host's shared WebView2 installation.
$offer = $formType.GetMethod('OfferWebView2Recovery',
    [Reflection.BindingFlags]'Instance, NonPublic')
$flags = [Reflection.BindingFlags]'Instance, NonPublic'
$primary = $formType.GetField('primaryAction', $flags)
$alternate = $formType.GetField('secondaryAction', $flags)
if ($null -eq $offer -or $null -eq $primary -or $null -eq $alternate) {
    throw 'SETUP_WEBVIEW2_RECOVERY_NATIVE_ROUTE_MISSING'
}
foreach ($installedProduct in @($false, $true)) {
    $recoveryForm = [System.Activator]::CreateInstance($formType, $true)
    try {
        $invokeArgs = New-Object 'System.Object[]' 2
        $invokeArgs[0] = 'Version 0.3.0'
        $invokeArgs[1] = [bool]$installedProduct
        $null = $offer.Invoke($recoveryForm, $invokeArgs)
        $related = One $recoveryForm 'iwxaSetupRelatedAction'
        $heading = One $recoveryForm 'iwxaSetupStatus'
        $details = One $recoveryForm 'iwxaSetupDetails'
        if ([string]$primary.GetValue($recoveryForm) -ne 'InstallWebView2' -or
            [string]$alternate.GetValue($recoveryForm) -ne 'InstallWebView2Offline' -or
            [string]$related.Tag -ne 'WEBVIEW2' -or
            $related.Text -notmatch 'Microsoft' -or
            $heading.Text -notmatch 'WebView2') {
            throw ('SETUP_WEBVIEW2_RECOVERY_ACTIONS_MISSING_installed=' +
                $installedProduct)
        }
        if ($installedProduct -and
            $details.Text -notmatch '(?:данные|user data)') {
            throw 'SETUP_WEBVIEW2_OWNED_INSTALL_DATA_PRESERVATION_TEXT_MISSING'
        }
    } finally {
        $recoveryForm.Dispose()
    }
}
Write-Host 'IWXA_SETUP_WEBVIEW2_RECOVERY_NATIVE_CONTROLS_PASS'

foreach ($factor in @(1.0, 1.5, 2.0, 2.5)) {
    $form = [System.Activator]::CreateInstance($formType,$true)
    try {
        $null = $form.Handle
        if ($factor -ne 1.0) {
            $form.Scale([Drawing.SizeF]::new([single]$factor,[single]$factor))
        }
        $form.ClientSize = [Drawing.Size]::new(
            [int][Math]::Round(900 * $factor),
            [int][Math]::Round(560 * $factor))
        Assert-Layout $form ('nominal-' + $factor)
        # Form.Scale on a non-visible host does not reliably dock its child
        # back into a smaller parent. Force the *content viewport* to the
        # physical equivalent of the supported 820x610 window and check its
        # real child bounds. This is simulated DPI, not a Windows DPI witness.
        $compactViewport = [Drawing.Size]::new(
            [int][Math]::Round(804 * $factor),
            [int][Math]::Round(571 * $factor))
        $shell = $form.Controls[0]
        $shell.Dock = [System.Windows.Forms.DockStyle]::None
        $shell.Size = $compactViewport
        $shell.PerformLayout()
        $area = One $form 'iwxaSetupContent'
        $maxCompactWidth = [int][Math]::Round(590 * $factor)
        if ($area.ClientSize.Width -gt $maxCompactWidth) {
            throw ('SETUP_LAYOUT_COMPACT_VIEWPORT_NOT_EXERCISED_' + $factor +
                ' actual=' + $area.ClientSize + ' shell=' + $shell.Size)
        }
        Assert-Layout $form ('compact-' + $factor)
        # At 200% this is a 1468x968 physical content viewport, suitable
        # for a 1920x1080 laptop once its taskbar and titlebar are reserved.
        # Test the real WinForms geometry, not an invented percentage.
        $laptopViewport = [Drawing.Size]::new(
            [int][Math]::Round(734 * $factor),
            [int][Math]::Round(484 * $factor))
        $shell.Size = $laptopViewport
        $shell.PerformLayout()
        Assert-Layout $form ('compact-laptop-' + $factor)
    } finally {
        $form.Dispose()
    }
}
# 1920x1080 Windows desktop with a 40px taskbar and 200% scaling:
# native requested window is 1800x1200, minimum 1500x1040, work 1920x1040.
$fit = $formType.GetMethod('FitToWorkingAreaSize',
    [Reflection.BindingFlags]'Static, Public, NonPublic')
if ($null -eq $fit) { throw 'SETUP_1080P_WORKAREA_FIT_MISSING' }
$fitArgs = New-Object 'System.Object[]' 3
$fitArgs[0] = [Drawing.Size]::new(1800,1200)
$fitArgs[1] = [Drawing.Size]::new(1500,1040)
$fitArgs[2] = [Drawing.Size]::new(1920,1040)
$fitted = [Drawing.Size]$fit.Invoke($null,$fitArgs)
if ($fitted.Width -ne 1800 -or $fitted.Height -ne 1040) {
    throw ('SETUP_1080P_200PCT_WINDOW_OUTSIDE_WORKAREA_' + $fitted)
}
Write-Host 'IWXA_SETUP_1080P_200PCT_WORKAREA_FIT_PASS'

# Verify that the actual native options dialog provides an editable program
# root before installation, a locked location after install, and login choice.
$settingsMethod = $formType.GetMethod('CreateOptionsDialog',
    [Reflection.BindingFlags]'Instance, NonPublic')
if ($null -eq $settingsMethod) {
    throw 'SETUP_OPTIONS_NATIVE_DIALOG_MISSING'
}
$hostForm = [System.Activator]::CreateInstance($formType,$true)
try {
    $cancelButton = One $hostForm 'iwxaSetupCancelStorageMove'
    if ($cancelButton.Enabled -or $cancelButton.Visible) {
        throw 'SETUP_STORAGE_CANCEL_SHOWN_WITHOUT_ACTIVE_TRANSFER'
    }
    $reasonMethod = $formType.GetMethod('ExplainStorageSettingsError',
        [Reflection.BindingFlags]'Instance, NonPublic')
    if ($null -eq $reasonMethod) {
        throw 'SETUP_STORAGE_HUMAN_READABLE_ERROR_MISSING'
    }
    $testException = [System.Exception]::new(
        'SETUP_STORAGE_DISK_SPACE_INSUFFICIENT_required=200000000_available=100000000_volume=C:')
    $invokeArgs = New-Object 'System.Object[]' 1
    $invokeArgs[0] = $testException
    $spaceMessage = [string]$reasonMethod.Invoke($hostForm, $invokeArgs)
    if ($spaceMessage -notmatch '[0-9].*[0-9]' -or
        $spaceMessage -match 'SETUP_STORAGE_DISK_SPACE_INSUFFICIENT') {
        throw 'SETUP_STORAGE_HUMAN_READABLE_DISK_SPACE_ERROR_INVALID'
    }
    Write-Host 'IWXA_SETUP_STORAGE_LOCALIZED_DISK_ERROR_PASS'
    $locationsType = $assembly.GetType('IwxaSetup.SetupLocations', $true)
    foreach($editable in @($true,$false)) {
        $locations = [System.Activator]::CreateInstance($locationsType, $true)
        $flags = [Reflection.BindingFlags]'Instance, Public, NonPublic'
        foreach($entry in @{
            ProgramRoot='C:\IWXA Test\Center'
            DataRoot='C:\IWXA Test\Data'
            SoftwareRoot='C:\IWXA Test\Software'
            ModelsRoot='C:\IWXA Test\Models'
            CacheRoot='C:\IWXA Test\Cache'
        }.GetEnumerator()) {
            $locationsType.GetField($entry.Key, $flags).SetValue(
                $locations, [string]$entry.Value)
        }
        $locationsType.GetField('StartWithWindows', $flags).SetValue(
            $locations,[bool](!$editable))
        $values = New-Object 'System.Object[]' 3
        $values[0] = 'IWXA Admin Center'
        $values[1] = $locations
        $values[2] = [bool]$editable
        $dialog = [System.Windows.Forms.Form]$settingsMethod.Invoke($hostForm,$values)
        try {
            $null = $dialog.Handle
            $start = One $dialog 'iwxaSetupLogin'
            $tabs = One $dialog 'iwxaSetupPreferencesTabs'
            if ($tabs -isnot [System.Windows.Forms.TabControl] -or
                $tabs.TabPages.Count -ne 2 -or
                $start.Checked -ne (!$editable)) {
                throw ('SETUP_OPTIONS_NAVIGATION_OR_LOGIN_MISSING_' + $editable)
            }
            foreach($name in @(
                'iwxaSetupInstallRoot','iwxaSetupDataRoot',
                'iwxaSetupSoftwareRoot','iwxaSetupModelsRoot',
                'iwxaSetupCacheRoot')) {
                $input = One $dialog $name
                $readonlyExpected = ($name -eq 'iwxaSetupInstallRoot' -and
                    !$editable)
                if ($input -isnot [System.Windows.Forms.TextBox] -or
                    $input.ReadOnly -ne $readonlyExpected -or
                    [string]::IsNullOrWhiteSpace($input.Text)) {
                    throw ('SETUP_OPTIONS_STORAGE_FIELD_INVALID_' + $name +
                        '_' + $editable)
                }
            }
            Write-Host ('IWXA_SETUP_OPTIONS_STORAGE_TABS_PASS editable=' + $editable)
        } finally { $dialog.Dispose() }
    }
} finally { $hostForm.Dispose() }

Write-Host 'IWXA_SETUP_NATIVE_DPI_LAYOUT_MATRIX_PASS'
# The manifest must affect the native *process*, not just exist in source.
# System-aware DPI is the supported .NET Framework WinForms policy.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IwxaDpiProcessProbe {
    [DllImport("shcore.dll")]
    public static extern int GetProcessDpiAwareness(IntPtr handle, out int awareness);
}
'@
$native = Start-Process -FilePath $stubFull -PassThru
try {
    $native.Refresh()
    if ($native.HasExited) { throw 'SETUP_DPI_NATIVE_PROCESS_EARLY_EXIT' }
    $awareness = -1
    $hr = [IwxaDpiProcessProbe]::GetProcessDpiAwareness(
        $native.Handle, [ref]$awareness)
    if ($hr -ne 0 -or $awareness -ne 1) {
        throw ('SETUP_DPI_PROCESS_NOT_SYSTEM_AWARE hr=' + $hr +
            ' awareness=' + $awareness)
    }
    Write-Host 'IWXA_SETUP_SYSTEM_DPI_PROCESS_PASS'
} finally {
    if (-not $native.HasExited) {
        $null = $native.CloseMainWindow()
        if (-not $native.WaitForExit(3000)) {
            Stop-Process -Id $native.Id -Force -ErrorAction SilentlyContinue
        }
    }
    $native.Dispose()
}

