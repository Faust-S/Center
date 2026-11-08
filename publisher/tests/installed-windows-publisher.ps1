$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PublisherWindow {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extraInfo);
}
'@
$exe=if($env:IWXA_PUBLISHER_INSTALLED_EXE){$env:IWXA_PUBLISHER_INSTALLED_EXE}else{Join-Path $env:LOCALAPPDATA 'IWXA Publisher\iwxa-publisher.exe'}
$data=Join-Path $env:LOCALAPPDATA 'ru.iwxa.publisher\publisher-preparation-v1.json'
$proc=$null
function Start-Publisher {
  $script:proc=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
  for($i=0;$i -lt 80;$i++){
    Start-Sleep -Milliseconds 350
    $proc.Refresh()
    if($proc.HasExited){throw 'Installed Publisher exited before showing GUI'}
    if($proc.MainWindowHandle -ne [IntPtr]::Zero){return}
  }
  throw 'Installed Publisher did not expose a native window'
}
function Root-Element {
  $proc.Refresh()
  return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
}
function Find-Control([string]$name,[string]$kind){
  $expected=if($kind -eq 'Edit'){[System.Windows.Automation.ControlType]::Edit}else{[System.Windows.Automation.ControlType]::Button}
  $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
  for($i=0;$i -lt 60;$i++){
    $nodes=(Root-Element).FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
    foreach($node in $nodes){
      try { if($node.Current.ControlType -eq $expected){return $node} }catch{}
    }
    Start-Sleep -Milliseconds 300
  }
  throw "Installed Publisher UIA control missing: $kind $name"
}
function Click-Publisher([string]$name){
  Write-Host "PUBLISHER_GUI_CLICK $name"
  $node=Find-Control $name 'Button'
  try {
    $node.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  } catch {
    $b=$node.Current.BoundingRectangle
    if($b.IsEmpty){throw "Installed Publisher button is not clickable: $name"}
    [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
      [int]($b.Left+$b.Width/2),[int]($b.Top+$b.Height/2))
    [PublisherWindow]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [PublisherWindow]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  }
  Start-Sleep -Milliseconds 300
}
function Enter-Value([string]$name,[string]$value){
  Write-Host "PUBLISHER_GUI_ENTER $name"
  $node=Find-Control $name 'Edit'
  $node.SetFocus()
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait($value)
  Start-Sleep -Milliseconds 150
}
function Find-Text([string]$piece) {
  for($i=0;$i -lt 60;$i++) {
    $nodes=(Root-Element).FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($node in $nodes) {
      try {
        # WebView2 may expose a status region as Group, Text or an offscreen
        # accessibility node; do not equate viewport clipping with lost data.
        # The separate browser test verifies actual viewport visibility.
        if($node.Current.Name.Contains($piece)){return $node}
      } catch {}
    }
    Start-Sleep -Milliseconds 300
  }
  throw "Publisher installed GUI accessible text missing: $piece"
}

