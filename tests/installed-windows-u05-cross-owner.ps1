# U05: observe the same on-disk Atlas Desktop owner project from an actual
# separately installed Center GUI, without copying or rewriting its store.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class U05Window {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr wParam,IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extraInfo);
}
'@
$atlas=Join-Path $env:LOCALAPPDATA 'ru.iwxa.atlas/atlas-store-v1'
$center=Join-Path $env:LOCALAPPDATA 'Programs/IWXA Admin Center/iwxa-admin-center.exe'
$centerDraft=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/atlas-store-v1/preparation/draft.json'
$artifact=Join-Path $env:GITHUB_WORKSPACE 'artifacts/u05-two-installed-result.json'
$manifest=Join-Path $atlas 'head.json'
if(!(Test-Path -LiteralPath $manifest)){throw 'U05_REAL_ATLAS_DESKTOP_STORE_NOT_FOUND'}
if(!(Test-Path -LiteralPath $center)){throw 'U05_INSTALLED_CENTER_NOT_FOUND'}
$head=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json -Depth 100
if(@($head.projects).Count -lt 1 -or [long]$head.revision -lt 2){
  throw 'U05_ATLAS_INSTALLED_GUI_DID_NOT_CREATE_PROJECT_WORK'
}
$projectBlock=$null
foreach($b in @($head.projects)){
  if([string]$b.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'U05_ATLAS_BLOCK_REF_INVALID'}
  $candidate=Join-Path (Join-Path $atlas 'blocks') ("$($b.sha256).json")
  $source=Get-Content -LiteralPath $candidate -Raw|ConvertFrom-Json -Depth 100
  if([string]$source.id -ne [string]$b.id){throw 'U05_CANONICAL_BLOCK_ID_MISMATCH'}
  if(@($source.items).Count -gt 0){$projectBlock=$source;break}
}
if(!$projectBlock){throw 'U05_ATLAS_GUI_WORK_NOT_PERSISTED'}
$projectId=[string]$projectBlock.id
$projectTitle=[string]$projectBlock.name
$workId=[string]$projectBlock.items[0].id
$workTitle=[string]$projectBlock.items[0].title
if(@($projectBlock.items).Count -lt 2){throw 'U04_WORK_REF_SWITCH_NEEDS_TWO_CANONICAL_WORKS'}
$revision=[string]$head.revision
$generation=[string]$head.generation
$beforeBytes=[System.IO.File]::ReadAllBytes($manifest)
$beforeHash=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($beforeBytes))
$proc=$null

