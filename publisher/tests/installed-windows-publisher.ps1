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
function Capture-Installed-Desktop([string]$name){
  # Screenshot of the actual installed Tauri EXE, not a browser preview.
  $folder='artifacts/publisher-setupcore'
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  $window=(Root-Element).Current.BoundingRectangle
  $monitor=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  if($window.IsEmpty){throw 'PUBLISHER_INSTALLED_NATIVE_WINDOW_BOUNDS_EMPTY'}
  $left=[int][Math]::Max($monitor.Left,[Math]::Floor($window.Left))
  $top=[int][Math]::Max($monitor.Top,[Math]::Floor($window.Top))
  $right=[int][Math]::Min($monitor.Right,[Math]::Ceiling($window.Right))
  $bottom=[int][Math]::Min($monitor.Bottom,[Math]::Ceiling($window.Bottom))
  $width=$right-$left
  $height=$bottom-$top
  if($width -lt 500 -or $height -lt 350){throw 'PUBLISHER_INSTALLED_NATIVE_WINDOW_TOO_SMALL'}
  $bitmap=New-Object System.Drawing.Bitmap($width,$height)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen([System.Drawing.Point]::new($left,$top),
      [System.Drawing.Point]::Empty,[System.Drawing.Size]::new($width,$height))
    $target=Join-Path $folder $name
    $bitmap.Save($target,[System.Drawing.Imaging.ImageFormat]::Png)
    if((Get-Item -LiteralPath $target).Length -lt 1000){throw "PUBLISHER_INSTALLED_SCREENSHOT_TOO_SMALL $name"}
    Write-Host "PUBLISHER_INSTALLED_DESKTOP_SCREENSHOT_PASS name=$name"
  } finally {$graphics.Dispose();$bitmap.Dispose()}
}
function Root-Element {
  # The second Win32 file picker may temporarily detach MainWindowHandle.
  # Determine whether the process truly exited before declaring the GUI lost.
  for($i=0;$i -lt 60;$i++){
    $proc.Refresh()
    if($proc.HasExited){
      throw "PUBLISHER_PROCESS_EXITED_DURING_NATIVE_DIALOG exitCode=$($proc.ExitCode)"
    }
    if($proc.MainWindowHandle -ne [IntPtr]::Zero){
      try {
        return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
      } catch {}
    }
    $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($candidate in $windows){
      try {
        if($candidate.Current.ProcessId -eq $proc.Id -and
           $candidate.Current.Name.StartsWith('IWXA Publisher') -and
           $candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window){
          Write-Host 'PUBLISHER_NATIVE_WINDOW_RECOVERED_BY_PROCESS_ID'
          return $candidate
        }
      } catch {}
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'PUBLISHER_NATIVE_WINDOW_HANDLE_NOT_AVAILABLE_AFTER_FILE_DIALOG'
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

  # A real installed WebView can fail before the React shell mounts. Classify
  # this separately from changed UIA labels instead of hiding a white window.
  if($name -eq 'Продукты' -and $kind -eq 'Button'){
    $nodes=(Root-Element).FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $names=@()
    foreach($node in $nodes){
      try {if($node.Current.Name){$names+=($node.Current.Name)}} catch {}
    }
    if($names -match 'Загрузка интерфейса'){
      throw 'PUBLISHER_NATIVE_RENDERER_NOT_READY_STARTUP_FALLBACK_VISIBLE'
    }
    if($names -match 'Не удалось открыть интерфейс Publisher'){
      throw 'PUBLISHER_NATIVE_REACT_RENDER_FAILED'
    }
    if(@($names).Count -le 2){
      throw 'PUBLISHER_NATIVE_BLANK_WEBVIEW_NO_ACCESSIBLE_CONTENT'
    }
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

function Use-Json-Through-Publisher-Dialog([string]$buttonName,[string]$destination,[bool]$existing) {
  if((Test-Path -LiteralPath $destination -PathType Leaf) -ne $existing){
    throw "PUBLISHER_FILE_DIALOG_EXPECTED_EXISTS_$existing"
  }
  if($buttonName){Click-Publisher $buttonName}
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
  if($existing){return}
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
  [void](Find-Control 'Продукты' 'Button')
  $nativeTitle=(Root-Element).Current.Name
  if(!$nativeTitle -or !$nativeTitle.Contains('IWXA Publisher')){throw "PUBLISHER_INSTALLED_NATIVE_WINDOW_TITLE_INVALID title=$nativeTitle"}
  Write-Host "PUBLISHER_INSTALLED_NATIVE_WINDOW_PASS title=$nativeTitle"
  Capture-Installed-Desktop 'publisher-desktop-first-launch.png'
  # Three independent installed-process starts with optional fresh WebView2
  # profiles. Always check visible native controls and unchanged user drafts.
  $previousWebviewFolder=[Environment]::GetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER','Process')
  $draftHashBefore=if(Test-Path -LiteralPath $data -PathType Leaf){(Get-FileHash -LiteralPath $data -Algorithm SHA256).Hash}else{''}
  try {
    for($cycle=1;$cycle -le 3;$cycle++){
      Close-Publisher
      $freshProfile=Join-Path $env:TEMP ("iwxa-publisher-cold-"+[guid]::NewGuid().ToString('N'))
      [Environment]::SetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER',$freshProfile,'Process')
      Start-Publisher
      [void](Find-Control 'Продукты' 'Button')
      [void](Find-Control 'Лицензии' 'Button')
      $draftHashAfter=if(Test-Path -LiteralPath $data -PathType Leaf){(Get-FileHash -LiteralPath $data -Algorithm SHA256).Hash}else{''}
      if($draftHashBefore -ne $draftHashAfter){throw 'PUBLISHER_COLD_LAUNCH_CHANGED_DRAFT_DATA'}
      if(Test-Path -LiteralPath $freshProfile -PathType Container){
        Write-Host "PUBLISHER_COLD_WEBVIEW_PROFILE_CREATED cycle=$cycle"
      }else{
        Write-Host "PUBLISHER_COLD_WEBVIEW_OVERRIDE_NOT_OBSERVED cycle=$cycle"
      }
      Write-Host "PUBLISHER_INSTALLED_COLD_PROCESS_LAUNCH_PASS cycle=$cycle"
      Capture-Installed-Desktop "publisher-cold-launch-$cycle.png"
    }
  } finally {
    [Environment]::SetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER',$previousWebviewFolder,'Process')
  }
  Click-Publisher 'Продукты'
  Enter-Value 'Идентификатор продукта' 'IWXA_ADMIN_CENTER'
  Enter-Value 'Название' 'PublisherInstalledTest'
  Enter-Value 'Версия' '0.2.0'
  Click-Publisher 'Сохранить продукт'
  [void](Find-Text 'PublisherInstalledTest')
  Click-Publisher 'Тарифы и лимиты'
  Enter-Value 'Код тарифа' 'TEAM_START'
  Enter-Value 'Название тарифа' 'Команда'
  Enter-Value 'Функции и модули' 'WORKSPACE,REVIEW'
  Click-Publisher 'Сохранить редакцию тарифа'
  $tariffSaved=$false
  for($i=0;$i -lt 60;$i++){
    if(Test-Path -LiteralPath $data){
      try{
        $record=Get-Content -LiteralPath $data -Raw|ConvertFrom-Json -Depth 50
        if($record.version -eq 2 -and @($record.tariffs).Count -eq 1 -and
           $record.tariffs[0].id -eq 'TEAM_START' -and
           $record.tariffs[0].revision -eq 1 -and
           $record.tariffs[0].productSeats -eq 5 -and
           $record.tariffs[0].employeeLimit -eq 10 -and
           $record.tariffs[0].deviceLimit -eq 0){
          $tariffSaved=$true;break
        }
      }catch{}
    }
    Start-Sleep -Milliseconds 300
  }
  if(!$tariffSaved){throw 'PUBLISHER_NATIVE_TARIFF_REVISION_NOT_PERSISTED'}
  Write-Host 'PUBLISHER_INSTALLED_NATIVE_TARIFF_REVISION_PASS'
  Click-Publisher 'Клиенты'
  Enter-Value 'Идентификатор клиента' '11111111-1111-4111-8111-111111111111'
  Enter-Value 'Название / имя' 'PublisherInstalledTestOrg'
  Click-Publisher 'Сохранить клиента'
  # The holder's list row is below the viewport at 900px; assert the real
  # persisted native JSON below rather than requiring an onscreen row here.
  [void](Find-Control 'Сохранить клиента' 'Button')
  Click-Publisher 'Лицензии'
  Click-Publisher 'Открыть TEST-запрос'
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
  Use-Json-Through-Publisher-Dialog 'Подготовить TEST-запрос' $testRequest $false
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
  Click-Publisher 'Клиенты'
  [void](Find-Control 'Сохранить клиента' 'Button')
  Click-Publisher 'Лицензии'
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
  Use-Json-Through-Publisher-Dialog 'Сохранить копию черновиков' $backup $false
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
  Click-Publisher 'Лицензии'
  Click-Publisher 'Удалить'
  $removed=$false
  for($i=0;$i -lt 60;$i++){
    try{
      $current=Get-Content -LiteralPath $data -Raw -Encoding utf8|ConvertFrom-Json -Depth 50
      if(@($current.proposals).Count -eq 0){$removed=$true;break}
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  if(!$removed){throw 'PUBLISHER_GUI_DELETE_DID_NOT_PERSIST'}
  Write-Host 'PUBLISHER_INSTALLED_GUI_DRAFT_REMOVED_BEFORE_RESTORE_PASS'
  Click-Publisher 'Обзор'
  Use-Json-Through-Publisher-Dialog 'Восстановить черновики' $backup $true
  [void](Find-Control 'Отмена восстановления' 'Button')
  Click-Publisher 'Отмена восстановления'
  $afterCancel=Get-Content -LiteralPath $data -Raw -Encoding utf8|ConvertFrom-Json -Depth 50
  if(@($afterCancel.proposals).Count -ne 0){throw 'PUBLISHER_RESTORE_CANCEL_CHANGED_DRAFT'}
  Write-Host 'PUBLISHER_INSTALLED_GUI_RESTORE_CANCEL_PRESERVES_LIVE_PASS'
  Use-Json-Through-Publisher-Dialog 'Восстановить черновики' $backup $true
  [void](Find-Control 'Заменить текущие черновики' 'Button')
  Click-Publisher 'Заменить текущие черновики'
  $restored=$null
  for($i=0;$i -lt 60;$i++){
    try{
      $candidate=Get-Content -LiteralPath $data -Raw -Encoding utf8|ConvertFrom-Json -Depth 50
      if(@($candidate.proposals).Count -eq 1 -and $candidate.proposals[0].id -eq $proposalId){
        $restored=$candidate;break
      }
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  if(!$restored){throw 'PUBLISHER_GUI_RESTORE_EXACT_PROPOSAL_NOT_PERSISTED'}
  Write-Host 'PUBLISHER_INSTALLED_GUI_NATIVE_BACKUP_RESTORE_PASS'
  Close-Publisher
  Start-Publisher
  $reloaded=Get-Content -LiteralPath $data -Raw -Encoding utf8|ConvertFrom-Json -Depth 50
  if(@($reloaded.proposals).Count -ne 1 -or $reloaded.proposals[0].id -ne $proposalId){
    throw 'PUBLISHER_BACKUP_RESTORE_LOST_AFTER_RESTART'
  }
  Write-Host 'PUBLISHER_INSTALLED_GUI_BACKUP_RESTORE_RESTART_PASS'
  Click-Publisher 'Обзор'
  Capture-Installed-Desktop 'publisher-desktop-after-restore.png'
  # PUB25: test two user-selected real file copies through installed Tauri
  # dialogs, without claiming trusted mirrors or a signed release.
  $copyBase=Join-Path ([IO.Path]::GetFullPath('artifacts/publisher-setupcore')) 'two-copy-input'
  $directoryOne=Join-Path $copyBase 'copy-a'
  $directoryTwo=Join-Path $copyBase 'copy-b'
  New-Item -ItemType Directory -Force -Path $directoryOne,$directoryTwo|Out-Null
  $copyOne=Join-Path $directoryOne 'publisher-check.exe'
  $copyTwo=Join-Path $directoryTwo 'publisher-check.exe'
  Copy-Item -LiteralPath $exe -Destination $copyOne
  Copy-Item -LiteralPath $exe -Destination $copyTwo
  if((Get-FileHash -LiteralPath $copyOne -Algorithm SHA256).Hash -ne
     (Get-FileHash -LiteralPath $copyTwo -Algorithm SHA256).Hash){
    throw 'PUBLISHER_TWO_TEST_FILES_ARE_NOT_IDENTICAL'
  }
  Click-Publisher 'Релизы'
  Use-Json-Through-Publisher-Dialog 'Сверить две копии файла' $copyOne $true
  Start-Sleep -Milliseconds 600
  Use-Json-Through-Publisher-Dialog '' $copyTwo $true
  $proc.Refresh()
  if($proc.HasExited){
    throw "PUBLISHER_PROCESS_EXITED_AFTER_SECOND_COPY_DIALOG exitCode=$($proc.ExitCode)"
  }
  Write-Host 'PUBLISHER_SECOND_COPY_DIALOG_RETURNED_PROCESS_ALIVE'
  [void](Find-Text 'Сверены 2 файла')
  [void](Find-Text 'Независимость физических носителей не подтверждена')
  Write-Host 'PUBLISHER_INSTALLED_GUI_TWO_SELECTED_FILES_BYTE_MATCH_PASS'
  Capture-Installed-Desktop 'publisher-desktop-two-copies.png'
  # PUB23: installed native .iwxa file transport only. The bytes below are
  # deliberately NOT a signed license, so the user interface must never
  # claim signature verification, issuer authority or effective seats.
  $inputIwxa=Join-Path ([IO.Path]::GetFullPath('artifacts/publisher-setupcore')) 'transport-unverified.iwxa'
  $outputIwxa=Join-Path ([IO.Path]::GetFullPath('artifacts/publisher-setupcore')) 'transport-copied.iwxa'
  $opaque=[byte[]]@(0x50,0x4b,0x03,0x04,0x00,0x00,0x00,0x00,0x54,0x45,0x53,0x54,0x2d,0x4e,0x4f,0x54,0x2d,0x53,0x49,0x47,0x4e,0x45,0x44)
  [System.IO.File]::WriteAllBytes($inputIwxa,$opaque)
  if(Test-Path -LiteralPath $outputIwxa){Remove-Item -LiteralPath $outputIwxa -Force}
  Click-Publisher 'Доверие и ключи'
  Use-Json-Through-Publisher-Dialog 'Открыть пакет .iwxa' $inputIwxa $true
  [void](Find-Text 'Подтверждённых мест: 0')
  [void](Find-Text 'Подлинность и статус не проверены')
  Write-Host 'PUBLISHER_INSTALLED_UNVERIFIED_IWXA_PREVIEW_ZERO_SEATS_PASS'
  Use-Json-Through-Publisher-Dialog 'Экспортировать .iwxa' $outputIwxa $false
  $hashBefore=(Get-FileHash -LiteralPath $inputIwxa -Algorithm SHA256).Hash
  $hashAfter=(Get-FileHash -LiteralPath $outputIwxa -Algorithm SHA256).Hash
  if($hashBefore -ne $hashAfter){throw 'PUBLISHER_INSTALLED_IWXA_TRANSPORT_CHANGED_BYTES'}
  Write-Host "PUBLISHER_INSTALLED_IWXA_BYTE_EXACT_TRANSFER_PASS sha256=$hashAfter"
  Capture-Installed-Desktop 'publisher-desktop-iwxa-transfer.png'
   # Exercise new tariff proposal only after the legacy request, backup, and
   # exact .iwxa transport have been independently verified.
   Click-Publisher 'Лицензии'
   Click-Publisher 'Сохранить подготовку по тарифу'
   $offer=$null
   for($i=0;$i -lt 60;$i++){
     try{
       $record=Get-Content -LiteralPath $data -Raw|ConvertFrom-Json -Depth 50
       if(@($record.proposals).Count -eq 2 -and $record.proposals[1].tariffSnapshot.id -eq 'TEAM_START'){
         $offer=$record.proposals[1];break
       }
     }catch{}
     Start-Sleep -Milliseconds 300
   }
   if(!$offer){throw 'PUBLISHER_NATIVE_TARIFF_SNAPSHOT_NOT_WRITTEN'}
   if($offer.tariffSnapshot.productSeats -ne 5 -or
      $offer.tariffSnapshot.employeeLimit -ne 10 -or
      $offer.tariffSnapshot.deviceLimit -ne 0 -or
      $offer.productVersion -ne '0.2.0' -or $offer.status -ne 'DRAFT_NOT_ISSUED'){
     throw 'PUBLISHER_NATIVE_TARIFF_SNAPSHOT_CHANGED_OR_GRANTED'
   }
   Write-Host 'PUBLISHER_INSTALLED_NATIVE_TARIFF_PROPOSAL_NO_LICENSE_PASS'
   Capture-Installed-Desktop 'publisher-desktop-tariff-draft.png'
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
