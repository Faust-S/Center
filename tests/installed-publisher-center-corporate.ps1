# Local, dedicated Windows test profile ONLY. No private source checkout or
# signing in the test harness. All mutations are made in the installed GUI;
# the exact original T3 components are called independently for READBACK.
# Supply an already provisioned disposable corporate Owner whose issuer
# supports WORKSPACE, PERSONAL_AGENT_CORPORATE, 2 Center seats, 10 employees,
# 2 Agent seats, a 30-day license and at least a 15-minute STATUS interval.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PublisherExe,
  [Parameter(Mandatory=$true)][string]$AdminCenterExe,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedPublisherSha256,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedCenterSha256,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedOwnerSha256,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedConsumerSha256,
  [Parameter(Mandatory=$true)][string]$IssuerAuthorityId,
  [Parameter(Mandatory=$true)][switch]$DedicatedTestProfile,
  [switch]$QualifySeatProjection,
  [switch]$ResumeQualifiedCenterCI,
  [switch]$PrepareLicensedEmployee
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(!$IsWindows -or !$DedicatedTestProfile){
  throw 'CORPORATE_INSTALLED_LOCAL_DEDICATED_WINDOWS_REQUIRED'
}
if($ResumeQualifiedCenterCI){
  if($env:GITHUB_ACTIONS -cne 'true' -or $env:GITHUB_REPOSITORY -cne 'Faust-S/Center' -or
     $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
     $env:GITHUB_REF -cne 'refs/heads/work/2026-11-24-corporate-installed-one-core' -or
     $env:IWXA_T3_SYNTHETIC_PROVISION -cne 'CORPORATE_CENTER_CI_FIXTURE_ONLY' -or !$QualifySeatProjection){
    throw 'CORPORATE_INSTALLED_DISPOSABLE_CENTER_CI_REQUIRED'
  }
}elseif($env:GITHUB_ACTIONS -eq 'true'){
  throw 'CORPORATE_INSTALLED_LOCAL_DEDICATED_WINDOWS_REQUIRED'
}
if([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA'){
  throw 'CORPORATE_INSTALLED_START_PWSH_WITH_STA'
}
# This is a separate prefix witness, never a successful full lifecycle.
# Preserve two already signed public transfer files only on the same disposable
# Center CI runner. The ordinary local/full witness is unchanged.
$employeeHandoff=$null
$employeeHandoffReady=$false
if($PrepareLicensedEmployee){
  if(!$ResumeQualifiedCenterCI -or !$env:RUNNER_TEMP -or ![IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)){
    throw 'CORPORATE_INSTALLED_EMPLOYEE_PREPARATION_DISPOSABLE_REQUIRED'
  }
  $employeeHandoff=Join-Path $env:RUNNER_TEMP 'iwxa-licensed-employee-handoff'
  if(Test-Path -LiteralPath $employeeHandoff){throw 'CORPORATE_INSTALLED_EMPLOYEE_HANDOFF_NOT_FRESH'}
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CorporateQualificationGui {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
}
'@
$publisherPath=[IO.Path]::GetFullPath($PublisherExe)
$centerPath=[IO.Path]::GetFullPath($AdminCenterExe)
$ownerPath=Join-Path (Split-Path $publisherPath -Parent) 't3/iwxa-t3-product-owner.exe'
$consumerPath=Join-Path (Split-Path $centerPath -Parent) 't3/iwxa-t3-product-consumer.exe'
function Digest([string]$path){
  if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw 'CORPORATE_INSTALLED_BINARY_MISSING'}
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}
foreach($pin in @(
  @{path=$publisherPath;sha=$ExpectedPublisherSha256},
  @{path=$centerPath;sha=$ExpectedCenterSha256},
  @{path=$ownerPath;sha=$ExpectedOwnerSha256},
  @{path=$consumerPath;sha=$ExpectedConsumerSha256}
)){
  if((Digest $pin.path) -ine $pin.sha){throw 'CORPORATE_INSTALLED_BINARY_PIN_MISMATCH'}
}
foreach($name in @('iwxa-publisher','iwxa-admin-center')){
  if(Get-Process -Name $name -ErrorAction SilentlyContinue){throw 'CORPORATE_INSTALLED_CLOSE_EXISTING_APPS'}
}
function Setup-Data([string]$product){
  $key='HKCU:\Software\IWXA\SetupCore\Products\'+$product
  if(!(Test-Path -LiteralPath $key)){throw 'CORPORATE_INSTALLED_SETUPCORE_REGISTRATION_REQUIRED'}
  $value=[string](Get-ItemProperty -LiteralPath $key -Name DataLocation).DataLocation
  if(![IO.Path]::IsPathFullyQualified($value)){throw 'CORPORATE_INSTALLED_DATA_ROOT_INVALID'}
  return [IO.Path]::GetFullPath($value)
}
$publisherData=Setup-Data 'iwxa.publisher'
$centerData=Setup-Data 'iwxa.admin-center'
if($publisherData -ieq $centerData){throw 'CORPORATE_INSTALLED_PRODUCT_ROOT_COLLISION'}
# Original native roles: corporate owner shares PERSON production root.
# Center 0.4.1 uses Setup Core DataLocation directly, NOT atlas-store-v1.
$ownerRoot=Join-Path $publisherData 't3-owner-person'
$consumerRoot=Join-Path $centerData 't3-consumer-test'
$centerDraft=Join-Path $centerData 'atlas-store-v1/preparation/draft.json'
$publisherDraft=Join-Path $publisherData 'publisher-preparation-v1.json'
if((Test-Path -LiteralPath $publisherDraft) -or
   (Test-Path -LiteralPath (Join-Path $consumerRoot 'corporate'))){
  throw 'CORPORATE_INSTALLED_FRESH_DEDICATED_PROFILE_REQUIRED'
}
if($ResumeQualifiedCenterCI){
  if($publisherData -ine [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ru.iwxa.publisher')) -or
     $centerData -ine [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center'))){
    throw 'CORPORATE_INSTALLED_DISPOSABLE_SETUP_ROOT_REQUIRED'
  }
  $prior=Get-Content -LiteralPath $centerDraft -Raw|ConvertFrom-Json -Depth 80
  $orgs=@($prior.organizations)
  if($prior.format -cne 'iwxa.admin-center.draft' -or $prior.version -ne 1 -or
     $orgs.Count -ne 1 -or $orgs[0].id -cne $prior.activeOrganizationId -or
     $orgs[0].kind -cne 'ORGANIZATION' -or $orgs[0].name -cne 'G4WindowsOrganization'){
    throw 'CORPORATE_INSTALLED_QUALIFIED_CENTER_DRAFT_REQUIRED'
  }
}elseif(Test-Path -LiteralPath $centerDraft){
  throw 'CORPORATE_INSTALLED_FRESH_DEDICATED_PROFILE_REQUIRED'
}
$artifact=Join-Path ([IO.Path]::GetTempPath()) ('iwxa-corporate-witness-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($artifact)
$trustFile=Join-Path $artifact 'publisher-corporate-trust.json'
$activeFile=Join-Path $artifact 'active.iwxa'
$renewedFile=Join-Path $artifact 'renewed.iwxa'
$renewedRevokedFile=Join-Path $artifact 'renewed-revoked.iwxa'
$reexportFile=Join-Path $artifact 'active-reexport.iwxa'
$suspendedFile=Join-Path $artifact 'suspended.iwxa'
$revokedFile=Join-Path $artifact 'revoked.iwxa'
$tamperedFile=Join-Path $artifact 'tampered.iwxa'
$checks=[System.Collections.Generic.List[string]]::new()
function Record-Check([string]$name){
  if($name -cnotmatch '^[A-Z0-9_]{3,100}$'){throw 'CORPORATE_INSTALLED_CHECK_NAME_INVALID'}
  $checks.Add($name)
  if($ResumeQualifiedCenterCI){Write-Host ('CORPORATE_TWO_INSTALLED_CHECK='+$name)}
}
$pub=$null
$cen=$null
$script:guiPhase='START'
$script:guiOrdinal=0
$script:guiLastKind='NONE'
function Phase([string]$value){
  if($value -cnotmatch '^[A-Z0-9_]{3,80}$'){throw 'CORPORATE_GUI_PHASE_INVALID'}
  $script:guiPhase=$value
  $script:guiOrdinal=0
  $script:guiLastKind='NONE'
  if($ResumeQualifiedCenterCI){Write-Host ('CORPORATE_TWO_INSTALLED_PHASE='+$value)}
}
function Gui-Step([string]$kind){
  if($kind -cnotin @('BUTTON','EDIT','COMBO','CHECKBOX','COPY','FILE_DIALOG','WAIT_TEXT','NATIVE_CONFIRM')){throw 'CORPORATE_GUI_STEP_INVALID'}
  $script:guiOrdinal++
  $script:guiLastKind=$kind
}
# Read-only direct process calls, independent of the WebView or its cache.
function Read-Native([string]$exe,[string[]]$arguments){
  $info=[Diagnostics.ProcessStartInfo]::new()
  $info.FileName=$exe
  $info.UseShellExecute=$false
  $info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true
  $info.RedirectStandardError=$true
  foreach($arg in $arguments){$info.ArgumentList.Add($arg)}
  $process=[Diagnostics.Process]::Start($info)
  try{
    $out=$process.StandardOutput.ReadToEndAsync()
    $err=$process.StandardError.ReadToEndAsync()
    if(!$process.WaitForExit(90000)){$process.Kill();throw 'CORPORATE_NATIVE_READ_TIMEOUT'}
    $raw=$out.GetAwaiter().GetResult()
    $null=$err.GetAwaiter().GetResult()
    if($process.ExitCode -ne 0 -or $raw.Length -gt 262144){
      throw ('CORPORATE_NATIVE_READ_FAILED '+$arguments[0])
    }
    $r=$raw|ConvertFrom-Json -Depth 60
    if($r.productionActivation -ne $false -or $r.activeSeats -ne 0){
      throw 'CORPORATE_NATIVE_READ_UNEXPECTED_ACTIVATION'
    }
    return $r
  }finally{$process.Dispose()}
}
function Owner-Read([string]$id){
  $r=Read-Native $ownerPath @('corporate-signed-readback',$ownerRoot,$id)
  if($r.operation -ne 'CORPORATE_SIGNED_READBACK' -or $r.licenseId -cne $id -or
     $r.source -ne 'ORIGINAL_T3_PRODUCT_ISSUE_LEDGER' -or $r.licenseSignatureVerifiedAtIssuance -ne $true){
    throw 'CORPORATE_NATIVE_OWNER_READBACK_INVALID'
  }
  return $r
}
function Consumer-Read([string]$org){
  $r=Read-Native $consumerPath @('corporate-read',$consumerRoot,$org)
  if($r.operation -ne 'CORPORATE_READ' -or $r.view.organizationId -cne $org -or
     $r.view.trustOrigin -ne 'HOST_PREINSTALLED_PUBLIC_POLICY' -or
     $r.assignablePersonalAgentSeats -ne 0 -or $r.view.assignablePersonalAgentSeats -ne 0){
    throw 'CORPORATE_NATIVE_CONSUMER_READBACK_INVALID'
  }
  return $r.view
}
function Wait-Preparation([string]$path,[scriptblock]$predicate){
  for($i=0;$i -lt 80;$i++){
    if(Test-Path -LiteralPath $path -PathType Leaf){
      try{
        $value=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json -Depth 80
        if(& $predicate $value){return $value}
      }catch{}
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'CORPORATE_INSTALLED_PREPARATION_NOT_SAVED'
}

function Start-App([string]$file,[string]$workingDirectory='') {
  if(!$workingDirectory){$workingDirectory=Split-Path $file -Parent}
  $process=Start-Process -FilePath $file -WorkingDirectory $workingDirectory -PassThru
  for($attempt=0;$attempt -lt 100;$attempt++){
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    if($process.HasExited){throw "CORPORATE_GUI_GUI_PROCESS_EXITED_EARLY $file"}
    if($process.MainWindowHandle -ne [IntPtr]::Zero){return $process}
  }
  throw "CORPORATE_GUI_GUI_MAIN_WINDOW_NOT_SHOWN $file"
}
function Window($process) {
  $process.Refresh()
  if($process.HasExited){throw 'CORPORATE_GUI_GUI_WINDOW_LOST'}
  if($process.MainWindowHandle -ne [IntPtr]::Zero){
    try{return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)}catch{}
  }
  # Recover the original native window by process identity, as the ordinary
  # installed Publisher witness does after a native dialog.
  $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  $match=@()
  foreach($candidate in $windows){
    try{
      if($candidate.Current.ProcessId -eq $process.Id -and
         $candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
         $candidate.Current.Name -cmatch '^IWXA (?:Publisher|Admin Center|Personal)(?:$|\s)'){
        $match+=,$candidate
      }
    }catch{}
  }
  if($match.Count -eq 1){return $match[0]}
  throw 'CORPORATE_GUI_GUI_WINDOW_LOST'
}
function Control($process,[string]$name,[string]$kind='Button',[int]$attempts=120) {
  $expected=switch($kind){
    'Edit' {[System.Windows.Automation.ControlType]::Edit}
    'ComboBox' {[System.Windows.Automation.ControlType]::ComboBox}
    'CheckBox' {[System.Windows.Automation.ControlType]::CheckBox}
    default {[System.Windows.Automation.ControlType]::Button}
  }
  $condition=[System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::NameProperty,$name)
  for($i=0;$i -lt $attempts;$i++){
    $items=(Window $process).FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,$condition)
    $exact=@()
    foreach($item in $items){
      try {
        if($item.Current.ControlType -eq $expected){$exact+=,$item;continue}
        # HTML number fields may be exposed as UIA Spinner by WebView2.
        # The exact accessible name and editable ValuePattern are required.
        if($kind -ceq 'Edit' -and $item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Spinner){
          $value=$null
          if($item.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value) -and !$value.Current.IsReadOnly){
            $exact+=,$item
          }else{
            $edits=$item.FindAll([System.Windows.Automation.TreeScope]::Descendants,
              [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Edit))
            if($edits.Count -eq 1){$exact+=,$edits[0]}
          }
        }
      }catch{}
    }
    if($exact.Count -eq 1){return $exact[0]}
    if($exact.Count -gt 1){
      # Navigation can also appear in the right-side context dock. Prefer the
      # actual on-screen, enabled control, not a hidden or stale duplicate.
      $visible=@($exact|Where-Object {!$_.Current.IsOffscreen -and $_.Current.IsEnabled})
      if($visible.Count -eq 1){return $visible[0]}
      # Do not guess which of two different edit controls to mutate.
      if($kind -cne 'Button'){throw 'CORPORATE_GUI_UI_CONTROL_AMBIGUOUS'}
      if($visible.Count -gt 0){return $visible[0]}
      return $exact[0]
    }
    Start-Sleep -Milliseconds 250
  }
  if($process.ProcessName -ceq 'iwxa-publisher'){
    if(Has-Text $process 'Загрузка интерфейса'){throw 'CORPORATE_GUI_PUBLISHER_RENDERER_NOT_READY'}
    if(Has-Text $process 'Не удалось открыть интерфейс Publisher'){throw 'CORPORATE_GUI_PUBLISHER_RENDERER_FAILED'}
    if(Has-Text $process 'Не удалось открыть сохранённые черновики'){throw 'CORPORATE_GUI_PUBLISHER_DRAFT_LOAD_FAILED'}
  }
  throw "CORPORATE_GUI_UI_CONTROL_MISSING $kind $name"
}
function Press($process,[string]$name,[bool]$physical=$false){
  Gui-Step 'BUTTON'
  Focus-App $process
  $element=Control $process $name
  for($retry=0;$retry -lt 60 -and !$element.Current.IsEnabled;$retry++){
    Start-Sleep -Milliseconds 200
    $element=Control $process $name
  }
  if(!$element.Current.IsEnabled){throw "CORPORATE_GUI_GUI_BUTTON_DISABLED $name"}
  if($element.Current.IsOffscreen){
    try{$element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()}
    catch{}
    Start-Sleep -Milliseconds 150
  }
  if(!$physical){
    try{
      $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 250
      return
    }catch{}
  }
  $b=$element.Current.BoundingRectangle
  if($b.IsEmpty -or $b.Width -lt 20 -or $b.Height -lt 12){
    throw "CORPORATE_GUI_GUI_BUTTON_NOT_VISIBLE $name"
  }
  [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
    [int]($b.Left+$b.Width/2),[int]($b.Top+$b.Height/2))
  [CorporateQualificationGui]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [CorporateQualificationGui]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 270
}
function Focus-App($process){
  $process.Refresh()
  if($process.HasExited -or $process.MainWindowHandle -eq [IntPtr]::Zero){throw 'CORPORATE_GUI_WINDOW_LOST'}
  [void][CorporateQualificationGui]::SetForegroundWindow($process.MainWindowHandle)
  Start-Sleep -Milliseconds 180
  if([CorporateQualificationGui]::GetForegroundWindow() -ne $process.MainWindowHandle){
    throw 'CORPORATE_GUI_FOREGROUND_NOT_CONFIRMED'
  }
}
function Enter($process,[string]$name,[string]$value){
  Gui-Step 'EDIT'
  # Navigation starts a real asynchronous original-owner read. The exact
  # React-controlled input may be present but disabled until it finishes.
  # Wait for the editable control, then do one ordinary keyboard input.
  $element=$null
  for($attempt=0;$attempt -lt 120;$attempt++){
    $current=Control $process $name 'Edit'
    $pattern=$null
    try{
      if($current.Current.IsEnabled -and
         $current.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern) -and
         !$pattern.Current.IsReadOnly){
        $element=$current
        break
      }
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  if($null -eq $element){throw 'CORPORATE_GUI_EDIT_NOT_READY'}
  Focus-App $process
  $element=Control $process $name 'Edit'
  if(!$element.Current.IsEnabled){throw 'CORPORATE_GUI_EDIT_DISABLED_AFTER_NAVIGATION'}
  $element.SetFocus()
  $focused=$false
  for($attempt=0;$attempt -lt 20;$attempt++){
    try{
      if($element.Current.HasKeyboardFocus){
        $focused=$true
        break
      }
      # WebView may expose a number field as Spinner with focused Edit child.
      $active=[System.Windows.Automation.AutomationElement]::FocusedElement
      if($active -and $active.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit){
        $parent=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($active)
        if($parent -and $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Spinner -and
          [System.Windows.Automation.Automation]::Compare($parent,$element)){
          $focused=$true
          break
        }
      }
    }catch{}
    Start-Sleep -Milliseconds 100
  }
  if(!$focused){throw 'CORPORATE_GUI_EDIT_FOCUS_NOT_CONFIRMED'}
  [System.Windows.Forms.Clipboard]::SetText($value)
  try{
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    # Read-only observation, never repeat the keyboard write after a mismatch.
    for($attempt=0;$attempt -lt 20;$attempt++){
      $observed=Read-Edit $process $name
      if($observed -ceq $value -or ($observed -replace "`r`n","`n") -ceq ($value -replace "`r`n","`n")){
        return
      }
      Start-Sleep -Milliseconds 100
    }
    throw 'CORPORATE_GUI_EDIT_READBACK_MISMATCH'
  }finally{[System.Windows.Forms.Clipboard]::Clear()}
}
function Read-Edit($process,[string]$name){
  $element=Control $process $name 'Edit'
  $pattern=$null
  if(!$element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
    throw 'CORPORATE_GUI_EDIT_VALUE_PATTERN_REQUIRED'
  }
  return ([System.Windows.Automation.ValuePattern]$pattern).Current.Value
}
# Exercise the user-visible Copy action. If WebView refuses direct clipboard
# access, the UI explicitly selects the value and offers Ctrl+C.
function Copy-FromGui($process,[string]$button,[string]$field){
  Gui-Step 'COPY'
  Focus-App $process
  $expected=Read-Edit $process $field
  if([string]::IsNullOrEmpty($expected)){throw 'CORPORATE_GUI_COPY_SOURCE_EMPTY'}
  [System.Windows.Forms.Clipboard]::Clear()
  Press $process $button
  for($i=0;$i -lt 15;$i++){
    if([System.Windows.Forms.Clipboard]::GetText() -ceq $expected){return $expected}
    Start-Sleep -Milliseconds 100
  }
  # Do not synthesize the clipboard value. Copy the visible readonly field
  # using the same documented keyboard fallback as an interactive user.
  $element=Control $process $field 'Edit'
  $element.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^c')
  Start-Sleep -Milliseconds 200
  if([System.Windows.Forms.Clipboard]::GetText() -cne $expected){
    throw 'CORPORATE_GUI_COPY_FALLBACK_NOT_EXACT'
  }
  return $expected
}
function Read-ConfirmationState($process,[string]$name){
  # React-controlled checkboxes and WebView2 providers may be recreated
  # after an asynchronous event. Never use a previously acquired pattern
  # for the verification of a subsequent transition.
  $element=Control $process $name 'CheckBox' 4
  $pattern=$null
  if(!$element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)){
    throw 'CORPORATE_GUI_CONFIRMATION_TOGGLE_PATTERN_REQUIRED'
  }
  return [pscustomobject]@{
    Element=$element
    Pattern=$pattern
    State=$pattern.Current.ToggleState
    Enabled=$element.Current.IsEnabled
  }
}
function Wait-ConfirmationReady($process,[string]$name,[string]$submit,[bool]$wanted){
  $expected=if($wanted){[System.Windows.Automation.ToggleState]::On}else{[System.Windows.Automation.ToggleState]::Off}
  $stable=0
  for($i=0;$i -lt 50;$i++){
    $observed=$false
    try{
      $fresh=Read-ConfirmationState $process $name
      $button=Control $process $submit 'Button' 4
      $observed=$fresh.Enabled -and $fresh.State -eq $expected -and $button.Current.IsEnabled -eq $wanted
    }catch{}
    if($observed){
      $stable++
      if($stable -ge 3){return $true}
    }else{$stable=0}
    Start-Sleep -Milliseconds 180
  }
  return $false
}
function Confirm-Checkbox($process,[string]$name,[string]$submit){
  Gui-Step 'CHECKBOX'
  Focus-App $process
  # Prove that the exact human-confirmation gate is initially closed.
  # Do not accidentally issue a signature from a stale checked review.
  if(!(Wait-ConfirmationReady $process $name $submit $false)){
    throw 'CORPORATE_GUI_CONFIRMATION_INITIAL_GATE_NOT_CLOSED'
  }
  $fresh=Read-ConfirmationState $process $name
  if($fresh.State -ne [System.Windows.Automation.ToggleState]::Off -or !$fresh.Enabled){
    throw 'CORPORATE_GUI_CONFIRMATION_CHANGED_BEFORE_INPUT'
  }
  # A keyboard Space on the named, focused, native accessibility element
  # follows the real HTML input path. TogglePattern.Invoke can return
  # before the controlled React checkbox has acknowledged the event.
  $fresh.Element.SetFocus()
  Start-Sleep -Milliseconds 150
  $focus=[System.Windows.Automation.AutomationElement]::FocusedElement
  if(!$focus -or ![System.Windows.Automation.Automation]::Compare($focus,$fresh.Element) -or
     [CorporateQualificationGui]::GetForegroundWindow() -ne $process.MainWindowHandle){
    throw 'CORPORATE_GUI_CONFIRMATION_FOCUS_NOT_CONFIRMED'
  }
  [System.Windows.Forms.SendKeys]::SendWait(' ')
  if(Wait-ConfirmationReady $process $name $submit $true){return}
  # Do not retry the mutation: a delayed UI event could reverse an already
  # accepted checkbox. A fresh On state and the actual enabled signature
  # button must agree, otherwise leave the irreversible command untouched.
  throw 'CORPORATE_GUI_CONFIRMATION_GATE_NOT_OPEN'
}
function Select-Last($process,[string]$name){
  Gui-Step 'COMBO'
  Focus-App $process
  $element=Control $process $name 'ComboBox'
  $element.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{END}')
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 160
}
function Select-FirstReal($process,[string]$name){
  Gui-Step 'COMBO'
  Focus-App $process
  $element=Control $process $name 'ComboBox'
  $element.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
  [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 160
}
# Fixed fixture option positions are used only after explicit readiness;
# subsequent ordinary UI readback must prove the exact selected value.
# TAB commits a closed WebView2 select without pressing a neighboring submit.
function Select-ComboIndex($process,[string]$name,[int]$index){
  Gui-Step 'COMBO'
  Focus-App $process
  if($index -lt 1 -or $index -gt 10){throw 'CORPORATE_GUI_COMBO_INDEX_INVALID'}
  $element=$null
  for($attempt=0;$attempt -lt 80;$attempt++){
    $candidate=Control $process $name 'ComboBox'
    if($candidate.Current.IsEnabled){$element=$candidate;break}
    Start-Sleep -Milliseconds 200
  }
  if($null -eq $element){throw 'CORPORATE_GUI_COMBO_NOT_READY'}
  $element.SetFocus()
  Start-Sleep -Milliseconds 120
  $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
  if(!$focused -or ![System.Windows.Automation.Automation]::Compare($focused,$element)){
    throw 'CORPORATE_GUI_COMBO_FOCUS_NOT_CONFIRMED'
  }
  [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
  for($i=0;$i -lt $index;$i++){
    [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
    Start-Sleep -Milliseconds 120
  }
  [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  Start-Sleep -Milliseconds 220
}
function Wait-Text($process,[string]$contains,[int]$attempts=70){
  Gui-Step 'WAIT_TEXT'
  for($i=0;$i -lt $attempts;$i++){
    $all=(Window $process).FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($entry in $all){
      try {
        if($entry.Current.Name.Contains($contains)){return}
      }catch{}
    }
    Start-Sleep -Milliseconds 250
  }
  throw "CORPORATE_GUI_GUI_CONFIRMATION_NOT_FOUND $contains"
}
# Optional cross-product installed seat projection. The existing local-only
# gate remains mandatory. All writes use the normal human-confirmed GUI.
function Has-Text($process,[string]$contains,[bool]$exact=$false){
  $all=(Window $process).FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  foreach($entry in $all){
    try{
      $name=([string]$entry.Current.Name).Trim()
      if(($exact -and $name -ceq $contains) -or (!$exact -and $name.Contains($contains))){return $true}
    }catch{}
  }
  return $false
}
function Original-Confirm($process,[string]$title){
  Gui-Step 'NATIVE_CONFIRM'
  for($i=0;$i -lt 100;$i++){
    $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    $matching=@()
    foreach($window in $windows){
      try{
        if($window.Current.ProcessId -eq $process.Id -and
           $window.Current.Name -ceq $title -and
           $window.Current.NativeWindowHandle -ne $process.MainWindowHandle){
          $matching+=,$window
        }
      }catch{}
    }
    if($matching.Count -gt 1){throw 'CORPORATE_SEAT_NATIVE_DIALOG_AMBIGUOUS'}
    if($matching.Count -eq 1){
      $dialog=[IntPtr]$matching[0].Current.NativeWindowHandle
      [void][CorporateQualificationGui]::SetForegroundWindow($dialog)
      Start-Sleep -Milliseconds 180
      if([CorporateQualificationGui]::GetForegroundWindow() -ne $dialog){
        throw 'CORPORATE_SEAT_NATIVE_DIALOG_NOT_FOREGROUND'
      }
      # Exact rfd YesNo TaskDialog, button IDYES=6.
      $button=[CorporateQualificationGui]::GetDlgItem($dialog,6)
      $rect=[CorporateQualificationGui+Rect]::new()
      if($button -eq [IntPtr]::Zero -or
         ![CorporateQualificationGui]::GetWindowRect($button,[ref]$rect) -or
         ($rect.Right-$rect.Left) -lt 4 -or ($rect.Bottom-$rect.Top) -lt 4){
        throw 'CORPORATE_SEAT_NATIVE_DIALOG_BUTTON_INVALID'
      }
      [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
        [int][Math]::Round(($rect.Left+$rect.Right)/2),
        [int][Math]::Round(($rect.Top+$rect.Bottom)/2))
      [CorporateQualificationGui]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 80
      [CorporateQualificationGui]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      for($j=0;$j -lt 80;$j++){
        if(![CorporateQualificationGui]::IsWindow($dialog)){return}
        Start-Sleep -Milliseconds 150
      }
      throw 'CORPORATE_SEAT_NATIVE_DIALOG_NOT_DISMISSED'
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'CORPORATE_SEAT_NATIVE_DIALOG_NOT_FOUND'
}
function Wait-ExactText($process,[string]$value,[int]$attempts=240){
  for($i=0;$i -lt $attempts;$i++){
    if(Has-Text $process $value $true){return}
    Start-Sleep -Milliseconds 250
  }
  throw 'CORPORATE_SEAT_EXACT_CAPACITY_READBACK_NOT_OBSERVED'
}
function Center-SeatProjection([bool]$first,[int]$seatLimit,[int]$employeeLimit){
  if($seatLimit -ge 0){
    Press $cen 'Перейти к распределению мест' $true
  }else{
    Press $cen 'Управление корпоративными местами' $true
  }
  if($first){
    Press $cen 'Подключить организацию' $true
    Original-Confirm $cen 'IWXA T3: подключить организацию'
  }
  Wait-Text $cen 'Подписанный T3 D3 получатель доступен' 360
  Press $cen 'Открыть Workspace T3' $true
  Wait-Text $cen 'К приёмке' 160
  Wait-Text $cen 'Рабочие данные находятся в локальном пространстве домена' 240
  Press $cen 'К приёмке' $true
  if($first){
    Wait-Text $cen 'Исходный реестр сотрудников ещё не создан' 240
    Press $cen 'Подключить исходный реестр T3' $true
    Original-Confirm $cen 'IWXA T3: исходный корпоративный реестр'
  }
  Wait-Text $cen 'Зарезервированные места / лимит' 240
  if(($first -or $ResumeQualifiedCenterCI) -and $seatLimit -ge 0 -and
     (Has-Text $cen 'Подключить распределение мест' $true)){
    Press $cen 'Подключить распределение мест' $true
    Original-Confirm $cen 'IWXA T3: распределение корпоративных мест'
    Wait-Text $cen 'Продуктовая политика подтверждена исходным T3.' 240
  }
  # Exact accessible metric groups from the real Center seat view. No
  # similarly named draft metric or copied license data counts as evidence.
  if($seatLimit -ge 0){
    Wait-Text $cen 'Подписанная лицензия актуальна' 240
    Wait-ExactText $cen ('Зарезервированные места: 0 / '+$seatLimit)
    Wait-ExactText $cen ('Зарегистрированные сотрудники: 0 / '+$employeeLimit)
    Wait-ExactText $cen ('Свободно для назначения: '+$seatLimit)
  }else{
    Wait-Text $cen 'Нет действующей лицензии' 240
    Wait-ExactText $cen 'Зарезервированные места: 0 / —'
    Wait-ExactText $cen 'Свободно для назначения: 0'
    if(Has-Text $cen 'Подписанная лицензия актуальна'){
      throw 'CORPORATE_SEAT_STALE_LICENSE_VISIBLE'
    }
  }
  Wait-Text $cen 'Назначений нет.' 240
  # Receiving a license does not enroll an employee or assign a seat.
  Press $cen 'Personal Agent и лицензии' $true
}
function Picker-Foreground([IntPtr]$handle){
  if(![CorporateQualificationGui]::IsWindow($handle)){
    throw 'CORPORATE_GUI_NATIVE_PICKER_CLOSED_BEFORE_CONFIRMATION'
  }
  for($attempt=0;$attempt -lt 8;$attempt++){
    [void][CorporateQualificationGui]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 150
    if([CorporateQualificationGui]::GetForegroundWindow() -eq $handle){return}
  }
  throw 'CORPORATE_GUI_NATIVE_PICKER_FOREGROUND_NOT_CONFIRMED'
}

function Native-FileDialog($process,[string]$button,[string]$file,[bool]$exists){
  Gui-Step 'FILE_DIALOG'
  if((Test-Path -LiteralPath $file -PathType Leaf) -ne $exists){
    throw "CORPORATE_GUI_DIALOG_PRECONDITION_FAILED $button"
  }
  # These are the native rfd titles from the original installed Rust commands.
  # Never select the first additional window of the process: WebView2 and
  # asynchronous native dialog creation can expose unrelated/unfinished windows.
  $title=switch -CaseSensitive ($button){
    'Экспортировать публичное доверие для независимого Admin Center' {'Publisher: публичное доверие корпоративного издателя'}
    'Экспортировать подписанный .iwxa через исходный T3' {'Publisher: корпоративная лицензия IWXA Admin Center'}
    'Установить доверие корпоративного издателя' {'Admin Center - выбрать публичное доверие корпоративного издателя'}
    'Получить подписанную корпоративную лицензию через T3' {'Admin Center - получить подписанный корпоративный .iwxa через T3'}
    'Сохранить персональное приглашение .iwxa' {'Сохранить приглашение сотрудника T3'}
    'Сохранить подписанную Task .iwxa' {'Сохранить Task независимому сотруднику T3'}
    default {throw 'CORPORATE_GUI_NATIVE_PICKER_UNKNOWN_ROUTE'}
  }
  $process.Refresh()
  $mainHandle=$process.MainWindowHandle
  if($mainHandle -eq [IntPtr]::Zero){throw 'CORPORATE_GUI_GUI_WINDOW_LOST'}
  Press $process $button
  $script:guiLastKind='FILE_DIALOG'
  $dialogHandle=[IntPtr]::Zero
  for($i=0;$i -lt 150;$i++){
    $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    $matches=@()
    foreach($window in $windows){
      try{
        $handle=[IntPtr]$window.Current.NativeWindowHandle
        if($window.Current.ProcessId -eq $process.Id -and
           $window.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
           $window.Current.Name -ceq $title -and
           $handle -ne [IntPtr]::Zero -and $handle -ne $mainHandle -and
           [CorporateQualificationGui]::IsWindow($handle)){
          $matches+=,$handle
        }
      }catch{}
    }
    $matches=@($matches|Select-Object -Unique)
    if($matches.Count -gt 1){throw 'CORPORATE_GUI_NATIVE_PICKER_AMBIGUOUS'}
    if($matches.Count -eq 1){$dialogHandle=$matches[0];break}
    Start-Sleep -Milliseconds 200
  }
  if($dialogHandle -eq [IntPtr]::Zero){
    throw 'CORPORATE_GUI_NATIVE_PICKER_EXACT_WINDOW_NOT_FOUND'
  }
  Picker-Foreground $dialogHandle
  $entered=$false
  $idCondition=[System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1148')
  $editCondition=[System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit)
  # Wait for the filename control and re-resolve the exact dialog each time.
  # Some Win32 implementations expose the editable child rather than 1148
  # itself, or omit this automation ID entirely.
  for($attempt=0;$attempt -lt 25 -and !$entered;$attempt++){
    if(![CorporateQualificationGui]::IsWindow($dialogHandle)){
      throw 'CORPORATE_GUI_NATIVE_PICKER_CLOSED_BEFORE_CONFIRMATION'
    }
    try{
      $dialog=[System.Windows.Automation.AutomationElement]::FromHandle($dialogHandle)
      $container=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$idCondition)
      if(!$container){
        $nativeField=[CorporateQualificationGui]::GetDlgItem($dialogHandle,1148)
        if($nativeField -ne [IntPtr]::Zero){
          $container=[System.Windows.Automation.AutomationElement]::FromHandle($nativeField)
        }
      }
      if($container){
        $fields=if($container.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit){
          @($container)
        }else{
          @($container.FindAll([System.Windows.Automation.TreeScope]::Descendants,$editCondition))
        }
        if(@($fields).Count -eq 1){
          $field=@($fields)[0]
          $pattern=$null
          if($field.Current.IsEnabled -and
             $field.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern) -and
             !$pattern.Current.IsReadOnly){
            Picker-Foreground $dialogHandle
            $field.SetFocus()
            $pattern.SetValue($file)
            if($pattern.Current.Value -ceq $file){$entered=$true}
          }
        }
      }
    }catch{
      # Transient UIA elements are expected while the shell initializes.
      # No confirmation or success is emitted before exact readback.
    }
    if(!$entered){Start-Sleep -Milliseconds 200}
  }
  if(!$entered){
    # The existing native Publisher witness uses the Windows File name
    # accelerator when UIA cannot expose the field. Paste literal text instead
    # of interpreting +, %, ^ or braces as SendKeys commands. This is a
    # dedicated STA test profile; restore its clipboard on every exit.
    $previousClipboard=[System.Windows.Forms.Clipboard]::GetDataObject()
    try{
      for($attempt=0;$attempt -lt 4 -and !$entered;$attempt++){
        Picker-Foreground $dialogHandle
        [System.Windows.Forms.SendKeys]::SendWait('%n')
        Start-Sleep -Milliseconds 150
        if([CorporateQualificationGui]::GetForegroundWindow() -ne $dialogHandle){
          throw 'CORPORATE_GUI_NATIVE_PICKER_FOREGROUND_NOT_CONFIRMED'
        }
        [System.Windows.Forms.Clipboard]::SetText($file)
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        Start-Sleep -Milliseconds 250
        if([CorporateQualificationGui]::GetForegroundWindow() -ne $dialogHandle){
          throw 'CORPORATE_GUI_NATIVE_PICKER_FOREGROUND_NOT_CONFIRMED'
        }
        [System.Windows.Forms.Clipboard]::Clear()
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        [System.Windows.Forms.SendKeys]::SendWait('^c')
        for($clipAttempt=0;$clipAttempt -lt 8;$clipAttempt++){
          Start-Sleep -Milliseconds 100
          if([System.Windows.Forms.Clipboard]::ContainsText()){
            $entered=([System.Windows.Forms.Clipboard]::GetText() -ceq $file)
            break
          }
        }
      }
    }finally{
      if($null -ne $previousClipboard){
        [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard,$true)
      }else{
        [System.Windows.Forms.Clipboard]::Clear()
      }
    }
  }
  if(!$entered){throw 'CORPORATE_GUI_NATIVE_PICKER_EXACT_PATH_READBACK_FAILED'}
  # The selected path must be read back and the same native window must own
  # keyboard focus before the actual UI confirmation. No direct file write or
  # direct Owner/Consumer mutation is allowed in this witness.
  Picker-Foreground $dialogHandle
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  for($i=0;$i -lt 120;$i++){
    if(![CorporateQualificationGui]::IsWindow($dialogHandle)){break}
    Start-Sleep -Milliseconds 250
  }
  if([CorporateQualificationGui]::IsWindow($dialogHandle)){
    throw 'CORPORATE_GUI_NATIVE_PICKER_CONFIRMATION_NOT_CLOSED'
  }
  if(!$exists){
    for($i=0;$i -lt 120;$i++){
      if(Test-Path -LiteralPath $file -PathType Leaf){break}
      Start-Sleep -Milliseconds 250
    }
    if(!(Test-Path -LiteralPath $file -PathType Leaf)){
      throw 'CORPORATE_GUI_NATIVE_SIGNED_EXPORT_MISSING'
    }
  }
}
function Stop-App($process){
  if(!$process){return}
  $process.Refresh()
  if($process.HasExited){return}
  $h=$process.MainWindowHandle
  if($h -eq [IntPtr]::Zero -or
     ![CorporateQualificationGui]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){
    throw 'CORPORATE_GUI_GUI_WINDOW_CLOSE_FAILED'
  }
  if(!$process.WaitForExit(15000)){throw 'CORPORATE_GUI_GUI_CLOSE_TIMEOUT'}
}

function Publisher-Status([string]$state,[string]$id,[int]$sequence){
  switch($state){
    'ACTIVE' { }
    'SUSPENDED' {Select-FirstReal $pub 'Действие STATUS'}
    'REVOKED' {Select-Last $pub 'Действие STATUS'}
    default {throw 'CORPORATE_GUI_UNSUPPORTED_STATUS'}
  }
  # The fresh form defaults to ACTIVE.
  # The disposable fixture permits at most 3600 seconds. The longer
  # 45-minute window is only for the same-runner employee continuation;
  # the independent license-lifecycle test retains its original 15 minutes.
  $minutes=if($PrepareLicensedEmployee){45}else{15}
  $until=[DateTime]::UtcNow.AddMinutes($minutes).ToString("yyyy-MM-ddTHH:mm:ss.fffZ",[Globalization.CultureInfo]::InvariantCulture)
  Enter $pub 'STATUS действителен до (UTC, ISO 8601)' $until
  Confirm-Checkbox $pub 'Подтверждаю отдельную подпись STATUS; отзыв необратим' 'Подписать новый STATUS через T3'
  Press $pub 'Подписать новый STATUS через T3'
  # The GUI acknowledgement is required, but the original ledger is also
  # independently read on failure. Do not retry a consequential write.
  try{
    Wait-Text $pub "STATUS: $state, последовательность $sequence" 240
  }catch{
    $observed=$null
    try{$observed=Owner-Read $id}catch{}
    if($null -ne $observed -and $observed.sequence -eq $sequence -and
       $observed.status -ceq $state -and
       $observed.statusSignatureVerifiedAtIssuance -eq $true -and
       $observed.statusFloorVerified -eq $true){
      throw 'CORPORATE_GUI_STATUS_COMMITTED_ACK_NOT_VISIBLE'
    }
    if($null -ne $observed -and $observed.sequence -eq ($sequence-1)){
      # Emit only a bounded error code from the actual Publisher alert.
      # Never write the UI text, identifier, signed envelope or private data.
      $codes=@()
      $all=(Window $pub).FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      foreach($item in $all){
        try{
          $label=[string]$item.Current.Name
          if(!$label.Contains('Неизвестный исход STATUS.')){continue}
          foreach($match in [regex]::Matches($label,'(?<![A-Z0-9_])(?:PUBLISHER_CORPORATE|CORPORATE_OWNER|CORPORATE_STATUS|PRODUCT_OWNER|PRODUCT_STATUS|PRODUCT_LICENSE|T3_PRODUCT|T3_CORPORATE)_[A-Z0-9_]{3,80}(?![A-Z0-9_])')){
            $codes+=,$match.Value
          }
        }catch{}
      }
      $codes=@($codes|Select-Object -Unique|Select-Object -First 6)
      throw ('CORPORATE_GUI_STATUS_NOT_COMMITTED '+($codes -join ','))
    }
    throw 'CORPORATE_GUI_STATUS_ORIGINAL_OUTCOME_UNCONFIRMED'
  }
  $proof=Owner-Read $id
  if($proof.status -cne $state -or $proof.sequence -ne $sequence -or
     $proof.statusSignatureVerifiedAtIssuance -ne $true -or $proof.statusFloorVerified -ne $true){
    throw 'CORPORATE_NATIVE_SIGNED_STATUS_NOT_CONFIRMED'
  }
  return $proof
}
function Publisher-Export([string]$file,$proof){
  Native-FileDialog $pub 'Экспортировать подписанный .iwxa через исходный T3' $file $false
  Wait-Text $pub 'Подписанный файл готов к передаче'
  $raw=Copy-FromGui $pub 'Скопировать контрольные данные' 'Контрольные данные для Admin Center'
  $h=$raw|ConvertFrom-Json -Depth 20
  if($h.organizationId -cne $proof.organizationId -or $h.licenseId -cne $proof.licenseId -or
     $h.requestId -cne $proof.requestId -or $h.status -cne $proof.status -or
     $h.sequence -ne $proof.sequence -or
     $h.licenseEnvelopeSha256 -cne $proof.licenseEnvelopeSha256 -or
     $h.statusEnvelopeSha256 -cne $proof.statusEnvelopeSha256 -or
     $h.packageSha256 -cne (Digest $file) -or $h.bytes -ne (Get-Item -LiteralPath $file).Length -or
     $h.recipientConfirmed -ne $false -or $h.assignablePersonalAgentSeats -ne 0){
    throw 'CORPORATE_GUI_PUBLISHER_HANDOFF_NOT_EXACT'
  }
  return $raw
}
function Center-Receive([string]$raw,[string]$file,[bool]$expectAccepted=$true){
  Enter $cen 'Контрольные данные из Publisher' $raw
  Press $cen 'Перенести контрольные данные'
  Wait-Text $cen 'Контрольные данные перенесены'
  Native-FileDialog $cen 'Получить подписанную корпоративную лицензию через T3' $file $true
  if($expectAccepted){Wait-Text $cen 'Подписанные LICENSE и STATUS получены оригинальным T3'}
  else{Wait-Text $cen 'Результат получения файла не подтверждён'}
}
# Capture only predetermined public UI states, never the original receipt,
# raw WebView text, license id, signature, or an employee's information.
# This does not change the readback or repeat any mutation.
function Wait-CenterTariff([string]$tariff,[int]$revision){
  Gui-Step 'WAIT_TEXT'
  $expected="Тариф $tariff, редакция $revision"
  for($i=0;$i -lt 120;$i++){
    if(Has-Text $cen $expected $true){return}
    Start-Sleep -Milliseconds 250
  }
  if(Has-Text $cen 'Лицензия подтверждена исходной квитанцией, но общий readback не удался'){
    throw 'CORPORATE_GUI_CENTER_RECEIVED_BUT_LIST_READBACK_FAILED'
  }
  if(Has-Text $cen 'Корпоративное чтение T3:'){
    throw 'CORPORATE_GUI_CENTER_ORIGINAL_REFRESH_FAILED'
  }
  if(Has-Text $cen 'Не удалось прочитать корпоративный T3:'){
    throw 'CORPORATE_GUI_CENTER_COLD_READBACK_FAILED'
  }
  if(Has-Text $cen 'Исходное корпоративное чтение T3.'){
    throw 'CORPORATE_GUI_CENTER_VERIFIED_LIST_TARIFF_HEADING_NOT_OBSERVED'
  }
  throw 'CORPORATE_GUI_CENTER_VERIFIED_LIST_NOT_OBSERVED'
}
function Verify-Center([string]$org,$proof,[int]$revision,[string]$storedSha,[int]$expectedCount=1,[int]$adminSeats=2,[int]$employees=10,[int]$agentSeats=2){
  $view=Consumer-Read $org
  $rows=@($view.licenses)
  $row=@($rows|Where-Object {$_.licenseId -ceq $proof.licenseId})
  if($view.revision -ne $revision -or $rows.Count -ne $expectedCount -or $row.Count -ne 1){throw 'CORPORATE_NATIVE_STORE_REVISION_OR_COUNT_INVALID'}
  $r=$row[0]
  if($r.lineageId -cne $proof.lineageId -or $r.renewalOf -cne $proof.renewalOf){throw 'CORPORATE_NATIVE_LINEAGE_MISMATCH'}
  if($r.licenseId -cne $proof.licenseId -or $r.requestId -cne $proof.requestId -or
     $r.issuerAuthorityId -cne $proof.issuerAuthorityId -or $r.organizationId -cne $org -or
     $r.tariffId -cne $proof.tariffId -or $r.tariffRevision -ne $proof.tariffRevision -or
     $r.status -cne $proof.status -or $r.signedStatus -cne $proof.status -or
     $r.sequence -ne $proof.sequence -or $r.licenseEnvelopeSha256 -cne $proof.licenseEnvelopeSha256 -or
     $r.statusEnvelopeSha256 -cne $proof.statusEnvelopeSha256 -or $r.packageSha256 -cne $storedSha -or
     $r.signedTerms.productVersion -cne '0.4.1' -or $r.signedTerms.limits.adminCenterSeats -ne $adminSeats -or
     $r.signedTerms.limits.employeeLimit -ne $employees -or $r.signedTerms.limits.personalAgentSeats -ne $agentSeats -or
     @($r.signedTerms.limits.quotas).Count -ne 1 -or $r.signedTerms.limits.quotas[0].max -ne 700 -or
     $r.signatureVerified -ne $true -or $r.statusVerified -ne $true -or
     $r.recipientConfirmed -ne $true -or $r.activeSeats -ne 0 -or $r.assignablePersonalAgentSeats -ne 0){
    throw 'CORPORATE_NATIVE_SIGNED_TERMS_OR_RECEIPT_INVALID'
  }
  return $r
}
try{
  $caps=Read-Native $ownerPath @('corporate-capabilities',$ownerRoot)
  $initial=Read-Native $ownerPath @('corporate-inventory',$ownerRoot)
  if($caps.operation -ne 'CORPORATE_CAPABILITIES' -or $caps.environment -ne 'PRODUCTION' -or
     @($caps.issuers).Count -ne 1 -or $caps.issuers[0] -cne $IssuerAuthorityId -or
     $initial.operation -ne 'CORPORATE_INVENTORY' -or $initial.total -ne 0){
    throw 'CORPORATE_INSTALLED_DISPOSABLE_ISSUER_NOT_READY_OR_LEDGER_NOT_EMPTY'
  }
  $cen=Start-App $centerPath
  if($ResumeQualifiedCenterCI){
    # Reuse the SAME already qualified installed organization and signed
    # registry. No deletion, draft substitution or second enrollment.
    $draft=Wait-Preparation $centerDraft {param($x) @($x.organizations).Count -eq 1}
    Wait-Text $cen 'G4WindowsOrganization' 120
  }else{
    Enter $cen 'Название' 'IWXA Corporate Qualification'
    Select-Last $cen 'Тип'
    Press $cen 'Создать черновик организации'
    if($QualifySeatProjection){
      Press $cen 'Планы Atlas' $true
      Wait-Text $cen 'Планы Atlas и рабочие области'
      Enter $cen 'Название рабочей области' 'CorporateQualificationWorkspace'
      Press $cen 'Добавить' $true
      Wait-Text $cen 'CorporateQualificationWorkspace'
      Wait-Text $cen 'План Atlas пока не указан'
    }
    Press $cen 'Сохранить на компьютере'
    $draft=Wait-Preparation $centerDraft {param($x) @($x.organizations).Count -eq 1}
  }
  $org=[string]$draft.organizations[0].id
  if($draft.organizations[0].kind -ne 'ORGANIZATION' -or $org -cnotmatch '^[A-Za-z0-9_-]{7,100}$'){
    throw 'CORPORATE_GUI_ORGANIZATION_INVALID'
  }
  Press $cen 'Personal Agent и лицензии'
  if((Copy-FromGui $cen 'Скопировать идентификатор организации' 'Идентификатор организации для Publisher') -cne $org){
    throw 'CORPORATE_GUI_ORGANIZATION_ID_MISMATCH'
  }
  if($ResumeQualifiedCenterCI){
    Record-Check 'CENTER_RESUMES_QUALIFIED_ORGANIZATION_AND_EXPOSES_EXACT_ID'
  }else{
  Record-Check 'CENTER_CREATES_DURABLE_ORGANIZATION_AND_EXPOSES_EXACT_ID'
  }
  Phase 'PUBLISHER_BOOT'
  $pub=Start-App $publisherPath
  Wait-Text $pub 'Локально сохранено' 240
  Phase 'PUBLISHER_PRODUCT'
  Press $pub 'Продукты'
  Wait-Text $pub 'Новый продукт в локальном черновике каталога' 120
  Enter $pub 'Идентификатор продукта' 'IWXA_ADMIN_CENTER'
  Enter $pub 'Название' 'IWXA Admin Center'
  Enter $pub 'Версия' '0.4.1'
  Press $pub 'Сохранить продукт'
  $null=Wait-Preparation $publisherDraft {param($x) @($x.products).Count -eq 1}
  Phase 'PUBLISHER_HOLDER'
  Press $pub 'Клиенты'
  Wait-Text $pub 'Новый клиент' 120
  Enter $pub 'Идентификатор клиента' $org
  Enter $pub 'Название / имя' 'IWXA Corporate Qualification'
  Press $pub 'Сохранить клиента'
  $null=Wait-Preparation $publisherDraft {param($x) @($x.holders).Count -eq 1}
  Phase 'PUBLISHER_TARIFF'
  Press $pub 'Тарифы и лимиты'
  Wait-Text $pub 'Один каталог для организаций и физических лиц' 120
  Select-FirstReal $pub 'Продукт'
  Enter $pub 'Код тарифа' 'TEAM'
  Enter $pub 'Название тарифа' 'Qualified Team'
  Enter $pub 'Редакция' '1'
  Enter $pub 'Срок действия (дней)' '30'
  Enter $pub 'Места продукта' '2'
  Enter $pub 'Сотрудники организации' '10'
  Enter $pub 'Функции и модули' 'WORKSPACE, PERSONAL_AGENT_CORPORATE'
  Phase 'PUBLISHER_QUOTA'
  Press $pub 'Добавить квоту'
  Enter $pub 'Ресурс' 'REPORTS'
  Enter $pub 'Предел' '700'
  Select-Last $pub 'Период'
  Press $pub 'Сохранить редакцию тарифа'
  $null=Wait-Preparation $publisherDraft {param($x) @($x.tariffs).Count -eq 1}
  Phase 'PUBLISHER_PROPOSAL'
  Press $pub 'Лицензии'
  Wait-Text $pub 'Подготовить лицензию' 120
  Select-FirstReal $pub 'Тариф'
  Select-FirstReal $pub 'Клиент'
  Press $pub 'Сохранить подготовку по тарифу'
  $prep=Wait-Preparation $publisherDraft {param($x) @($x.proposals).Count -eq 1}
  if($prep.proposals[0].holderId -cne $org){throw 'CORPORATE_GUI_WRONG_DRAFT_HOLDER'}
  $request=[string]$prep.proposals[0].id
  Record-Check 'PUBLISHER_PREPARES_EXACT_ORGANIZATION_TARIFF_QUOTA'
  Phase 'PUBLISHER_TRUST'
  Press $pub 'Доверие и ключи'
  Press $pub 'Проверить зарегистрированного издателя T3'
  Native-FileDialog $pub 'Экспортировать публичное доверие для независимого Admin Center' $trustFile $false
  $trustSha=Digest $trustFile
  Wait-Text $pub 'Публичное доверие оригинального издателя сохранено'
  if((Copy-FromGui $pub 'Скопировать SHA-256 доверия' 'SHA-256 публичного доверия издателя') -cne $trustSha){
    throw 'CORPORATE_GUI_PUBLIC_TRUST_FINGERPRINT_MISMATCH'
  }
  Phase 'PUBLISHER_ISSUE'
  Select-FirstReal $pub 'Зарегистрированный издатель'
  Select-FirstReal $pub 'Подготовленное предложение организации'
  Enter $pub 'Корпоративные места Personal Agent (явно)' '2'
  Press $pub 'Проверить условия перед подписью'
  Confirm-Checkbox $pub 'Подтверждаю выдачу организации по этим условиям' 'Подписать через оригинальный T3'
  Press $pub 'Подписать через оригинальный T3'
  Wait-Text $pub 'Лицензия подписана и сохранена в оригинальном журнале T3'
  $inventory=Read-Native $ownerPath @('corporate-inventory',$ownerRoot,$request)
  if($inventory.matches -ne 1 -or $inventory.truncated -ne $false){throw 'CORPORATE_NATIVE_ISSUE_COUNT_INVALID'}
  $id=[string]$inventory.licenses[0].licenseId
  $issued=Owner-Read $id
  if($issued.requestId -cne $request -or $issued.organizationId -cne $org -or
     $issued.issuerAuthorityId -cne $IssuerAuthorityId -or $issued.status -ne 'NOT_ACTIVATED'){
    throw 'CORPORATE_NATIVE_ISSUE_TERMS_NOT_CONFIRMED'
  }
  Record-Check 'PUBLISHER_GUI_ORIGINAL_SIGNED_ISSUE'
  Phase 'PUBLISHER_ACTIVATE_EXPORT'
  $active=Publisher-Status 'ACTIVE' $id 1
  $handoff=Publisher-Export $activeFile $active
  Record-Check 'PUBLISHER_GUI_ACTIVE_STATUS_AND_EXACT_IWXA_EXPORT'
  Phase 'CENTER_TRUST_RECEIVE'
  Enter $cen 'SHA-256 публичного доверия' $trustSha
  Native-FileDialog $cen 'Установить доверие корпоративного издателя' $trustFile $true
  Wait-Text $cen 'Корпоративный T3 Consumer подключён'
  $pin=Read-Native $consumerPath @('corporate-capabilities',$consumerRoot,$org)
  if($pin.fingerprint -cne $trustSha -or $pin.organizationId -cne $org){
    throw 'CORPORATE_NATIVE_PIN_NOT_CONFIRMED'
  }
  Record-Check 'CENTER_ORIGINAL_CURRENTUSER_DPAPI_TRUST'
  Center-Receive $handoff $activeFile
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  Wait-CenterTariff 'TEAM' 1
  # The new Center tariff panel projects signed limits, not the registry's
  # actual allocation count. Verify-Center above still checks the original
  # Consumer's independent receipt: this intake did not allocate any seat.
  Wait-Text $cen 'Фактические назначения и свободные места определяются по исходному реестру T3.'
  Wait-Text $cen 'Перейти к распределению мест'
  Record-Check 'CENTER_ORIGINAL_SIGNATURES_AND_SIGNED_TERMS_READBACK'
  Phase 'CENTER_CAPACITY'
  if($QualifySeatProjection){
    Center-SeatProjection (-not $ResumeQualifiedCenterCI) 2 10
    Record-Check 'CENTER_INSTALLED_ORIGINAL_REGISTRY_USES_SIGNED_TARIFF_2_10'
  }
  Stop-App $cen
  $cen=Start-App $centerPath
  Press $cen 'Personal Agent и лицензии'
  Wait-CenterTariff 'TEAM' 1
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  Record-Check 'CENTER_COLD_RESTART_ORIGINAL_STORE'
  if($QualifySeatProjection){
    Center-SeatProjection $false 2 10
    Record-Check 'CENTER_INSTALLED_REGISTRY_AND_LICENSE_COLD_READBACK'
  }
  if($PrepareLicensedEmployee){
    if($checks.Count -ne 9 -or $active.status -cne 'ACTIVE' -or $active.sequence -ne 1 -or
       $active.organizationId -cne $org -or
       [DateTimeOffset]::Parse([string]$active.statusValidUntil) -le [DateTimeOffset]::UtcNow.AddMinutes(20)){
      throw 'CORPORATE_INSTALLED_EMPLOYEE_ACTIVE_LICENSE_NOT_CURRENT'
    }
    # Independent, exact native readback after the cold restart. Merely
    # copying a GUI file cannot be used as the preparation receipt.
    $checked=Verify-Center $org $active 1 (Digest $activeFile)
    if($checked.status -cne 'ACTIVE' -or $checked.recipientConfirmed -ne $true){
      throw 'CORPORATE_INSTALLED_EMPLOYEE_LICENSE_RECEIPT_INVALID'
    }
    [void][IO.Directory]::CreateDirectory($employeeHandoff)
    $trustOut=Join-Path $employeeHandoff 'publisher-corporate-trust.json'
    $licenseOut=Join-Path $employeeHandoff 'corporate-active.iwxa'
    [IO.File]::Copy($trustFile,$trustOut,$false)
    [IO.File]::Copy($activeFile,$licenseOut,$false)
    if((Digest $trustOut) -cne $trustSha -or (Digest $licenseOut) -cne (Digest $activeFile)){
      throw 'CORPORATE_INSTALLED_EMPLOYEE_HANDOFF_BYTES_CHANGED'
    }
    [ordered]@{
      schema='IWXA_DISPOSABLE_LICENSED_EMPLOYEE_HANDOFF/1'
      organizationId=$org;licenseId=$id;status='ACTIVE';sequence=1
      statusValidUntil=$active.statusValidUntil
      trustSha256=$trustSha;packageSha256=(Digest $licenseOut)
      publisherSha256=(Digest $publisherPath);centerSha256=(Digest $centerPath)
      ownerSha256=(Digest $ownerPath);consumerSha256=(Digest $consumerPath)
      recipientConfirmed=$true;employeeSeatAssigned=$false;productionActivation=$false
    }|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $employeeHandoff 'receipt.json') -Encoding UTF8
    $employeeHandoffReady=$true
    Write-Host 'CORPORATE_LICENSED_EMPLOYEE_PREPARATION=PASS checks=9'
    return
  }
  Phase 'CENTER_IDENTICAL_REPLAY'
  Center-Receive $handoff $activeFile
  Wait-Text $cen 'Новая запись не создана'
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  Record-Check 'CENTER_IDENTICAL_IWXA_REPLAY_NO_SECOND_REVISION'
  # A mutated carrier must fail even if an identical signed pair is already
  # stored and the original receipt can be recovered. Never treat that
  # recovery as proof that this physical file was accepted.
  $bad=[IO.File]::ReadAllBytes($activeFile)
  if($bad.Length -lt 16){throw 'CORPORATE_GUI_CARRIER_TOO_SMALL'}
  $index=[int][Math]::Floor($bad.Length/2)
  $bad[$index]=[byte]($bad[$index] -bxor 1)
  [IO.File]::WriteAllBytes($tamperedFile,$bad)
  Phase 'CENTER_TAMPERED_CARRIER'
  Center-Receive $handoff $tamperedFile $false
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  Record-Check 'CENTER_TAMPERED_PHYSICAL_CARRIER_DENIED_STORE_UNCHANGED'
  Phase 'PUBLISHER_COLD_READBACK'
  # Reopening Publisher must use the original signed journal, not the
  # in-memory delivery receipt or an unsigned preparation.
  Stop-App $pub
  $pub=Start-App $publisherPath
  Press $pub 'Доверие и ключи'
  Enter $pub 'Точный requestId, licenseId или organizationId исходного T3' $id
  Press $pub 'Прочитать подписанный журнал T3'
  Wait-Text $pub 'STATUS: ACTIVE, последовательность 1'
  $readAgain=Owner-Read $id
  if($readAgain.licenseEnvelopeSha256 -cne $active.licenseEnvelopeSha256 -or
     $readAgain.statusEnvelopeSha256 -cne $active.statusEnvelopeSha256 -or
     $readAgain.sequence -ne 1){
    throw 'CORPORATE_GUI_PUBLISHER_COLD_READBACK_MISMATCH'
  }
  Record-Check 'PUBLISHER_COLD_RESTART_ORIGINAL_SIGNED_JOURNAL'
  $reexport=Publisher-Export $reexportFile $active
  if((Digest $activeFile) -ceq (Digest $reexportFile)){throw 'CORPORATE_REEXPORT_EXPECTED_DIFFERENT_CARRIER'}
  Phase 'CENTER_REEXPORTED_SIGNED_PAIR'
  Center-Receive $reexport $reexportFile
  Wait-Text $cen 'Новая запись не создана'
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  Record-Check 'CENTER_REEXPORT_SAME_SIGNED_PAIR_NEW_CARRIER'
  Phase 'PUBLISHER_SUSPEND'
  $suspended=Publisher-Status 'SUSPENDED' $id 2
  $suspendedHandoff=Publisher-Export $suspendedFile $suspended
  Center-Receive $suspendedHandoff $suspendedFile
  $null=Verify-Center $org $suspended 2 (Digest $suspendedFile)
  Record-Check 'CENTER_RECEIVES_SIGNED_SUSPENSION'
  if($QualifySeatProjection){
    Center-SeatProjection $false -1 -1
    Record-Check 'CENTER_INSTALLED_REGISTRY_SUSPENSION_REMOVES_AVAILABLE_CAPACITY'
  }
  Phase 'CENTER_SUSPENSION_REPLAY'
  Center-Receive $handoff $activeFile $false
  $null=Verify-Center $org $suspended 2 (Digest $suspendedFile)
  Record-Check 'CENTER_SUSPENSION_CANNOT_BE_ROLLED_BACK_BY_OLD_ACTIVE'
  # Replace the suspended tariff with a deliberately smaller signed successor
  # through the same existing Publisher tariff preparation and native Owner.
  Phase 'PUBLISHER_RENEWAL_TARIFF'
  Press $pub 'Тарифы и лимиты'
  Press $pub 'Новая редакция'
  Enter $pub 'Места продукта' '1'
  Enter $pub 'Сотрудники организации' '6'
  Press $pub 'Сохранить редакцию тарифа'
  $null=Wait-Preparation $publisherDraft {param($x) @($x.tariffs).Count -eq 2}
  Phase 'PUBLISHER_RENEWAL_BASIS'
  Press $pub 'Лицензии'
  Wait-Text $pub 'Подготовить лицензию'
  Press $pub 'Выбрать продление по предыдущей подготовке'
  $renewalName='Продлить подготовку '+$request+' по редакции 2'
  Gui-Step 'BUTTON'
  Focus-App $pub
  $renewalChoice=Control $pub $renewalName
  if(!$renewalChoice.Current.IsEnabled){throw 'CORPORATE_GUI_RENEWAL_CHOICE_DISABLED'}
  if($renewalChoice.Current.IsOffscreen){
    try{$renewalChoice.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()}catch{}
  }
  $renewalChoice.SetFocus()
  $focused=$false
  for($attempt=0;$attempt -lt 20;$attempt++){
    try{
      if([System.Windows.Automation.AutomationElement]::FocusedElement.Current.Name -ceq $renewalName -and
         $renewalChoice.Current.HasKeyboardFocus){$focused=$true;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }
  if(!$focused){throw 'CORPORATE_GUI_RENEWAL_CHOICE_FOCUS_NOT_CONFIRMED'}
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Wait-Text $pub 'Выбранный тариф: TEAM, редакция 2'
  Wait-Text $pub 'Места продукта: 1'
  Wait-Text $pub 'Сотрудники: 6'
  Wait-Text $pub $request
  Wait-Text $pub 'Новая подготовка будет связана с прежним запросом'
  # The original preparation action is the one stable V8 button, even
  # after the review card is scrolled into view. No repeat on unknown outcome.
  Gui-Step 'BUTTON'
  Focus-App $pub
  $saveChoice=$null
  for($attempt=0;$attempt -lt 120;$attempt++){
    $items=(Window $pub).FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,'iwxa-publisher-save-proposal'))
    $matched=@()
    foreach($item in $items){
      try{
        if($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
           $item.Current.Name -ceq 'Создать следующую подготовку'){$matched+=,$item}
      }catch{}
    }
    if($matched.Count -gt 1){throw 'CORPORATE_GUI_RENEWAL_SAVE_AMBIGUOUS'}
    if($matched.Count -eq 1 -and $matched[0].Current.IsEnabled){
      $saveChoice=$matched[0];break
    }
    Start-Sleep -Milliseconds 250
  }
  if($null -eq $saveChoice){throw 'CORPORATE_GUI_RENEWAL_SAVE_UNAVAILABLE'}
  # Preparation is not a signature or an activation. Exercise the real
  # V8 button through native UIA InvokePattern exactly once. Keyboard focus
  # can disappear during a React layout update; do not make it a prerequisite
  # for this ordinary accessible action. Never fall back to a second click.
  $invoke=$null
  try{
    if(!$saveChoice.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke) -or !$invoke){
      throw 'CORPORATE_GUI_RENEWAL_SAVE_INVOKE_PATTERN_REQUIRED'
    }
  }catch{throw 'CORPORATE_GUI_RENEWAL_SAVE_INVOKE_PATTERN_REQUIRED'}
  $invokeUnknown=$false
  try{$invoke.Invoke()}catch{$invokeUnknown=$true}
  # The original persisted proposal, not the return of Invoke(), proves
  # that the user action completed. If ACK is uncertain, read only.
  try{
    $nextPrep=Wait-Preparation $publisherDraft {param($x) @($x.proposals).Count -eq 2}
  }catch{
    if($invokeUnknown){throw 'CORPORATE_GUI_RENEWAL_SAVE_INVOKE_OUTCOME_UNKNOWN'}
    throw 'CORPORATE_GUI_RENEWAL_SAVE_NO_PERSISTED_PREPARATION'
  }
  $followup=@($nextPrep.proposals|Where-Object {$_.previousProposalId -ceq $request})
  if($followup.Count -ne 1 -or $followup[0].tariffSnapshot.revision -ne 2 -or
    $followup[0].tariffSnapshot.productSeats -ne 1 -or $followup[0].tariffSnapshot.employeeLimit -ne 6){
    throw 'CORPORATE_GUI_RENEWAL_PREPARATION_MISMATCH'
  }
  $nextRequest=[string]$followup[0].id
  Press $pub 'Доверие и ключи'
  Press $pub 'Проверить зарегистрированного издателя T3'
  Select-FirstReal $pub 'Зарегистрированный издатель'
  Select-FirstReal $pub 'Подготовленное предложение организации'
  Enter $pub 'Корпоративные места Personal Agent (явно)' '1'
  Press $pub 'Проверить условия перед подписью'
  Wait-Text $pub "Предыдущая лицензия: $id"
  Confirm-Checkbox $pub 'Подтверждаю выдачу организации по этим условиям' 'Подписать через оригинальный T3'
  Press $pub 'Подписать через оригинальный T3'
  Wait-Text $pub 'Лицензия подписана и сохранена в оригинальном журнале T3'
  $nextInventory=Read-Native $ownerPath @('corporate-inventory',$ownerRoot,$nextRequest)
  if($nextInventory.matches -ne 1){throw 'CORPORATE_NATIVE_RENEWAL_ISSUE_COUNT_INVALID'}
  $nextId=[string]$nextInventory.licenses[0].licenseId
  $nextProof=Owner-Read $nextId
  if($nextId -ceq $id -or $nextProof.renewalOf -cne $id -or
     $nextProof.lineageId -cne $issued.lineageId -or $nextProof.requestId -cne $nextRequest -or
     $nextProof.tariffRevision -ne 2){throw 'CORPORATE_NATIVE_RENEWAL_SIGNATURE_LINK_INVALID'}
  Record-Check 'PUBLISHER_GUI_RENEWAL_BINDS_EXACT_PREVIOUS_SIGNED_LICENSE'
  Stop-App $pub
  $pub=Start-App $publisherPath
  Press $pub 'Доверие и ключи'
  Enter $pub 'Точный requestId, licenseId или organizationId исходного T3' $nextId
  Press $pub 'Прочитать подписанный журнал T3'
  Wait-Text $pub 'STATUS: NOT_ACTIVATED, последовательность 0'
  $renewed=Publisher-Status 'ACTIVE' $nextId 1
  $renewalHandoff=Publisher-Export $renewedFile $renewed
  Phase 'CENTER_RENEWAL_INTAKE'
  Center-Receive $renewalHandoff $renewedFile
  $null=Verify-Center $org $renewed 3 (Digest $renewedFile) 2 1 6 1
  Wait-CenterTariff 'TEAM' 2
  $view=Consumer-Read $org
  if($view.capacity.state -ne 'VERIFIED_CAPACITY_CANDIDATE' -or
    $view.capacity.candidateLicenseId -cne $nextId -or $view.capacity.activeLicenseCount -ne 1 -or
    @($view.licenses|Where-Object {$_.licenseId -ceq $id -and $_.superseded -eq $true}).Count -ne 1){
    throw 'CORPORATE_NATIVE_REPLACEMENT_NOT_SINGLE_CAPACITY'
  }
  Record-Check 'CENTER_RENEWAL_REPLACES_OLD_LIMITS_WITHOUT_SUMMING'
  if($QualifySeatProjection){
    Center-SeatProjection $false 1 6
    Record-Check 'CENTER_INSTALLED_REGISTRY_USES_RENEWAL_LIMIT_1_6'
  }
  Stop-App $cen
  $cen=Start-App $centerPath
  Press $cen 'Personal Agent и лицензии'
  Wait-CenterTariff 'TEAM' 2
  Phase 'CENTER_RENEWAL_COLD_REPLAY'
  Center-Receive $suspendedHandoff $suspendedFile
  $null=Verify-Center $org $renewed 3 (Digest $renewedFile) 2 1 6 1
  if((Consumer-Read $org).capacity.candidateLicenseId -cne $nextId){
    throw 'CORPORATE_NATIVE_RENEWAL_OLD_PACKAGE_RESTORED_CAPACITY'
  }
  Record-Check 'CENTER_RENEWAL_COLD_RESTART_AND_OLD_CARRIER_NO_REPLACEMENT'
  Phase 'PUBLISHER_REVOKE_SUCCESSOR'
  $nextRevoked=Publisher-Status 'REVOKED' $nextId 2
  $nextRevokedHandoff=Publisher-Export $renewedRevokedFile $nextRevoked
  Center-Receive $nextRevokedHandoff $renewedRevokedFile
  $null=Verify-Center $org $nextRevoked 4 (Digest $renewedRevokedFile) 2 1 6 1
  if((Consumer-Read $org).capacity.state -ne 'NO_CURRENT_LICENSE'){
    throw 'CORPORATE_NATIVE_REVOKED_SUCCESSOR_REVIVES_OLD_TARIFF'
  }
  Record-Check 'CENTER_REVOKED_SUCCESSOR_DOES_NOT_RESTORE_PREDECESSOR'
  if($QualifySeatProjection){
    Center-SeatProjection $false -1 -1
    Record-Check 'CENTER_INSTALLED_REGISTRY_REVOKED_SUCCESSOR_NO_CAPACITY'
  }
  Enter $pub 'Точный requestId, licenseId или organizationId исходного T3' $id
  Press $pub 'Прочитать подписанный журнал T3'
  Wait-Text $pub 'STATUS: SUSPENDED, последовательность 2'
  $revoked=Publisher-Status 'REVOKED' $id 3
  $revokedHandoff=Publisher-Export $revokedFile $revoked
  Phase 'CENTER_PREDECESSOR_REVOCATION'
  Center-Receive $revokedHandoff $revokedFile
  $null=Verify-Center $org $revoked 5 (Digest $revokedFile) 2
  if((Consumer-Read $org).capacity.state -ne 'NO_CURRENT_LICENSE'){throw 'CORPORATE_NATIVE_REVOKED_CHAIN_CAPACITY_INVALID'}
  Record-Check 'CENTER_RECEIVES_SIGNED_REVOCATION'
  Stop-App $cen
  $cen=Start-App $centerPath
  Press $cen 'Personal Agent и лицензии'
  Wait-Text $cen 'STATUS: REVOKED'
  Phase 'CENTER_FINAL_REVOKED_REPLAY'
  Center-Receive $handoff $activeFile $false
  $null=Verify-Center $org $revoked 5 (Digest $revokedFile) 2
  if((Consumer-Read $org).capacity.state -ne 'NO_CURRENT_LICENSE'){throw 'CORPORATE_NATIVE_REVOKED_CHAIN_CAPACITY_INVALID'}
  Record-Check 'CENTER_DURABLE_REVOKE_AND_OLD_ACTIVE_REPLAY_DENIED'
  $report=[ordered]@{
    schema='IWXA_CENTER_PUBLISHER_INSTALLED_CORPORATE_QUALIFICATION/1'
    status='PASS_ORIGINAL_TWO_INSTALLED_CORPORATE_PRODUCTS'
    checks=@($checks.ToArray())
    publisherSha256=(Digest $publisherPath)
    centerSha256=(Digest $centerPath)
    ownerSha256=(Digest $ownerPath)
    consumerSha256=(Digest $consumerPath)
    originalEd25519=$true
    originalWindowsDpapi=$true
    commercialAuthorityProven=$false
    originalSeatProjectionQualified=[bool]$QualifySeatProjection
    employeeSeatAssignmentsQualified=$false
    holderApplied=$false
    activeSeats=0
    assignablePersonalAgentSeats=0
    productionActivation=$false
  }
  $report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $artifact 'result.json') -Encoding UTF8
  if($ResumeQualifiedCenterCI){
    Write-Host "CORPORATE_TWO_INSTALLED_NATIVE_PASS checks=$($checks.Count)"
  }else{
    Write-Host "CORPORATE_TWO_INSTALLED_NATIVE_PASS checks=$($checks.Count) localEvidence=$artifact"
  }
}catch{
  if($ResumeQualifiedCenterCI){
    Write-Host ('CORPORATE_TWO_INSTALLED_FAILURE_PHASE='+$script:guiPhase)
    Write-Host ('CORPORATE_TWO_INSTALLED_FAILURE_STEP='+$script:guiOrdinal)
    Write-Host ('CORPORATE_TWO_INSTALLED_FAILURE_KIND='+$script:guiLastKind)
    # Do not print private draft IDs, owner paths, license contents or raw errors.
    $failureCode=[regex]::Match([string]$_.Exception.Message,'^((?:CORPORATE_GUI|CORPORATE_NATIVE|CORPORATE_SEAT)_[A-Z0-9_]{4,95})(?:\s|$)')
    if($failureCode.Success){Write-Host ('CORPORATE_TWO_INSTALLED_FAILURE_CODE='+$failureCode.Groups[1].Value)}
  }
  throw
}finally{
  [System.Windows.Forms.Clipboard]::Clear()
  foreach($p in @($cen,$pub)){
    if($null -ne $p){
      try{Stop-App $p}catch{
        $p.Refresh()
        if(!$p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
      }
    }
  }
  # Transfer files are disposable, not a production export or public artifact.
  foreach($file in @($trustFile,$activeFile,$reexportFile,$suspendedFile,$revokedFile,$tamperedFile,$renewedFile,$renewedRevokedFile)){
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
  if($ResumeQualifiedCenterCI){
    Remove-Item -LiteralPath $artifact -Recurse -Force -ErrorAction SilentlyContinue
  }
  if($PrepareLicensedEmployee -and !$employeeHandoffReady -and $employeeHandoff){
    Remove-Item -LiteralPath $employeeHandoff -Recurse -Force -ErrorAction SilentlyContinue
  }
}
