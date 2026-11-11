# Public Center-owned Windows acceptance for TWO installed desktop applications.
# This script NEVER signs, verifies or provisions licenses on its own:
# both programs must contain prebuilt original T3 technology installed
# out-of-band. The public repository never checks out private T3 sources.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PublisherExe,
  [Parameter(Mandatory=$true)][string]$AdminCenterExe,
  [switch]$DedicatedTestProfile
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'CENTER_LICENSE_ACCEPTANCE_WINDOWS_REQUIRED'}
if(-not $DedicatedTestProfile){throw 'CENTER_LICENSE_ACCEPTANCE_DEDICATED_PROFILE_REQUIRED'}
if($env:GITHUB_ACTIONS -eq 'true'){
  throw 'CENTER_LICENSE_ACCEPTANCE_PRIVATE_COMPONENTS_NOT_PERMITTED_IN_PUBLIC_CI'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CenterLicenseGui {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
}
'@
$publisherPath=[IO.Path]::GetFullPath($PublisherExe)
$centerPath=[IO.Path]::GetFullPath($AdminCenterExe)
$ownerPath=Join-Path (Split-Path $publisherPath -Parent) 't3/iwxa-t3-product-owner.exe'
$consumerPath=Join-Path (Split-Path $centerPath -Parent) 't3/iwxa-t3-product-consumer.exe'
foreach($file in @($publisherPath,$centerPath,$ownerPath,$consumerPath)){
  if(!(Test-Path -LiteralPath $file -PathType Leaf)){
    throw "CENTER_LICENSE_ACCEPTANCE_INSTALLED_BINARY_MISSING $file"
  }
}
$ownerRoot=Join-Path $env:LOCALAPPDATA 'ru.iwxa.publisher/t3-owner-test'
$consumerRoot=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/t3-consumer-test'
foreach($root in @($ownerRoot,$consumerRoot)){
  if(!(Test-Path -LiteralPath $root -PathType Container)){
    throw 'CENTER_LICENSE_ACCEPTANCE_ORIGINAL_OWNER_NOT_PROVISIONED'
  }
}
$draft=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/atlas-store-v1/preparation/draft.json'
if(Test-Path -LiteralPath $draft){
  throw 'CENTER_LICENSE_ACCEPTANCE_EXISTING_MANAGER_DRAFT_USE_FRESH_TEST_PROFILE'
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$artifact=[IO.Path]::GetFullPath((Join-Path (Get-Location) "artifacts/center-two-installed-test-license-$stamp"))
[void][IO.Directory]::CreateDirectory($artifact)
$requestFile=Join-Path $artifact 'admin-unsigned-request.json'
$active=Join-Path $artifact 'signed-active.iwxa'
$revoked=Join-Path $artifact 'signed-revoked.iwxa'
$checks=[System.Collections.Generic.List[string]]::new()
$pub=$null
$cen=$null
function Start-App([string]$file) {
  $process=Start-Process -FilePath $file -WorkingDirectory (Split-Path $file -Parent) -PassThru
  for($attempt=0;$attempt -lt 100;$attempt++){
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    if($process.HasExited){throw "CENTER_LICENSE_GUI_PROCESS_EXITED_EARLY $file"}
    if($process.MainWindowHandle -ne [IntPtr]::Zero){return $process}
  }
  throw "CENTER_LICENSE_GUI_MAIN_WINDOW_NOT_SHOWN $file"
}
function Window($process) {
  $process.Refresh()
  if($process.HasExited -or $process.MainWindowHandle -eq [IntPtr]::Zero){
    throw 'CENTER_LICENSE_GUI_WINDOW_LOST'
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
}
function Control($process,[string]$name,[string]$kind='Button',[int]$attempts=60) {
  $expected=switch($kind){
    'Edit' {[System.Windows.Automation.ControlType]::Edit}
    'ComboBox' {[System.Windows.Automation.ControlType]::ComboBox}
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
  throw "CENTER_LICENSE_UI_CONTROL_MISSING $kind $name"
}
function Press($process,[string]$name,[bool]$physical=$false){
  $element=Control $process $name
  if(!$element.Current.IsEnabled){throw "CENTER_LICENSE_GUI_BUTTON_DISABLED $name"}
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
    throw "CENTER_LICENSE_GUI_BUTTON_NOT_VISIBLE $name"
  }
  [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
    [int]($b.Left+$b.Width/2),[int]($b.Top+$b.Height/2))
  [CenterLicenseGui]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [CenterLicenseGui]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 270
}
function Enter($process,[string]$name,[string]$value){
  $element=Control $process $name 'Edit'
  $element.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait($value)
  Start-Sleep -Milliseconds 180
}
function Select-Last($process,[string]$name){
  $element=Control $process $name 'ComboBox'
  $element.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{END}')
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 160
}
function Select-FirstReal($process,[string]$name){
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
  throw "CENTER_LICENSE_GUI_CONFIRMATION_NOT_FOUND $contains"
}
function Native-FileDialog($process,[string]$button,[string]$file,[bool]$exists){
  if((Test-Path -LiteralPath $file -PathType Leaf) -ne $exists){
    throw "CENTER_LICENSE_DIALOG_PRECONDITION_FAILED $button"
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
  if(!$dialog){throw "CENTER_LICENSE_NATIVE_FILE_DIALOG_NOT_FOUND $button"}
  # Native selected paths may include +, ^, % or braces. SendKeys treats
  # those as commands; write the chosen filename literally with Windows UIA.
  $field=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1148'))
  if(!$field){throw 'CENTER_LICENSE_NATIVE_PICKER_FILENAME_FIELD_MISSING'}
  if($field.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit){
    $field=$field.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit))
  }
  if(!$field){throw 'CENTER_LICENSE_NATIVE_PICKER_EDIT_MISSING'}
  $pattern=$null
  if(-not $field.TryGetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
    throw 'CENTER_LICENSE_NATIVE_PICKER_VALUE_PATTERN_REQUIRED'
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
      throw 'CENTER_LICENSE_NATIVE_SIGNED_EXPORT_MISSING'
    }
  }
}
function Owner-Inventory {
  $json=(& $ownerPath inventory $ownerRoot | Out-String)
  if($LASTEXITCODE -ne 0){throw 'CENTER_LICENSE_ORIGINAL_OWNER_INVENTORY_FAILED'}
  $result=$json|ConvertFrom-Json -Depth 30
  if($result.operation -ne 'TEST_INVENTORY' -or $result.activeSeats -ne 0 -or
     $result.productionActivation -ne $false){
    throw 'CENTER_LICENSE_ORIGINAL_OWNER_INVENTORY_INVALID'
  }
  return $result
}
function Confirm-Status([string]$id,[string]$wanted){
  for($i=0;$i -lt 75;$i++){
    $inventory=Owner-Inventory
    $entry=@($inventory.licenses)|Where-Object {$_.licenseId -eq $id}|Select-Object -First 1
    if($null -ne $entry -and $entry.status -eq $wanted -and $entry.sequence -ge 1){
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw "CENTER_LICENSE_ORIGINAL_OWNER_STATUS_NOT_SAVED $wanted"
}
function Stop-App($process){
  if(!$process){return}
  $process.Refresh()
  if($process.HasExited){return}
  $h=$process.MainWindowHandle
  if($h -eq [IntPtr]::Zero -or
     ![CenterLicenseGui]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){
    throw 'CENTER_LICENSE_GUI_WINDOW_CLOSE_FAILED'
  }
  if(!$process.WaitForExit(15000)){throw 'CENTER_LICENSE_GUI_CLOSE_TIMEOUT'}
}
try{
  $ownerCaps=(& $ownerPath capabilities $ownerRoot|Out-String)|ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or $ownerCaps.operation -ne 'TEST_CAPABILITIES' -or
     $ownerCaps.productionActivation -ne $false -or @($ownerCaps.issuers).Count -lt 1){
    throw 'CENTER_LICENSE_TEST_OWNER_NOT_ENROLLED'
  }
  $cen=Start-App $centerPath
  Enter $cen 'Название' 'CenterLicenseTestOrganization'
  Select-Last $cen 'Тип'
  Press $cen 'Создать черновик организации'
  Press $cen 'Сохранить на компьютере'
  $organizationId=''
  for($i=0;$i -lt 60;$i++){
    if(Test-Path -LiteralPath $draft){
      try{
        $current=Get-Content -LiteralPath $draft -Raw|ConvertFrom-Json -Depth 80
        if(@($current.organizations).Count -eq 1 -and
           $current.organizations[0].name -eq 'CenterLicenseTestOrganization'){
          $organizationId=[string]$current.organizations[0].id
          break
        }
      }catch{}
    }
    Start-Sleep -Milliseconds 220
  }
  if($organizationId -notmatch '^[a-zA-Z0-9_-]{7,100}$'){
    throw 'CENTER_LICENSE_ORGANIZATION_NOT_DURABLY_CREATED'
  }
  $checks.Add('CENTER_ORGANIZATION_SAVED_VIA_NATIVE_GUI')
  # The organization originated here. No duplicate product/client/proposal
  # should be created in Publisher to request an original T3 TEST license.
  Press $cen 'Personal Agent и лицензии'
  Wait-Text $cen 'Запрос лицензии в Publisher'
  Native-FileDialog $cen 'Сохранить запрос для Publisher' $requestFile $false
  $request=(Get-Content -LiteralPath $requestFile -Raw|ConvertFrom-Json -Depth 12)
  if($request.schema -ne 'IWXA_PUBLISHER_TEST_LICENSE_REQUEST/1' -or
     $request.kind -ne 'TEST_LICENSE_REQUEST' -or
     $request.environment -ne 'TEST' -or $request.status -ne 'UNSIGNED_REQUEST' -or
     $request.subject.id -ne $organizationId -or
     $request.subject.type -ne 'ORGANIZATION' -or
     $request.product.id -ne 'IWXA_ADMIN_CENTER' -or
     $request.seats -ne 1 -or $request.featureIds[0] -ne 'WORKSPACE'){
    throw 'CENTER_LICENSE_ORIGINAL_ADMIN_UNSIGNED_REQUEST_INVALID'
  }
  $requestId=[string]$request.requestId
  $checks.Add('ADMIN_CENTER_UNSIGNED_REQUEST_EXPORTED_VIA_NATIVE_GUI')
  $pub=Start-App $publisherPath
  Press $pub 'Доверие и ключи'
  Select-Last $pub 'Полномочие издателя'
  Native-FileDialog $pub 'Открыть запрос Admin Center' $requestFile $true
  Wait-Text $pub $requestId
  Press $pub 'Подписать запрос Admin Center в T3'
  Wait-Text $pub 'Запрос Admin Center подписан исходным T3'
  $inventory=Owner-Inventory
  if(@($inventory.licenses).Count -ne 1 -or
     $inventory.licenses[0].requestId -ne $requestId -or
     $inventory.licenses[0].organizationId -ne $organizationId -or
     $inventory.licenses[0].claimedSeats -ne 1){
    throw 'CENTER_LICENSE_ORIGINAL_OWNER_ADMIN_REQUEST_READBACK_MISMATCH'
  }
  $id=[string]$inventory.licenses[0].licenseId
  $checks.Add('PUBLISHER_ADMIN_REQUEST_SIGNED_BY_ORIGINAL_T3')
  Select-Last $pub 'Лицензия'
  Select-FirstReal $pub 'Новый TEST-статус'
  Press $pub 'Изменить статус' $true
  Confirm-Status $id 'ACTIVE'
  Wait-Text $pub 'Новый подписанный TEST-статус сохранён в T3: ACTIVE'
  Native-FileDialog $pub 'Экспортировать подписанный .iwxa' $active $false
  $checks.Add('PUBLISHER_SIGNED_ACTIVE_EXPORTED_VIA_NATIVE_DIALOG')
  Press $cen 'Personal Agent и лицензии'
  Native-FileDialog $cen 'Проверить и сохранить через T3' $active $true
  Wait-Text $cen 'Подпись T3 проверена'
  Wait-Text $cen 'Коммерческих мест: 0'
  $checks.Add('CENTER_SIGNED_TEST_LICENSE_VERIFIED_AND_READBACK')
  Stop-App $cen
  $cen=Start-App $centerPath
  Press $cen 'Personal Agent и лицензии'
  Wait-Text $cen 'ACTIVE'
  $checks.Add('CENTER_ACTIVE_SURVIVES_RESTART')
  Select-Last $pub 'Новый TEST-статус'
  Press $pub 'Изменить статус' $true
  Confirm-Status $id 'REVOKED'
  Wait-Text $pub 'Новый подписанный TEST-статус сохранён в T3: REVOKED'
  Native-FileDialog $pub 'Экспортировать подписанный .iwxa' $revoked $false
  Native-FileDialog $cen 'Проверить и сохранить через T3' $revoked $true
  Wait-Text $cen 'REVOKED'
  $checks.Add('CENTER_REVOKED_SIGNATURE_RECEIVED')
  Stop-App $cen
  $cen=Start-App $centerPath
  Press $cen 'Personal Agent и лицензии'
  Wait-Text $cen 'REVOKED'
  Native-FileDialog $cen 'Проверить и сохранить через T3' $active $true
  Wait-Text $cen 'PRODUCT_STATUS_ROLLBACK_DENIED'
  Wait-Text $cen 'REVOKED'
  $checks.Add('CENTER_REVOKE_DURABLE_AND_OLD_ACTIVE_REPLAY_DENIED')
  $report=[ordered]@{
    schema='IWXA_CENTER_TWO_INSTALLED_TEST_LICENSE_ACCEPTANCE/1'
    status='PASS_SIGNED_TEST_TWO_NATIVE_DESKTOPS'
    checks=@($checks.ToArray())
    source='CENTER_PUBLIC_PRODUCT_ACCEPTANCE_TEST'
    publisherSha256=(Get-FileHash -LiteralPath $publisherPath -Algorithm SHA256).Hash
    centerSha256=(Get-FileHash -LiteralPath $centerPath -Algorithm SHA256).Hash
    ownerComponentSha256=(Get-FileHash -LiteralPath $ownerPath -Algorithm SHA256).Hash
    consumerComponentSha256=(Get-FileHash -LiteralPath $consumerPath -Algorithm SHA256).Hash
    commercialAuthorityProven=$false
    licensedSeats=0
    productionActivation=$false
    humanAcceptance=$false
  }
  $report|ConvertTo-Json -Depth 10|
    Set-Content -LiteralPath (Join-Path $artifact 'result.json') -Encoding UTF8
  Write-Host "CENTER_TWO_INSTALLED_NATIVE_TEST_LICENSE_PASS steps=$($checks.Count)"
}catch{
  Write-Host "CENTER_TWO_INSTALLED_NATIVE_TEST_LICENSE_FAIL $($_.Exception.Message)"
  throw
}finally{
  foreach($p in @($cen,$pub)){
    if($null -eq $p){continue}
    try{Stop-App $p}catch{
      $p.Refresh()
      if(!$p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
    }
  }
}