function Save-Json-Through-Publisher-Dialog([string]$buttonName,[string]$destination) {
  if(Test-Path -LiteralPath $destination){throw 'PUBLISHER_SAVE_EXPECTED_NEW_DESTINATION'}
  Click-Publisher $buttonName
  $dialog=$null
  for($i=0;$i -lt 60;$i++){
    $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($window in $windows){
      try {
        if($window.Current.ProcessId -eq $proc.Id -and
           $window.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
           $window.Current.NativeWindowHandle -ne $proc.MainWindowHandle){
          $dialog=$window;break
        }
      } catch {}
    }
    if($dialog){break}
    Start-Sleep -Milliseconds 200
  }
  if(!$dialog){throw "PUBLISHER_NATIVE_SAVE_DIALOG_MISSING button=$buttonName"}
  Write-Host "PUBLISHER_NATIVE_SAVE_DIALOG_PASS button=$buttonName"
  # The native Save As dialog is already foreground and its filename input
  # is selected. Window.SetFocus() fails for this COM-owned dialog on CI.
  # Use the filename mnemonic, not focus on the dialog/root AutomationElement.
  [System.Windows.Forms.SendKeys]::SendWait('%n')
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait($destination)
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  for($i=0;$i -lt 60;$i++){
    if(Test-Path -LiteralPath $destination -PathType Leaf){return}
    Start-Sleep -Milliseconds 250
  }
  throw "PUBLISHER_NATIVE_FILE_SAVE_NOT_WRITTEN button=$buttonName"
}
function Close-Publisher {
  $proc.Refresh()
  if(!$proc.HasExited) {
    if(![PublisherWindow]::PostMessage($proc.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Publisher WM_CLOSE failed'}
    if(!$proc.WaitForExit(12000)){throw 'Publisher did not close'}
  }
  Write-Host "PUBLISHER_NATIVE_CLOSE_PASS"
}
try {
  if($env:IWXA_PUBLISHER_ALREADY_INSTALLED -ne '1') {
    $installer=Get-ChildItem 'publisher/src-tauri/target/release/bundle/nsis/*.exe'|Select-Object -First 1
    if(!$installer){throw 'Publisher NSIS installer absent'}
    $install=Start-Process -FilePath $installer.FullName -ArgumentList '/S' -PassThru
    if(!$install.WaitForExit(120000)){throw 'Publisher installation timed out'}
    if($install.ExitCode -ne 0){throw "Publisher installer exit $($install.ExitCode)"}
  }
  if(!(Test-Path -LiteralPath $exe)){throw "Installed Publisher exe missing: $exe"}
  Write-Host "PUBLISHER_INSTALLED_EXE_PASS sha256=$((Get-FileHash $exe -Algorithm SHA256).Hash)"
  Start-Publisher
  Click-Publisher 'Продукты'
  Enter-Value 'Идентификатор продукта' 'IWXA_ADMIN_CENTER'
  Enter-Value 'Название' 'PublisherInstalledTest'
  Enter-Value 'Версия' '0.2.0'
  Click-Publisher 'Сохранить продукт'
  [void](Find-Text 'PublisherInstalledTest')
  Click-Publisher 'Получатели'
  Enter-Value 'Идентификатор субъекта' '11111111-1111-4111-8111-111111111111'
  Enter-Value 'Название / имя' 'PublisherInstalledTestOrg'
  Click-Publisher 'Сохранить получателя'
  # The holder's list row is below the viewport at 900px; assert the real
  # persisted native JSON below rather than requiring an onscreen row here.
  [void](Find-Control 'Сохранить получателя' 'Button')
  Click-Publisher 'Запросы на лицензии'
  Enter-Value 'Функции (коды через запятую)' 'WORKSPACE,REVIEW'
  Click-Publisher 'Сохранить запрос'
  $readback=$null
  for($i=0;$i -lt 60;$i++) {
    if(Test-Path -LiteralPath $data){
      try{
        $candidate=Get-Content -LiteralPath $data -Raw|ConvertFrom-Json -Depth 50
        if(@($candidate.products).Count -eq 1 -and
           @($candidate.holders).Count -eq 1 -and
           @($candidate.proposals).Count -eq 1){
          $readback=$candidate;break
        }
      }catch{}
    }
    Start-Sleep -Milliseconds 350
  }
  if(!$readback){throw 'Publisher GUI did not persist native preparation draft'}
  if($readback.products[0].id -ne 'IWXA_ADMIN_CENTER' -or
     $readback.holders[0].id -ne '11111111-1111-4111-8111-111111111111' -or
     $readback.holders[0].type -ne 'ORGANIZATION' -or
     $readback.proposals[0].productId -ne 'IWXA_ADMIN_CENTER' -or
     $readback.proposals[0].holderId -ne $readback.holders[0].id -or
     $readback.proposals[0].status -ne 'DRAFT_NOT_ISSUED' -or
     ((@($readback.proposals[0].features) -join ',') -ne 'WORKSPACE,REVIEW')){
    throw 'Publisher installed organization and unsigned proposal mismatch'
  }
  $proposalId=[string]$readback.proposals[0].id
  Write-Host 'PUBLISHER_INSTALLED_GUI_NATIVE_DRAFT_WRITE_PASS'
  Write-Host 'PUBLISHER_INSTALLED_GUI_ORG_PROPOSAL_READBACK_PASS'
  Click-Publisher 'Моделировать TEST-ответ'
  [void](Find-Text 'Действительных лицензированных мест: 0')
  Write-Host 'PUBLISHER_INSTALLED_GUI_SIMULATION_ZERO_ACTIVE_PASS'
  $testRequest=Join-Path ([IO.Path]::GetFullPath('artifacts/publisher-setupcore')) 'native-unsigned-test-request.json'
  Save-Json-Through-Publisher-Dialog 'Подготовить TEST-запрос' $testRequest
  $exported=Get-Content -LiteralPath $testRequest -Raw -Encoding utf8|ConvertFrom-Json -Depth 50
  if($exported.requestId -ne $proposalId -or $exported.kind -ne 'TEST_LICENSE_REQUEST' -or
     $exported.status -ne 'UNSIGNED_REQUEST' -or $exported.environment -ne 'TEST' -or
     $exported.subject.id -ne '11111111-1111-4111-8111-111111111111' -or
     $exported.product.id -ne 'IWXA_ADMIN_CENTER' -or
     $exported.seats -ne 1 -or ((@($exported.featureIds) -join ',') -ne 'WORKSPACE,REVIEW') -or
     $exported.PSObject.Properties.Name -contains 'licenseId' -or
     $exported.PSObject.Properties.Name -contains 'signature'){
    throw 'PUBLISHER_NATIVE_TEST_REQUEST_IS_NOT_EXACT_UNSIGNED_REQUEST'
  }
  Write-Host 'PUBLISHER_INSTALLED_GUI_UNSIGNED_TEST_REQUEST_EXPORT_PASS'
  Close-Publisher
  Start-Publisher
  Click-Publisher 'Продукты'
  [void](Find-Text 'PublisherInstalledTest')
  Click-Publisher 'Получатели'
  [void](Find-Control 'Сохранить получателя' 'Button')
  Click-Publisher 'Запросы на лицензии'
  [void](Find-Control 'Моделировать TEST-ответ' 'Button')
  if(!(Test-Path -LiteralPath $data)){throw 'Publisher preparation disappeared after native restart'}
  $again=Get-Content -LiteralPath $data -Raw|ConvertFrom-Json -Depth 50
  if(@($again.products).Count -ne 1 -or $again.products[0].name -ne 'PublisherInstalledTest' -or
     @($again.holders).Count -ne 1 -or $again.holders[0].name -ne 'PublisherInstalledTestOrg' -or
     @($again.proposals).Count -ne 1 -or $again.proposals[0].id -ne $proposalId -or
     $again.proposals[0].status -ne 'DRAFT_NOT_ISSUED'){
    throw 'Publisher preparation and unsigned proposal readback mismatch after relaunch'
  }
  Write-Host 'PUBLISHER_INSTALLED_GUI_RESTART_READBACK_PASS'
  $backup=Join-Path ([IO.Path]::GetFullPath('artifacts/publisher-setupcore')) 'installed-preparation-backup.json'
  Click-Publisher 'Обзор'
  Save-Json-Through-Publisher-Dialog 'Сохранить копию черновиков' $backup
  $copy=Get-Content -LiteralPath $backup -Raw -Encoding utf8
  $live=Get-Content -LiteralPath $data -Raw -Encoding utf8
  if($copy -cne $live){throw 'PUBLISHER_NATIVE_BACKUP_EXACT_READBACK_MISMATCH'}
  $backupValue=$copy|ConvertFrom-Json -Depth 50
  if($backupValue.proposals[0].id -ne $proposalId -or
     $backupValue.proposals[0].status -ne 'DRAFT_NOT_ISSUED' -or
     @($backupValue.holders).Count -ne 1){
    throw 'PUBLISHER_NATIVE_BACKUP_REQUEST_BINDING_INVALID'
  }
  Write-Host 'PUBLISHER_INSTALLED_GUI_NATIVE_BACKUP_EXPORT_PASS'
} catch {
  Write-Host "PUBLISHER_INSTALLED_GUI_PRIMARY_FAILURE $($_.Exception.Message)"
  try {
    $folder='artifacts/publisher-setupcore'
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $rect=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap=New-Object System.Drawing.Bitmap($rect.Width,$rect.Height)
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($rect.Location,[System.Drawing.Point]::Empty,$rect.Size)
      $bitmap.Save((Join-Path $folder 'gui-failure.png'),[System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host 'PUBLISHER_GUI_FAILURE_SCREENSHOT_CAPTURED'
    } finally {$graphics.Dispose();$bitmap.Dispose()}
  } catch {Write-Host "PUBLISHER_GUI_FAILURE_SCREENSHOT_UNAVAILABLE $($_.Exception.Message)"}
  throw
} finally {
  if($proc -and !$proc.HasExited){
    try{Close-Publisher}catch{Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
  }
}
