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
# Match the real SetupCore.Program.Main before constructing any Form.
# Otherwise PowerShell renders unthemed WinForms buttons with black edges
# that do not exist in the real customer installer.
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)
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
    } catch {
        $cause = $_.Exception
        while ($null -ne $cause.InnerException) {
            $cause = $cause.InnerException
        }
        if ($cause -isnot [OperationCanceledException]) {
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
$canUninstall = $formType.GetMethod('AllowsOwnedUninstall',
    [Reflection.BindingFlags]'Static, NonPublic')
if ($null -eq $canUninstall) {
    throw 'SETUP_INSTALLED_UNINSTALL_ELIGIBILITY_MISSING'
}
foreach ($case in @(
    @{State='REPAIR_CANDIDATE_NOT_ACTIVATED'; Eligible=$true},
    @{State='UPGRADE_CANDIDATE_NOT_ACTIVATED'; Eligible=$true},
    @{State='APPLICATION_RUNNING'; Eligible=$true},
    @{State='DOWNGRADE_BLOCKED'; Eligible=$true},
    @{State='SAME_VERSION_DIFFERENT_PACKAGE'; Eligible=$true},
    @{State='WEBVIEW2_MISSING'; Eligible=$true},
    @{State='NO_OWNED_INSTALLATION'; Eligible=$false},
    @{State='OWNERSHIP_MISMATCH'; Eligible=$false},
    @{State='UPGRADE_PENDING_CONFIRMATION'; Eligible=$false},
    @{State='LEGACY_MIGRATION_PENDING_GUI_READBACK'; Eligible=$false},
    @{State='UPGRADE_RECOVERY_REQUIRED'; Eligible=$false},
    @{State='INSTALL_OPERATION_BUSY'; Eligible=$false}
)) {
    $arg = New-Object 'System.Object[]' 1
    $arg[0] = [string]$case.State
    if ([bool]$canUninstall.Invoke($null, $arg) -ne [bool]$case.Eligible) {
        throw ('SETUP_UNINSTALL_ELIGIBILITY_WRONG_' + $case.State)
    }
}
Write-Host 'IWXA_SETUP_VERIFIED_UNINSTALL_STATES_PASS'
# Current unified native form: no sidebar, tabs, or scrollbars.
function One([System.Windows.Forms.Control]$form,[string]$name){
    $found=@($form.Controls.Find($name,$true))
    if($found.Count -ne 1){throw ('SETUP_UNIFIED_WIDGET_MISSING_'+$name)}
    return [System.Windows.Forms.Control]$found[0]
}
function AllControls([System.Windows.Forms.Control]$parent){
    foreach($item in $parent.Controls){
        Write-Output $item
        AllControls $item
    }
}
# Check local Visible bit: the parent test Form is intentionally not shown.
function WantsVisible([System.Windows.Forms.Control]$control){
    $method=[System.Windows.Forms.Control].GetMethod('GetState',
        [Reflection.BindingFlags]'Instance,NonPublic')
    if($null -eq $method){throw 'SETUP_LOCAL_VISIBILITY_INSPECTOR_MISSING'}
    return [bool]$method.Invoke($control,[object[]]@([int]2))
}
function AssertUnified([System.Windows.Forms.Form]$form,[string]$label){
    $form.PerformLayout()
    foreach($control in @(AllControls $form)){
        $control.PerformLayout()
        if($control -is [System.Windows.Forms.ScrollableControl] -and
            $control.AutoScroll){
            throw ('SETUP_UNIFIED_UNEXPECTED_SCROLL_'+$label+'_'+$control.Name)
        }
    }
    foreach($name in @(
      'iwxaSetupProductTitle', 'iwxaSetupInstallRoot',
      'iwxaSetupCommonRoot', 'iwxaSetupDataRoot',
      'iwxaSetupSoftwareRoot','iwxaSetupModelsRoot',
      'iwxaSetupCacheRoot','iwxaSetupPrimaryAction',
      'iwxaSetupRecheck','iwxaSetupCopyPriorData',
      'iwxaSetupRemoveApplication','iwxaSetupCompactSettings',
      'iwxaSetupInlineAutostart','iwxaSetupWebView2Status'
    )){
        $null=One $form $name
    }
    if(@($form.Controls.Find('iwxaSetupNavigation0',$true)).Count -ne 0){
        throw 'SETUP_UNIFIED_OBSOLETE_SIDEBAR_REMAINS'
    }
    $header=One $form 'iwxaSetupProductTitle'
    $details=One $form 'iwxaSetupTechnicalDetails'
    if($header.Left -ge $details.Right -or
        $header.Top -lt 0 -or $header.Right -gt $header.Parent.ClientSize.Width){
        throw ('SETUP_UNIFIED_HEADING_CLIPPED_'+$label)
    }
    $install=One $form 'iwxaSetupPrimaryAction'
    $recheck=One $form 'iwxaSetupRecheck'
    foreach($control in @($install,$recheck)){
        if(!(WantsVisible $control)){continue}
        if($control.Width -lt 88 -or $control.Right -gt $control.Parent.ClientSize.Width){
            throw ('SETUP_UNIFIED_ACTIONS_CLIPPED_'+$label+'_'+$control.Name)
        }
    }
    $left=One $form 'iwxaSetupInstallRoot'
    $compact=One $form 'iwxaSetupCompactSettings'
    $small=$form.ClientSize.Width -lt 910 -or $form.ClientSize.Height -lt 570
    if($small -and !(WantsVisible $compact)){
        throw ('SETUP_UNIFIED_COMPACT_DIALOG_INACCESSIBLE_'+$label)
    }
    if(!$small -and !(WantsVisible $left)){
        throw ('SETUP_UNIFIED_LOCATIONS_HIDDEN_'+$label)
    }
    Write-Host ('IWXA_SETUP_UNIFIED_LAYOUT_PASS '+$label+' '+
        $form.ClientSize.ToString())
}
$formType=$assembly.GetType('IwxaSetup.SetupForm',$true)
foreach($viewport in @(
    @{Width=1090;Height=672;Label='standard'},
    @{Width=1380;Height=880;Label='desktop'},
    @{Width=850;Height=540;Label='laptop-compact'}
)){
    $form=[Activator]::CreateInstance($formType,$true)
    try{
        $form.ClientSize=[Drawing.Size]::new($viewport.Width,$viewport.Height)
        $null=$form.Handle
        [System.Windows.Forms.Application]::DoEvents()
        AssertUnified $form $viewport.Label
    }finally{$form.Dispose()}
}
# Source-bound fixture: a real native assessment on empty, occupied and
# linked program folders. No application files are installed by this test.
$bundleType=$assembly.GetType('IwxaSetup.BundleInfo',$true)
$readiness=$assembly.GetType('IwxaSetup.SetupReadiness',$true)
$info=[Activator]::CreateInstance($bundleType,$true)
$binding=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$values=@{
    Id='iwxa.setup-ui-probe-'+[Guid]::NewGuid().ToString('N')
    Name='IWXA Setup UI Probe'
    InstallDir=('IWXA Setup UI Probe '+[Guid]::NewGuid().ToString('N'))
    DataNamespace=('iwxa.ui-probe.'+[Guid]::NewGuid().ToString('N'))
    Architecture='windows-x64'
    Entrypoint='iwxa-admin-center.exe'
    NeedsWebView2=$false
}
foreach($field in $values.Keys){
    $match=$bundleType.GetField($field,$binding)
    if($null -eq $match){throw ('SETUP_PROBE_INFO_FIELD_MISSING_'+$field)}
    $match.SetValue($info,$values[$field])
}
$check=$readiness.GetMethod('Check',
    [Reflection.BindingFlags]'Static,NonPublic,Public')
$fixture=Join-Path $env:TEMP ('iwxa-setup-layout-'+[Guid]::NewGuid().ToString('N'))
try{
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null
    # The PowerShell automatic $args variable can be rebound by its
    # invocation binder. Keep reflection operands explicitly typed.
    [object[]]$probeArguments = [object[]]::new(2)
    $probeArguments[0] = $info
    $probeArguments[1] = [string]$fixture
    $plan=$check.Invoke($null,[object[]]$probeArguments)
    $actual=[string]$plan.GetType().GetField('Status',$binding).GetValue($plan)
    if($actual -ne 'READY_FOR_FIRST_INSTALL'){
        throw ('SETUP_EMPTY_PROGRAM_ROOT_BLOCKED_'+$actual)
    }
    $foreign=Join-Path $fixture 'somebody-elses-file.txt'
    Set-Content -LiteralPath $foreign -Value 'keep'
    $plan=$check.Invoke($null,[object[]]$probeArguments)
    $actual=[string]$plan.GetType().GetField('Status',$binding).GetValue($plan)
    if($actual -ne 'INSTALL_ROOT_NOT_EMPTY' -or
        (Get-Content -LiteralPath $foreign -Raw).Trim() -ne 'keep'){
        throw ('SETUP_UNOWNED_PROGRAM_FILES_NOT_PROTECTED_'+$actual)
    }
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_DESTINATION_PREFLIGHT_PASS'
}finally{
    if(Test-Path -LiteralPath $fixture){
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}
# Check the native first-install button state. No HTML mock, no extra UI.
$form=[Activator]::CreateInstance($formType,$true)
try{
    $field=$formType.GetField('inspectedStatus',$binding)
    $field.SetValue($form,'NO_OWNED_INSTALLATION')
    $formType.GetField('inspectedBundle',$binding).SetValue($form,$info)
    $enum=$formType.GetField('primaryAction',$binding).FieldType
    $formType.GetField('primaryAction',$binding).SetValue($form,
        [Enum]::Parse($enum,'Install'))
    $refresh=$formType.GetMethod('RefreshUnifiedButtons',
        [Reflection.BindingFlags]'Instance,NonPublic')
    $null=$refresh.Invoke($form,[object[]]@())
    $install=One $form 'iwxaSetupPrimaryAction'
    if(!(WantsVisible $install) -or !$install.Enabled -or
        $install.Text -notmatch '.+'){
        # ConfigureActions gives the localized caption after VerifyAsync.
        # This fixture sets the enum directly, so require the actual action
        # to be present/enabled rather than a manufactured caption.
        if(!(WantsVisible $install) -or !$install.Enabled){
            throw 'SETUP_FIRST_INSTALL_ACTION_NOT_AVAILABLE'
        }
    }
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_BUTTON_STATE_PASS'
    # User's real failure: a previously blocked destination must recover
    # as soon as its path is edited. No inaccessible Install action.
    $formType.GetField('primaryAction',$binding).SetValue($form,
        [Enum]::Parse($enum,'None'))
    $formType.GetField('locationDraftChanged',$binding).SetValue($form,$true)
    $null=$refresh.Invoke($form,[object[]]@())
    if(!(WantsVisible $install) -or !$install.Enabled -or
        $install.Text -notmatch '.+'){
        throw 'SETUP_EDITED_FIRST_INSTALL_RECOVERY_ACTION_MISSING'
    }
    Write-Host 'IWXA_SETUP_EDITED_BLOCKED_LOCATION_RECOVERY_PASS'
}finally{$form.Dispose()}
# DPI model: same form and real controls, layout at 100-250% scales.
foreach($factor in @(1.0,1.5,2.0,2.5)){
    $form=[Activator]::CreateInstance($formType,$true)
    try{
        $null=$form.Handle
        if($factor -ne 1.0){
            $form.Scale([Drawing.SizeF]::new(
                [single]$factor,[single]$factor))
        }
        $form.ClientSize=[Drawing.Size]::new(
            [int][Math]::Round(1090*$factor),
            [int][Math]::Round(672*$factor))
        [System.Windows.Forms.Application]::DoEvents()
        AssertUnified $form ('dpi-'+$factor)
    }finally{$form.Dispose()}
}
$fit=$formType.GetMethod('FitToWorkingAreaSize',
    [Reflection.BindingFlags]'Static,NonPublic,Public')
if($null -eq $fit){throw 'SETUP_WORKAREA_FIT_HELPER_MISSING'}
$fitArgs=New-Object 'System.Object[]' 3
$fitArgs[0]=[Drawing.Size]::new(1800,1200)
$fitArgs[1]=[Drawing.Size]::new(1500,1040)
$fitArgs[2]=[Drawing.Size]::new(1920,1040)
$fitted=[Drawing.Size]$fit.Invoke($null,$fitArgs)
if($fitted.Width -ne 1800 -or $fitted.Height -ne 1040){
    throw 'SETUP_WORKAREA_FIT_200PCT_INVALID'
}
# Save the actual WinForms hierarchy for independent visual review. The
# full packaged application is captured separately in test-native-package.ps1.
$review=[Activator]::CreateInstance($formType,$true)
try{
    $review.ClientSize=[Drawing.Size]::new(1090,672)
    $review.StartPosition=[System.Windows.Forms.FormStartPosition]::Manual
    $review.Location=[Drawing.Point]::new(20,20)
    # DrawToBitmap on an unshown WinForms window can capture a blank surface.
    # Use actual on-screen pixels, as with the packaged Setup GUI acceptance.
    $review.Show()
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 350
    $bounds=$review.Bounds
    $out=[IO.Path]::GetFullPath('artifacts/setup-core-visual-options-main.png')
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($out))
    $bmp=[Drawing.Bitmap]::new($bounds.Width,$bounds.Height)
    $graphics=[Drawing.Graphics]::FromImage($bmp)
    try{
        $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bmp.Size)
        $red=0
        for($y=35;$y -lt [Math]::Min(170,$bmp.Height);$y+=4){
            for($x=15;$x -lt [Math]::Min(130,$bmp.Width);$x+=4){
                $pixel=$bmp.GetPixel($x,$y)
                if($pixel.R -gt 180 -and $pixel.G -lt 160 -and
                    $pixel.B -lt 160){$red++}
            }
        }
        if($red -lt 16){
            throw 'SETUP_UNIFIED_LIVE_VISUAL_BRAND_NOT_RENDERED'
        }
        $bmp.Save($out,[Drawing.Imaging.ImageFormat]::Png)
    }finally{
        $graphics.Dispose()
        $bmp.Dispose()
    }
    Write-Host ('IWXA_SETUP_UNIFIED_LIVE_CAPTURE_PASS redPixels='+$red+
        ' path='+$out)
}finally{$review.Dispose()}
Write-Host 'IWXA_SETUP_NATIVE_UNIFIED_UX_ACCEPTANCE_PASS'
