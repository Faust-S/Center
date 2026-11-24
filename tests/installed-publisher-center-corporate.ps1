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
  [switch]$QualifySeatProjection
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(!$IsWindows -or !$DedicatedTestProfile -or $env:GITHUB_ACTIONS -eq 'true'){
  throw 'CORPORATE_INSTALLED_LOCAL_DEDICATED_WINDOWS_REQUIRED'
}
if([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA'){
  throw 'CORPORATE_INSTALLED_START_PWSH_WITH_STA'
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
if((Test-Path -LiteralPath $centerDraft) -or (Test-Path -LiteralPath $publisherDraft) -or
   (Test-Path -LiteralPath (Join-Path $consumerRoot 'corporate'))){
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
$pub=$null
$cen=$null
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

function Start-App([string]$file) {
  $process=Start-Process -FilePath $file -WorkingDirectory (Split-Path $file -Parent) -PassThru
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
  if($process.HasExited -or $process.MainWindowHandle -eq [IntPtr]::Zero){
    throw 'CORPORATE_GUI_GUI_WINDOW_LOST'
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
}
function Control($process,[string]$name,[string]$kind='Button',[int]$attempts=60) {
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
    foreach($item in $items){
      try {
        if($item.Current.ControlType -eq $expected){return $item}
      }catch{}
    }
    Start-Sleep -Milliseconds 200
  }
  throw "CORPORATE_GUI_UI_CONTROL_MISSING $kind $name"
}
function Press($process,[string]$name,[bool]$physical=$false){
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
  Focus-App $process
  $element=Control $process $name 'Edit'
  $element.SetFocus()
  [System.Windows.Forms.Clipboard]::SetText($value)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 220
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
function Confirm-Checkbox($process,[string]$name){
  Focus-App $process
  $element=Control $process $name 'CheckBox'
  $pattern=$element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  if($pattern.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On){$pattern.Toggle()}
  if($pattern.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On){
    throw 'CORPORATE_GUI_CONFIRMATION_NOT_CHECKED'
  }
}
function Select-Last($process,[string]$name){
  Focus-App $process
  $element=Control $process $name 'ComboBox'
  $element.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{END}')
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 160
}
function Select-FirstReal($process,[string]$name){
  Focus-App $process
  $element=Control $process $name 'ComboBox'
  $element.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
  [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 160
}
function Wait-Text($process,[string]$contains,[int]$attempts=70){
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
  if($first -and (Has-Text $cen 'Подключить распределение мест' $true)){
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
function Native-FileDialog($process,[string]$button,[string]$file,[bool]$exists){
  if((Test-Path -LiteralPath $file -PathType Leaf) -ne $exists){
    throw "CORPORATE_GUI_DIALOG_PRECONDITION_FAILED $button"
  }
  Press $process $button
  $dialog=$null
  for($i=0;$i -lt 75;$i++){
    $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($window in $windows){
      try{
        if($window.Current.ProcessId -eq $process.Id -and
           $window.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
           $window.Current.NativeWindowHandle -ne $process.MainWindowHandle){
          $dialog=$window;break
        }
      }catch{}
    }
    if($dialog){break}
    Start-Sleep -Milliseconds 200
  }
  if(!$dialog){throw "CORPORATE_GUI_NATIVE_FILE_DIALOG_NOT_FOUND $button"}
  # Native selected paths may include +, ^, % or braces. SendKeys treats
  # those as commands; write the chosen filename literally with Windows UIA.
  $field=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1148'))
  if(!$field){throw 'CORPORATE_GUI_NATIVE_PICKER_FILENAME_FIELD_MISSING'}
  if($field.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit){
    $field=$field.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit))
  }
  if(!$field){throw 'CORPORATE_GUI_NATIVE_PICKER_EDIT_MISSING'}
  $pattern=$null
  if(-not $field.TryGetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
    throw 'CORPORATE_GUI_NATIVE_PICKER_VALUE_PATTERN_REQUIRED'
  }
  ([System.Windows.Automation.ValuePattern]$pattern).SetValue($file)
  $field.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  if(!$exists){
    for($i=0;$i -lt 70;$i++){
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
  $until=[DateTime]::UtcNow.AddMinutes(15).ToString("yyyy-MM-ddTHH:mm:ss.fffZ",[Globalization.CultureInfo]::InvariantCulture)
  Enter $pub 'STATUS действителен до (UTC, ISO 8601)' $until
  Confirm-Checkbox $pub 'Подтверждаю отдельную подпись STATUS; отзыв необратим'
  Press $pub 'Подписать новый STATUS через T3'
  Wait-Text $pub "STATUS: $state, последовательность $sequence"
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
function Verify-Center([string]$org,$proof,[int]$revision,[string]$storedSha,[int]$expectedCount=1,[int]$adminSeats=2,[int]$employees=10,[int]$agentSeats=2){
  $view=Consumer-Read $org
  $rows=@($view.licenses)
  $row=@($rows|Where-Object {$_.licenseId -ceq $proof.licenseId})
  if($view.revision -ne $revision -or $rows.Count -ne $expectedCount -or $row.Count -ne 1){throw 'CORPORATE_NATIVE_STORE_REVISION_OR_COUNT_INVALID'}
  $r=$row[0]
  if($r.lineageId -cne $proof.lineageId -or $r.renewalOf -cne $proof.renewalOf){throw 'CORPORATE_NATIVE_LINEAGE_MISMATCH'}
  if($r.licenseId -cne $proof.licenseId -or $r.requestId -cne $proof.requestId -or
     $r.issuerAuthorityId -cne $proof.issuerAuthorityId -or $r.organizationId -cne $org -or
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
  $org=[string]$draft.organizations[0].id
  if($draft.organizations[0].kind -ne 'ORGANIZATION' -or $org -cnotmatch '^[A-Za-z0-9_-]{7,100}$'){
    throw 'CORPORATE_GUI_ORGANIZATION_INVALID'
  }
  Press $cen 'Personal Agent и лицензии'
  if((Copy-FromGui $cen 'Скопировать идентификатор организации' 'Идентификатор организации для Publisher') -cne $org){
    throw 'CORPORATE_GUI_ORGANIZATION_ID_MISMATCH'
  }
  $checks.Add('CENTER_CREATES_DURABLE_ORGANIZATION_AND_EXPOSES_EXACT_ID')
  $pub=Start-App $publisherPath
  Press $pub 'Продукты'
  Enter $pub 'Идентификатор продукта' 'IWXA_ADMIN_CENTER'
  Enter $pub 'Название' 'IWXA Admin Center'
  Enter $pub 'Версия' '0.4.1'
  Press $pub 'Сохранить продукт'
  $null=Wait-Preparation $publisherDraft {param($x) @($x.products).Count -eq 1}
  Press $pub 'Клиенты'
  Enter $pub 'Идентификатор клиента' $org
  Enter $pub 'Название / имя' 'IWXA Corporate Qualification'
  Press $pub 'Сохранить клиента'
  $null=Wait-Preparation $publisherDraft {param($x) @($x.holders).Count -eq 1}
  Press $pub 'Тарифы и лимиты'
  Select-FirstReal $pub 'Продукт'
  Enter $pub 'Код тарифа' 'TEAM'
  Enter $pub 'Название тарифа' 'Qualified Team'
  Enter $pub 'Редакция' '1'
  Enter $pub 'Срок действия (дней)' '30'
  Enter $pub 'Места продукта' '2'
  Enter $pub 'Сотрудники организации' '10'
  Enter $pub 'Функции и модули' 'WORKSPACE, PERSONAL_AGENT_CORPORATE'
  Press $pub 'Добавить квоту'
  Enter $pub 'Ресурс' 'REPORTS'
  Enter $pub 'Предел' '700'
  Select-Last $pub 'Период'
  Press $pub 'Сохранить редакцию тарифа'
  $null=Wait-Preparation $publisherDraft {param($x) @($x.tariffs).Count -eq 1}
  Press $pub 'Лицензии'
  Select-FirstReal $pub 'Тариф'
  Select-FirstReal $pub 'Клиент'
  Press $pub 'Сохранить подготовку по тарифу'
  $prep=Wait-Preparation $publisherDraft {param($x) @($x.proposals).Count -eq 1}
  if($prep.proposals[0].holderId -cne $org){throw 'CORPORATE_GUI_WRONG_DRAFT_HOLDER'}
  $request=[string]$prep.proposals[0].id
  $checks.Add('PUBLISHER_PREPARES_EXACT_ORGANIZATION_TARIFF_QUOTA')
  Press $pub 'Доверие и ключи'
  Press $pub 'Проверить зарегистрированного издателя T3'
  Native-FileDialog $pub 'Экспортировать публичное доверие для независимого Admin Center' $trustFile $false
  $trustSha=Digest $trustFile
  Wait-Text $pub 'Публичное доверие оригинального издателя сохранено'
  if((Copy-FromGui $pub 'Скопировать SHA-256 доверия' 'SHA-256 публичного доверия издателя') -cne $trustSha){
    throw 'CORPORATE_GUI_PUBLIC_TRUST_FINGERPRINT_MISMATCH'
  }
  Select-FirstReal $pub 'Зарегистрированный издатель'
  Select-FirstReal $pub 'Подготовленное предложение организации'
  Enter $pub 'Корпоративные места Personal Agent (явно)' '2'
  Press $pub 'Проверить условия перед подписью'
  Confirm-Checkbox $pub 'Подтверждаю выдачу организации по этим условиям'
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
  $checks.Add('PUBLISHER_GUI_ORIGINAL_SIGNED_ISSUE')
  $active=Publisher-Status 'ACTIVE' $id 1
  $handoff=Publisher-Export $activeFile $active
  $checks.Add('PUBLISHER_GUI_ACTIVE_STATUS_AND_EXACT_IWXA_EXPORT')
  Enter $cen 'SHA-256 публичного доверия' $trustSha
  Native-FileDialog $cen 'Установить доверие корпоративного издателя' $trustFile $true
  Wait-Text $cen 'Корпоративный T3 Consumer подключён'
  $pin=Read-Native $consumerPath @('corporate-capabilities',$consumerRoot,$org)
  if($pin.fingerprint -cne $trustSha -or $pin.organizationId -cne $org){
    throw 'CORPORATE_NATIVE_PIN_NOT_CONFIRMED'
  }
  $checks.Add('CENTER_ORIGINAL_CURRENTUSER_DPAPI_TRUST')
  Center-Receive $handoff $activeFile
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  Wait-Text $cen 'Тариф TEAM, редакция 1'
  # The new Center tariff panel projects signed limits, not the registry's
  # actual allocation count. Verify-Center above still checks the original
  # Consumer's independent receipt: this intake did not allocate any seat.
  Wait-Text $cen 'Фактические назначения и свободные места определяются по исходному реестру T3.'
  Wait-Text $cen 'Перейти к распределению мест'
  $checks.Add('CENTER_ORIGINAL_SIGNATURES_AND_SIGNED_TERMS_READBACK')
  if($QualifySeatProjection){
    Center-SeatProjection $true 2 10
    $checks.Add('CENTER_INSTALLED_ORIGINAL_REGISTRY_USES_SIGNED_TARIFF_2_10')
  }
  Stop-App $cen
  $cen=Start-App $centerPath
  Press $cen 'Personal Agent и лицензии'
  Wait-Text $cen 'Тариф TEAM, редакция 1'
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  $checks.Add('CENTER_COLD_RESTART_ORIGINAL_STORE')
  if($QualifySeatProjection){
    Center-SeatProjection $false 2 10
    $checks.Add('CENTER_INSTALLED_REGISTRY_AND_LICENSE_COLD_READBACK')
  }
  Center-Receive $handoff $activeFile
  Wait-Text $cen 'Новая запись не создана'
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  $checks.Add('CENTER_IDENTICAL_IWXA_REPLAY_NO_SECOND_REVISION')
  # A mutated carrier must fail even if an identical signed pair is already
  # stored and the original receipt can be recovered. Never treat that
  # recovery as proof that this physical file was accepted.
  $bad=[IO.File]::ReadAllBytes($activeFile)
  if($bad.Length -lt 16){throw 'CORPORATE_GUI_CARRIER_TOO_SMALL'}
  $index=[int][Math]::Floor($bad.Length/2)
  $bad[$index]=[byte]($bad[$index] -bxor 1)
  [IO.File]::WriteAllBytes($tamperedFile,$bad)
  Center-Receive $handoff $tamperedFile $false
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  $checks.Add('CENTER_TAMPERED_PHYSICAL_CARRIER_DENIED_STORE_UNCHANGED')
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
  $checks.Add('PUBLISHER_COLD_RESTART_ORIGINAL_SIGNED_JOURNAL')
  $reexport=Publisher-Export $reexportFile $active
  if((Digest $activeFile) -ceq (Digest $reexportFile)){throw 'CORPORATE_REEXPORT_EXPECTED_DIFFERENT_CARRIER'}
  Center-Receive $reexport $reexportFile
  Wait-Text $cen 'Новая запись не создана'
  $null=Verify-Center $org $active 1 (Digest $activeFile)
  $checks.Add('CENTER_REEXPORT_SAME_SIGNED_PAIR_NEW_CARRIER')
  $suspended=Publisher-Status 'SUSPENDED' $id 2
  $suspendedHandoff=Publisher-Export $suspendedFile $suspended
  Center-Receive $suspendedHandoff $suspendedFile
  $null=Verify-Center $org $suspended 2 (Digest $suspendedFile)
  $checks.Add('CENTER_RECEIVES_SIGNED_SUSPENSION')
  if($QualifySeatProjection){
    Center-SeatProjection $false -1 -1
    $checks.Add('CENTER_INSTALLED_REGISTRY_SUSPENSION_REMOVES_AVAILABLE_CAPACITY')
  }
  Center-Receive $handoff $activeFile $false
  $null=Verify-Center $org $suspended 2 (Digest $suspendedFile)
  $checks.Add('CENTER_SUSPENSION_CANNOT_BE_ROLLED_BACK_BY_OLD_ACTIVE')
  # Replace the suspended tariff with a deliberately smaller signed successor
  # through the same existing Publisher tariff preparation and native Owner.
  Press $pub 'Тарифы и лимиты'
  Press $pub 'Новая редакция'
  Enter $pub 'Места продукта' '1'
  Enter $pub 'Сотрудники организации' '6'
  Press $pub 'Сохранить редакцию тарифа'
  $null=Wait-Preparation $publisherDraft {param($x) @($x.tariffs).Count -eq 2}
  Press $pub 'Лицензии'
  Select-Last $pub 'Тариф'
  Select-FirstReal $pub 'Клиент'
  Select-Last $pub 'Основание подготовки'
  Press $pub 'Создать следующую подготовку'
  $nextPrep=Wait-Preparation $publisherDraft {param($x) @($x.proposals).Count -eq 2}
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
  Confirm-Checkbox $pub 'Подтверждаю выдачу организации по этим условиям'
  Press $pub 'Подписать через оригинальный T3'
  Wait-Text $pub 'Лицензия подписана и сохранена в оригинальном журнале T3'
  $nextInventory=Read-Native $ownerPath @('corporate-inventory',$ownerRoot,$nextRequest)
  if($nextInventory.matches -ne 1){throw 'CORPORATE_NATIVE_RENEWAL_ISSUE_COUNT_INVALID'}
  $nextId=[string]$nextInventory.licenses[0].licenseId
  $nextProof=Owner-Read $nextId
  if($nextId -ceq $id -or $nextProof.renewalOf -cne $id -or
     $nextProof.lineageId -cne $issued.lineageId -or $nextProof.requestId -cne $nextRequest -or
     $nextProof.tariffRevision -ne 2){throw 'CORPORATE_NATIVE_RENEWAL_SIGNATURE_LINK_INVALID'}
  $checks.Add('PUBLISHER_GUI_RENEWAL_BINDS_EXACT_PREVIOUS_SIGNED_LICENSE')
  Stop-App $pub
  $pub=Start-App $publisherPath
  Press $pub 'Доверие и ключи'
  Enter $pub 'Точный requestId, licenseId или organizationId исходного T3' $nextId
  Press $pub 'Прочитать подписанный журнал T3'
  Wait-Text $pub 'STATUS: NOT_ACTIVATED, последовательность 0'
  $renewed=Publisher-Status 'ACTIVE' $nextId 1
  $renewalHandoff=Publisher-Export $renewedFile $renewed
  Center-Receive $renewalHandoff $renewedFile
  $null=Verify-Center $org $renewed 3 (Digest $renewedFile) 2 1 6 1
  Wait-Text $cen 'Тариф TEAM, редакция 2'
  $view=Consumer-Read $org
  if($view.capacity.state -ne 'VERIFIED_CAPACITY_CANDIDATE' -or
    $view.capacity.candidateLicenseId -cne $nextId -or $view.capacity.activeLicenseCount -ne 1 -or
    @($view.licenses|Where-Object {$_.licenseId -ceq $id -and $_.superseded -eq $true}).Count -ne 1){
    throw 'CORPORATE_NATIVE_REPLACEMENT_NOT_SINGLE_CAPACITY'
  }
  $checks.Add('CENTER_RENEWAL_REPLACES_OLD_LIMITS_WITHOUT_SUMMING')
  if($QualifySeatProjection){
    Center-SeatProjection $false 1 6
    $checks.Add('CENTER_INSTALLED_REGISTRY_USES_RENEWAL_LIMIT_1_6')
  }
  Stop-App $cen
  $cen=Start-App $centerPath
  Press $cen 'Personal Agent и лицензии'
  Wait-Text $cen 'Тариф TEAM, редакция 2'
  Center-Receive $suspendedHandoff $suspendedFile
  $null=Verify-Center $org $renewed 3 (Digest $renewedFile) 2 1 6 1
  if((Consumer-Read $org).capacity.candidateLicenseId -cne $nextId){
    throw 'CORPORATE_NATIVE_RENEWAL_OLD_PACKAGE_RESTORED_CAPACITY'
  }
  $checks.Add('CENTER_RENEWAL_COLD_RESTART_AND_OLD_CARRIER_NO_REPLACEMENT')
  $nextRevoked=Publisher-Status 'REVOKED' $nextId 2
  $nextRevokedHandoff=Publisher-Export $renewedRevokedFile $nextRevoked
  Center-Receive $nextRevokedHandoff $renewedRevokedFile
  $null=Verify-Center $org $nextRevoked 4 (Digest $renewedRevokedFile) 2 1 6 1
  if((Consumer-Read $org).capacity.state -ne 'NO_CURRENT_LICENSE'){
    throw 'CORPORATE_NATIVE_REVOKED_SUCCESSOR_REVIVES_OLD_TARIFF'
  }
  $checks.Add('CENTER_REVOKED_SUCCESSOR_DOES_NOT_RESTORE_PREDECESSOR')
  if($QualifySeatProjection){
    Center-SeatProjection $false -1 -1
    $checks.Add('CENTER_INSTALLED_REGISTRY_REVOKED_SUCCESSOR_NO_CAPACITY')
  }
  Enter $pub 'Точный requestId, licenseId или organizationId исходного T3' $id
  Press $pub 'Прочитать подписанный журнал T3'
  Wait-Text $pub 'STATUS: SUSPENDED, последовательность 2'
  $revoked=Publisher-Status 'REVOKED' $id 3
  $revokedHandoff=Publisher-Export $revokedFile $revoked
  Center-Receive $revokedHandoff $revokedFile
  $null=Verify-Center $org $revoked 5 (Digest $revokedFile) 2
  if((Consumer-Read $org).capacity.state -ne 'NO_CURRENT_LICENSE'){throw 'CORPORATE_NATIVE_REVOKED_CHAIN_CAPACITY_INVALID'}
  $checks.Add('CENTER_RECEIVES_SIGNED_REVOCATION')
  Stop-App $cen
  $cen=Start-App $centerPath
  Press $cen 'Personal Agent и лицензии'
  Wait-Text $cen 'STATUS: REVOKED'
  Center-Receive $handoff $activeFile $false
  $null=Verify-Center $org $revoked 5 (Digest $revokedFile) 2
  if((Consumer-Read $org).capacity.state -ne 'NO_CURRENT_LICENSE'){throw 'CORPORATE_NATIVE_REVOKED_CHAIN_CAPACITY_INVALID'}
  $checks.Add('CENTER_DURABLE_REVOKE_AND_OLD_ACTIVE_REPLAY_DENIED')
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
  Write-Host "CORPORATE_TWO_INSTALLED_NATIVE_PASS checks=$($checks.Count) localEvidence=$artifact"
}finally{
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
}
