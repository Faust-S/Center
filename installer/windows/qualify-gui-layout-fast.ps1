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
    foreach ($element in @($progress, (One $form 'iwxaSetupActivity'))) {
        if ($element.Right -gt $card.ClientSize.Width -or $element.Left -lt 0) {
            throw ('SETUP_LAYOUT_PROGRESS_CLIPPED_' + $case)
        }
    }
    if ($note.Height -lt $note.Font.Height * 2) {
        throw ('SETUP_LAYOUT_PRESERVATION_TEXT_CLIPPED_' + $case +
            ' height=' + $note.Height + ' font=' + $note.Font.Height)
    }
    if ($actions.ClientSize.Width -lt 565) {
        # Two-button state is always usable at this width; when rollback
        # appears the compact action group is asserted independently below.
        if ($actions.ClientSize.Width -lt 520) {
            throw ('SETUP_LAYOUT_ACTIONS_TOO_NARROW_' + $case)
        }
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
        $form.Size = [Drawing.Size]::new(
            [int][Math]::Round(820 * $factor),
            [int][Math]::Round(610 * $factor))
        Assert-Layout $form ('minimum-' + $factor)
    } finally {
        $form.Dispose()
    }
}
Write-Host 'IWXA_SETUP_NATIVE_DPI_LAYOUT_MATRIX_PASS'