function Root {
  $proc.Refresh()
  if($proc.HasExited){throw 'U05_CENTER_EXITED_UNEXPECTEDLY'}
  if($proc.MainWindowHandle -eq [IntPtr]::Zero){throw 'U05_CENTER_WINDOW_NOT_READY'}
  return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
}
function Find-UI([string]$name,[string]$type='Button',[bool]$contains=$false) {
  for($i=0;$i -lt 75;$i++){
    $element=Root
    $items=$element.FindAll([System.Windows.Automation.TreeScope]::Descendants,
       [System.Windows.Automation.Condition]::TrueCondition)
    foreach($c in $items){
      try{
        $n=[string]$c.Current.Name
        $kind=$c.Current.ControlType.ProgrammaticName
        if($kind -ne "ControlType.$type"){continue}
        if(($contains -and $n.Contains($name)) -or (!$contains -and $n -eq $name)){return $c}
      }catch{}
    }
    Start-Sleep -Milliseconds 300
  }
  throw "U05_CENTER_UI_CONTROL_MISSING $type $name"
}
function Find-UI-Text([string]$needle) {
  for($attempt=0;$attempt -lt 75;$attempt++){
    $root=Root
    $controls=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($control in $controls){
      try{
        if(([string]$control.Current.Name).Contains($needle)){return $control}
      }catch{}
    }
    Start-Sleep -Milliseconds 300
  }
  throw "U05_UI_TEXT_NOT_FOUND $needle"
}
function Click([string]$name,[bool]$contains=$false) {
  $button=Find-UI $name 'Button' $contains
  try{$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()}
  catch{$button.SetFocus();[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')}
  Start-Sleep -Milliseconds 350
}
# A genuine pointer event is necessary for foreground activation on Windows.
# UIA InvokePattern triggers a button programmatically but does not establish
# recent user input for the Center process. Do not call SetForegroundWindow
# from the acceptance script: the original U04 must actually do the focus.
function Click-Physical([string]$name) {
  $button=Find-UI $name 'Button'
  $bounds=$button.Current.BoundingRectangle
  if($bounds.IsEmpty -or $bounds.Width -lt 6 -or $bounds.Height -lt 6){
    throw "U04_GUI_BUTTON_NOT_VISIBLE $name"
  }
  $x=[int]($bounds.Left + $bounds.Width / 2)
  $y=[int]($bounds.Top + $bounds.Height / 2)
  [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new($x,$y)
  Start-Sleep -Milliseconds 100
  [U05Window]::mouse_event([uint32]0x0002,0,0,0,[UIntPtr]::Zero)
  [U05Window]::mouse_event([uint32]0x0004,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 350
}
function Text([string]$name,[string]$value) {
  $field=Find-UI $name 'Edit'
  $field.SetFocus();Start-Sleep -Milliseconds 130
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait($value)
  Start-Sleep -Milliseconds 200
}
function Shutdown {
  if($null -eq $proc){return}
  $proc.Refresh()
  if($proc.HasExited){return}
  if(![U05Window]::PostMessage($proc.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){
    throw 'U05_CENTER_GRACEFUL_CLOSE_FAILED'
  }
  if(!$proc.WaitForExit(9000)){throw 'U05_CENTER_CLOSE_TIMEOUT'}
  if($proc.ExitCode -ne 0){throw 'U05_CENTER_CLOSE_NONZERO'}
}
function Start-Center {
  $script:proc=Start-Process -FilePath $center -WorkingDirectory (Split-Path $center) -PassThru
  for($i=0;$i -lt 90;$i++){
    Start-Sleep -Milliseconds 350
    $script:proc.Refresh()
    if($script:proc.HasExited){throw 'U05_CENTER_LAUNCH_FAILED'}
    if($script:proc.MainWindowHandle -ne [IntPtr]::Zero){return}
  }
  throw 'U05_CENTER_MAIN_WINDOW_MISSING'
}
try {
  if($env:U05_VERIFY_STALE_AFTER_OWNER_CHANGE -eq '1') {
    if(!(Test-Path -LiteralPath $artifact)){throw 'U05_PREVIOUS_INSTALLED_LINK_RECEIPT_MISSING'}
    $initial=Get-Content -LiteralPath $artifact -Raw | ConvertFrom-Json -Depth 100
    if($initial.status -ne 'U05_TWO_INSTALLED_SAME_CANONICAL_SOURCE_PASS'){
      throw 'U05_PREVIOUS_INSTALLED_LINK_NOT_QUALIFIED'
    }
    if([string]$head.revision -le [long]$initial.sourceRevision -or
       [string]$head.generation -eq [string]$initial.sourceGeneration){
      throw 'U05_ATLAS_OWNER_REVISION_NOT_ADVANCED'
    }
    $originalId=[string]$initial.projectId
    $originalWorkId=[string]$initial.workId
    $originalRevision=[string]$initial.refRevision
    $originalProjectFound=$false
    foreach($entry in @($head.projects)){
      $block=Join-Path (Join-Path $atlas 'blocks') ("$($entry.sha256).json")
      $record=Get-Content -LiteralPath $block -Raw | ConvertFrom-Json -Depth 100
      if([string]$record.id -eq $originalId) {
        if(@($record.items | Where-Object { [string]$_.id -eq $originalWorkId }).Count -ne 1){
          throw 'U05_ORIGINAL_WORK_ID_DISAPPEARED_AFTER_ATLAS_EDIT'
        }
        $originalProjectFound=$true
      }
    }
    if(!$originalProjectFound){throw 'U05_ORIGINAL_PROJECT_DISAPPEARED_AFTER_ATLAS_EDIT'}
    $persisted=Get-Content -LiteralPath $centerDraft -Raw | ConvertFrom-Json -Depth 100
    $links=@($persisted.organizations | ForEach-Object {$_.assignments} |
       Where-Object { $_.title -eq 'U05PublicAtlasLinked' })
    if($links.Count -ne 1 -or
       [string]$links[0].atlasRef.projectId -ne $originalId -or
       [string]$links[0].atlasRef.workId -ne $originalWorkId -or
       [string]$links[0].atlasRef.revision -ne $originalRevision) {
      throw 'U05_CENTER_SILENTLY_REWROTE_OLD_WORK_REFERENCE'
    }
    $newManifestHash=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.IO.File]::ReadAllBytes($manifest)))
    if($newManifestHash -eq [string]$initial.atlasStoreManifestSha256){
      throw 'U05_ATLAS_GUI_NEW_REVISION_MANIFEST_NOT_CHANGED'
    }
    Start-Center
    Click 'Планы Atlas'
    Click 'Открыть Atlas Desktop'
    [void](Find-UI "U05AfterCenterLink" 'Button' $true)
    [void](Find-UI $projectTitle 'Button' $true)
    Click 'Поручения' $true
    Click 'U05PublicAtlasLinked' $true
    [void](Find-UI-Text 'План Atlas изменился')
    Click 'Закрыть редактор'
    Shutdown
    $still=Get-Content -LiteralPath $centerDraft -Raw | ConvertFrom-Json -Depth 100
    $post=@($still.organizations | ForEach-Object {$_.assignments} |
       Where-Object { $_.title -eq 'U05PublicAtlasLinked' })
    if($post.Count -ne 1 -or
       [string]$post[0].atlasRef.revision -ne $originalRevision -or
       [string]$post[0].atlasRef.workId -ne $originalWorkId) {
      throw 'U05_STALE_PREVIEW_MODIFIED_SAVED_LINK'
    }
    $afterReadHash=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.IO.File]::ReadAllBytes($manifest)))
    if($afterReadHash -ne $newManifestHash){throw 'U05_CENTER_READ_MODIFIED_NEW_OWNER_MANIFEST'}
    # Convert the persisted JSON receipt into a mutable hashtable; ordinary
    # PSCustomObject property assignment cannot add arbitrary new keys.
    $requalified=@{}
    foreach($property in $initial.PSObject.Properties){
      $requalified[$property.Name]=$property.Value
    }
    $requalified['ownerRevisionAfterChange']=[string]$head.revision
    $requalified['ownerGenerationAfterChange']=[string]$head.generation
    $requalified['ownerManifestSha256AfterChange']=$afterReadHash
    $requalified['staleAfterOwnerGUIEdit']='VERIFIED_IN_INSTALLED_CENTER'
    $requalified['status']='U05_TWO_INSTALLED_OWNER_CHANGED_STALE_PASS'
    $requalified | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $artifact
    Write-Host "U05_TWO_INSTALLED_OWNER_CHANGED_STALE_PASS old=$originalRevision new=$($head.revision) project=$originalId work=$originalWorkId"
    return
  }
  Start-Center
  Click 'Планы Atlas'
  # Import a real IWXA carrier from the installed Atlas owner through the
  # installed Center's ordinary Windows file-picker. Not an IPC shortcut.
  $archive=Join-Path $env:RUNNER_TEMP 'atlas05-center-installed.iwxa'
  if(!(Test-Path -LiteralPath $archive -PathType Leaf)){
    throw 'U05_INSTALLED_ATLAS_IWXA_ARCHIVE_NOT_FOUND'
  }
  $archiveHash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  Click 'Открыть портфель Atlas'
  $dialogFound=$false
  for($attempt=0;$attempt -lt 75;$attempt++){
    $hwnd=[U05Window]::GetForegroundWindow()
    if($hwnd -ne [IntPtr]::Zero -and $hwnd -ne $proc.MainWindowHandle){
      $element=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
      if($element.Current.ClassName -eq '#32770'){
        $dialogFound=$true
        break
      }
    }
    Start-Sleep -Milliseconds 250
  }
  if(!$dialogFound){throw 'U05_IWXA_NATIVE_FILE_DIALOG_NOT_OBSERVED'}
  if($archive -match '[+^%~{}()]'){throw 'U05_IWXA_TEST_PATH_UNSUPPORTED_BY_SENDKEYS'}
  [System.Windows.Forms.SendKeys]::SendWait('%n')
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait($archive)
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  [void](Find-UI-Text 'Архив .iwxa открыт для просмотра')
  [void](Find-UI $projectTitle 'Button' $true)
  Click $projectTitle $true
  Click 'Связать с планом'
  Click "Подготовить поручение: $workTitle" $true
  Text 'Что нужно сделать' 'U05FileIwxaBinding'
  Text 'Критерии приёмки' 'Exact installed Atlas archive work reference'
  Click 'Сохранить черновик'
  Click 'Сохранить на компьютере'
  $fileAssignment=$null
  for($attempt=0;$attempt -lt 75;$attempt++){
    try{
      $savedFileDraft=Get-Content -LiteralPath $centerDraft -Raw | ConvertFrom-Json -Depth 100
      $found=@($savedFileDraft.organizations | ForEach-Object {$_.assignments} |
        Where-Object {$_.title -eq 'U05FileIwxaBinding'})
      if($found.Count -eq 1){$fileAssignment=$found[0];break}
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  if($null -eq $fileAssignment){throw 'U05_CENTER_IWXA_WORK_REF_NOT_SAVED'}
  $fileRef=$fileAssignment.atlasRef
  if([string]$fileRef.projectId -ne $projectId -or
     [string]$fileRef.workId -ne $workId -or
     [string]$fileRef.revision -ne $revision){
    throw 'U05_CENTER_IWXA_WORK_REF_MISMATCH'
  }
  if((Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash -ne $beforeHash){
    throw 'U05_CENTER_IWXA_IMPORT_MODIFIED_ATLAS_OWNER'
  }
  Shutdown
  Start-Center
  Click 'Поручения' $true
  Click 'U05FileIwxaBinding' $true
  [void](Find-UI-Text 'Источник Atlas не открыт')
  Click 'Закрыть редактор'
  $receipt=[ordered]@{status='U05_CENTER_INSTALLED_IWXA_PICKER_PASS';
    archiveSha256=$archiveHash;sourceRevision=$revision;
    projectId=$projectId;workId=$workId;centerDraftReadback=$true;
    previewNotPromotedToAuthority=$true;ownerStoreUnmodified=$true}
  $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (
    Join-Path $env:GITHUB_WORKSPACE 'artifacts/atlas05-center-iwxa-result.json')
  Write-Host "U05_CENTER_INSTALLED_IWXA_PICKER_PASS project=$projectId work=$workId revision=$revision"
  Click 'Планы Atlas'
  Click 'Открыть Atlas Desktop'
  # The Windows WebView2 UIA tree can split a <p> across anonymous nodes.
  # Matching its exact prose cannot prove a revision. The owner revision is
  # instead asserted below against the saved Center work ref (and manifest).
  $title=Find-UI $projectTitle 'Button' $true
  if(!$title){throw 'U05_CANONICAL_PROJECT_NOT_RENDERED'}
  Write-Host "U05_CANONICAL_PROJECT_VISIBLE_IN_CENTER project=$projectId ownerRevision=$revision"
  Click $projectTitle $true
  # Real installed Center -> pinned U01 discovery -> original native U04
  # Windows port -> independent installed Atlas window -> return to Center.
  # This is an actual WebView2 control route, not direct test IPC.
  $atlasExe=Join-Path $env:LOCALAPPDATA 'IWXA Atlas/iwxa-atlas-desktop.exe'
  if(!(Test-Path -LiteralPath $atlasExe)){throw 'U04_INSTALLED_ATLAS_BINARY_MISSING'}
  Click 'Открыть окно Atlas'
  # Both original U04 states are valid: WINDOW_OBSERVED and
  # LAUNCHED_NO_WINDOW. Verify the honest UI status, then separately verify
  # the real installed process/HWND and native Windows foreground PID below.
  [void](Find-UI-Text 'автоматически не выбирается')
  $atlasProcesses=@(Get-CimInstance Win32_Process -Filter "name = 'iwxa-atlas-desktop.exe'" |
      Where-Object { $_.ExecutablePath -eq $atlasExe })
  if($atlasProcesses.Count -lt 1){throw 'U04_ORIGINAL_ATLAS_PROCESS_NOT_LAUNCHED'}
  # GUI focus is an OS fact, not a text marker in the now-background
  # Center WebView2 accessibility tree. Wait for the independent installed
  # Atlas HWND, retry actual UI clicks if Windows denies foreground focus,
  # and independently verify the foreground owner PID.
  $atlasPids=@($atlasProcesses | ForEach-Object { [uint32]$_.ProcessId })
  $atlasWindowReady=$false
  for($windowAttempt=0;$windowAttempt -lt 45;$windowAttempt++){
    foreach($pidValue in $atlasPids){
      $targetProcess=Get-Process -Id $pidValue -ErrorAction SilentlyContinue
      if($null -ne $targetProcess -and $targetProcess.MainWindowHandle -ne [IntPtr]::Zero){
        $atlasWindowReady=$true;break
      }
    }
    if($atlasWindowReady){break}
    Start-Sleep -Milliseconds 300
  }
  if(!$atlasWindowReady){throw 'U04_INSTALLED_ATLAS_VISIBLE_WINDOW_NOT_OBSERVED'}
  $atlasFocused=$false
  [uint32]$foregroundPid=0
  for($focusAttempt=1;$focusAttempt -le 4;$focusAttempt++){
    Click-Physical 'Фокус Atlas'
    for($foregroundAttempt=0;$foregroundAttempt -lt 12;$foregroundAttempt++){
      Start-Sleep -Milliseconds 250
      $foreground=[U05Window]::GetForegroundWindow()
      [uint32]$foregroundPid=0
      [void][U05Window]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid)
      if($foregroundPid -in $atlasPids){$atlasFocused=$true;break}
    }
    if($atlasFocused){break}
    Write-Host "U04_FOCUS_RETRY_REQUIRED attempt=$focusAttempt foreground_pid=$foregroundPid"
  }
  if(!$atlasFocused){
    throw "U04_ATLAS_FOREGROUND_NOT_CONFIRMED foreground_pid=$foregroundPid atlas_pids=$($atlasPids -join ',')"
  }
  Write-Host "U04_NATIVE_ATLAS_FOREGROUND_PASS foreground_pid=$foregroundPid"
  Click 'Вернуться в Center и проверить'
  [void](Find-UI-Text 'Возврат в Center: редакция Atlas перепроверена')
  $foreground=[U05Window]::GetForegroundWindow()
  [uint32]$foregroundPid=0
  [void][U05Window]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid)
  if($foregroundPid -ne [uint32]$proc.Id){throw "U04_CENTER_RETURN_FOCUS_MISMATCH pid=$foregroundPid"}
  # WebView navigation unmounts NativeAtlasPanel, but the original U04 native
  # binding is owned by Tauri. Reopen the same exact WorkRef without a second
  # external process or silent new window binding.
  $originalAtlasPids=@($atlasPids | Sort-Object)
  Click 'Поручения' $true
  Click 'Планы Atlas'
  Click 'Открыть Atlas Desktop'
  Click $projectTitle $true
  Click 'Открыть окно Atlas'
  [void](Find-UI-Text 'Прежняя связь с Atlas восстановлена без повторного запуска')
  $afterReattachPids=@(Get-CimInstance Win32_Process -Filter "name = 'iwxa-atlas-desktop.exe'" |
    Where-Object { $_.ExecutablePath -eq $atlasExe } |
    ForEach-Object { [uint32]$_.ProcessId } | Sort-Object)
  if(($afterReattachPids -join ',') -ne ($originalAtlasPids -join ',')){
    throw "U04_REATTACH_SPAWNED_NEW_ATLAS_PROCESS before=$($originalAtlasPids -join ',') after=$($afterReattachPids -join ',')"
  }
  Write-Host "U04_NAVIGATION_REATTACH_SAME_PROCESS_PASS atlasPids=$($originalAtlasPids -join ',')"
  # A different exact WorkRef in the same organization rebinds U04 without
  # launching another installed Atlas process or selecting work in Atlas.
  $workPicker=Find-UI 'Выбранная работа Atlas' 'ComboBox'
  $workPicker.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{END}')
  [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  Start-Sleep -Milliseconds 350
  [void](Find-UI-Text 'Выбрана другая работа или редакция Atlas')
  Click 'Открыть окно Atlas'
  [void](Find-UI-Text 'Прежняя связь с Atlas восстановлена без повторного запуска')
  $afterWorkPids=@(Get-CimInstance Win32_Process -Filter "name = 'iwxa-atlas-desktop.exe'" |
    Where-Object { $_.ExecutablePath -eq $atlasExe } |
    ForEach-Object { [uint32]$_.ProcessId } | Sort-Object)
  if(($afterWorkPids -join ',') -ne ($originalAtlasPids -join ',')){
    throw 'U04_WORK_REF_SWITCH_SPAWNED_SECOND_ATLAS'
  }
  Write-Host "U04_WORK_REF_REBIND_SAME_PROCESS_PASS atlasPids=$($originalAtlasPids -join ',')"
  # The installed Center already has two real organizations from its GUI test.
  # Change only Center's context. The original U04 verified reattach must
  # preserve the external PID without leaking the previous organization's ref.
  $orgPicker=Find-UI 'Организация' 'ComboBox'
  $orgPicker.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{END}')
  [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  Start-Sleep -Milliseconds 400
  Click 'Планы Atlas'
  Click 'Открыть Atlas Desktop'
  Click $projectTitle $true
  Click 'Открыть окно Atlas'
  # Depending on timing, original U04 may observe the HWND immediately or
  # report the verified process with its window still appearing.
  [void](Find-UI-Text 'без повторного запуска')
  $afterOrgPids=@(Get-CimInstance Win32_Process -Filter "name = 'iwxa-atlas-desktop.exe'" |
    Where-Object { $_.ExecutablePath -eq $atlasExe } |
    ForEach-Object { [uint32]$_.ProcessId } | Sort-Object)
  if(($afterOrgPids -join ',') -ne ($originalAtlasPids -join ',')){
    throw 'U04_ORGANIZATION_SWITCH_SPAWNED_SECOND_ATLAS'
  }
  Write-Host "U04_ORGANIZATION_REATTACH_SAME_PROCESS_PASS atlasPids=$($originalAtlasPids -join ',')"
  Click 'Отсоединить окно'
  [void](Find-UI-Text 'Atlas продолжает работать')
  $orgPicker=Find-UI 'Организация' 'ComboBox'
  $orgPicker.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
  [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  Start-Sleep -Milliseconds 400
  Click 'Планы Atlas'
  Click 'Открыть Atlas Desktop'
  Click $projectTitle $true
  if(@(Get-Process -Name 'iwxa-atlas-desktop' -ErrorAction SilentlyContinue).Count -lt 1){
    throw 'U04_DETACH_TERMINATED_ATLAS'
  }
  Write-Host "U04_CROSS_INSTALLED_OPEN_FOCUS_RETURN_PASS atlasPid=$($atlasProcesses[0].ProcessId) revision=$revision"
  # Preparation requires linking the existing organization workspace to this
  # exact canonical project revision. A free-floating work cannot be issued.
  Click 'Связать с рабочей областью'
  Click 'Подготовить поручение по работе'
  Text 'Что нужно сделать' 'U05PublicAtlasLinked'
  Text 'Критерии приёмки' 'Exact canonical work reference'
  Click 'Сохранить черновик'
  Click 'Сохранить на компьютере'
  for($i=0;$i -lt 60 -and !(Test-Path -LiteralPath $centerDraft);$i++){
    Start-Sleep -Milliseconds 300
  }
  $draft=Get-Content -LiteralPath $centerDraft -Raw | ConvertFrom-Json -Depth 100
  $linked=@($draft.organizations | ForEach-Object {$_.assignments} |
      Where-Object { $_.title -eq 'U05PublicAtlasLinked' })
  if($linked.Count -ne 1){throw "U05_CENTER_DRAFT_LINK_MISSING found=$($linked.Count)"}
  $ref=$linked[0].atlasRef
  if([string]$ref.projectId -ne $projectId -or
     [string]$ref.workId -ne $workId -or
     [string]$ref.revision -ne $revision){throw 'U05_EXACT_CANONICAL_REF_MISMATCH'}
  Shutdown
  $afterHash=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.IO.File]::ReadAllBytes($manifest)))
  if($beforeHash -ne $afterHash){throw 'U05_CENTER_ALTERED_ATLAS_OWNER_STORE'}
  Start-Center
  Click 'Поручения' $true
  Click 'U05PublicAtlasLinked' $true
  $status=Find-UI 'Источник Atlas не открыт' 'Text' $true
  if(!$status){throw 'U05_RESTART_LINK_STATUS_MISSING'}
  Click 'Закрыть редактор'
  Click 'Планы Atlas'
  Click 'Открыть Atlas Desktop'
  [void](Find-UI $projectTitle 'Button' $true)
  Click 'Поручения' $true
  Click 'U05PublicAtlasLinked' $true
  # The reopened editor must resolve the exact previously saved link against
  # an independently reread canonical Atlas snapshot.
  [void](Find-UI-Text 'Работа и редакция совпадают с открытым Atlas')
  Click 'Закрыть редактор'
  Write-Host "U05_RESTART_CANONICAL_REF_MATCH_PASS project=$projectId work=$workId revision=$revision"
  Shutdown
  $result=[ordered]@{status='U05_TWO_INSTALLED_SAME_CANONICAL_SOURCE_PASS';
    atlasInstalledExe=$env:ATLAS_INSTALLED_EXE;centerInstalledExe=$center;
    sourceGeneration=$generation;sourceRevision=$revision;
    projectId=$projectId;workId=$workId;refRevision=[string]$ref.revision;
    atlasStoreManifestSha256=$beforeHash;centerReadOnly=$true;
    centerDraftSurvivedRestart=$true;agentHostAuthorized=$false;
    note='Same-user installed binaries: source readback, exact work link, close/reopen; a later owner revision and T3 Apply not qualified'}
  $result|ConvertTo-Json|Set-Content -LiteralPath $artifact
  Write-Host "U05_TWO_INSTALLED_SAME_CANONICAL_SOURCE_PASS project=$projectId work=$workId revision=$revision"
} finally {
  if($null -ne $proc) {
    $proc.Refresh()
    if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
  }
}
