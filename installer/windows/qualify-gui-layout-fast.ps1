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
    } finally {
        $form.Dispose()
    }
}
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

