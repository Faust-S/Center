# Actual installed employee continuation. Requires completed first use and exact original license preparation on the same disposable runner.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$CenterExe,
 [Parameter(Mandatory=$true)][string]$AgentRoot,
 [Parameter(Mandatory=$true)][string]$GuiDriver,
 # Optional continuation of the SAME whole-Workspace return witness.
 # Requires the installed Atlas and the existing native U05 saved-work seed.
 [string]$AtlasExe=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(!$IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or
 !(($env:GITHUB_REPOSITORY -ceq 'Faust-S/Center' -and
    $env:GITHUB_REF -ceq 'refs/heads/work/2026-11-24-corporate-installed-one-core') -or
   ($env:GITHUB_REPOSITORY -ceq 'Faust-S/knowledge' -and
    $env:GITHUB_REF -ceq 'refs/heads/work/2026-11-25-k036-corporate-event-qualification')) -or
 $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
 $env:IWXA_T3_SYNTHETIC_PROVISION -cne 'CORPORATE_CENTER_CI_FIXTURE_ONLY'){
 throw 'EMPLOYEE_LICENSED_DISPOSABLE_RUNNER_REQUIRED'
}
if([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA'){
 throw 'EMPLOYEE_LICENSED_STA_REQUIRED'
}
$CenterExe=(Resolve-Path -LiteralPath $CenterExe).Path
$AgentRoot=(Resolve-Path -LiteralPath $AgentRoot).Path
$agentExe=Join-Path $AgentRoot 'desktop/bin/IWXA Personal.exe'
if(!(Test-Path -LiteralPath $agentExe -PathType Leaf)){
 throw 'EMPLOYEE_LICENSED_AGENT_EXE_MISSING'
}
$centerReg=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center'
$agentReg=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.personal-agent'
if([IO.Path]::GetFullPath($centerReg.InstallLocation) -ine (Split-Path $CenterExe -Parent) -or
 [IO.Path]::GetFullPath($agentReg.InstallLocation) -ine $AgentRoot -or
 [IO.Path]::GetFullPath($centerReg.DataLocation) -ieq [IO.Path]::GetFullPath($agentReg.DataLocation)){
 throw 'EMPLOYEE_LICENSED_PRODUCT_SCOPE_INVALID'
}
$atlasMode=![string]::IsNullOrWhiteSpace($AtlasExe)
if($atlasMode){
 $AtlasExe=(Resolve-Path -LiteralPath $AtlasExe).Path
 $atlasReg=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.atlas'
 if([IO.Path]::GetFullPath($atlasReg.InstallLocation) -ine (Split-Path $AtlasExe -Parent) -or
    [IO.Path]::GetFullPath($atlasReg.DataLocation) -ieq [IO.Path]::GetFullPath($centerReg.DataLocation) -or
    [IO.Path]::GetFullPath($atlasReg.DataLocation) -ieq [IO.Path]::GetFullPath($agentReg.DataLocation)){
  throw 'EMPLOYEE_LICENSED_ATLAS_PRODUCT_SCOPE_INVALID'
 }
}
. (Join-Path $PSScriptRoot 'gui-driver.ps1')
. (Join-Path $PSScriptRoot 'exchange-gui-driver.ps1')
$script:guiOrdinal=0;$script:guiLastKind='NONE'
$script:stage='PREPARE'
function Stage([string]$value){
 if($value -cnotmatch '^[A-Z0-9_]{4,80}$'){throw 'EMPLOYEE_LICENSED_STAGE_INVALID'}
 $script:stage=$value;$script:guiOrdinal=0;$script:guiLastKind='NONE'
}
$checks=[System.Collections.Generic.List[string]]::new()
function Record([string]$value){
 if($value -cnotmatch '^[A-Z0-9_]{4,80}$' -or $checks.Contains($value)){
  throw 'EMPLOYEE_LICENSED_CHECK_INVALID'
 }
 $checks.Add($value)
 Write-Host ('EMPLOYEE_LICENSED_CHECK='+$value)
}
function Need([bool]$ok,[string]$code){if(!$ok){throw $code}}
function Wait-Any($process,[string[]]$values,[int]$attempts=240){
 Gui-Step 'WAIT_TEXT'
 for($i=0;$i -lt $attempts;$i++){
  foreach($value in $values){if(Has-Text $process $value){return $value}}
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXPECTED_STATE_NOT_OBSERVED'
}
function Open-Company($process){
 Enter-AgentCompanyPage $process
 $null=Wait-Any $process @('Пространство открыто','Доступ подтверждён') 360
}
function Open-ExactEmployee($process,[string]$expectedPerson=''){
 Open-CenterRegistry $process
 Press $process 'Прочитать подключённых сотрудников'
 # Center 0.5 selects the sole independent employee only after a complete
 # original roster read. Use that actual choice rather than Home/Down/Enter.
 # The legacy route is unchanged for the frozen 0.4.1 witness.
 if(!$atlasMode){Select-FirstReal $process 'Сотрудник из исходного T3'}
 Press $process 'Открыть подключённого сотрудника'
 Wait-Text $process 'Подтверждены отдельные ACTION work.prepare и DATA package.export' 240
 Wait-Text $process 'Четыре права подтверждены исходным Kernel' 240
 Wait-Text $process 'Подтверждено отдельное DATA-право руководителя' 240
 $person=Read-Edit $process 'Подписанная личность T3 сотрудника'
 Need ($person -cmatch '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$' -and
  (!$expectedPerson -or $person -ceq $expectedPerson)) 'EMPLOYEE_LICENSED_RESTORED_EMPLOYEE_MISMATCH'
 return $person
}
# Only finite codes from the actual product are emitted. Never repeat a
# mutation when the native confirmation or its acknowledgement is missing.
function Read-SeatDispatchDiagnostic($process){
 $allowed=@('CEN_D3_CORPORATE_SEAT_ASSIGNMENT_NOT_AVAILABLE',
  'CEN_D3_CORPORATE_SEAT_READBACK_REQUIRED','CEN_D3_CORPORATE_SEAT_COMMAND_INVALID',
  'CEN_D3_CORPORATE_SEAT_INTENT_INVALID','CEN_D3_CORPORATE_SEAT_INTENT_ALREADY_PENDING',
  'CEN_D3_ORIGINAL_WORKSPACE_NOT_RUNNING','CEN_D3_ORIGINAL_EMPLOYEE_OWNER_NOT_CONNECTED',
  'CEN_D3_CONTEXT_CHANGED','CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED','CEN_OWNER_NOT_CONNECTED')
 foreach($code in $allowed){if(Has-Text $process $code){return $code}}
 if(Has-Text $process 'Результат операции '){return 'OUTCOME_UNKNOWN'}
 if(Has-Text $process 'Выполняется операция '){return 'IN_PROGRESS'}
 if(Has-Text $process 'Исход операции неизвестен'){return 'OUTCOME_UNKNOWN'}
 if(Has-Text $process 'Подтверждённая операция:'){return 'COMMITTED_READBACK_PRESENT'}
 return 'NO_RECOGNIZED_STATE'
}
function Check-SeatCapacity($process,[int]$reserved){
 Wait-Text $process 'Подписанная лицензия актуальна' 240
 Wait-ExactText $process 'Зарегистрированные сотрудники: 1 / 10'
 Wait-ExactText $process ('Зарезервированные места: '+$reserved+' / 2')
 Wait-ExactText $process ('Свободно для назначения: '+(2-$reserved))
}
# Inspect the accessibility tree regardless of scrolling. A hidden-by-scroll
# submit control still counts as an offered duplicate action. Navigation uses
# the visible-button helper, but job readback must not depend on it.
function Agent-HasJobButton($process,[string]$name){
 $items=(Window $process).FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.PropertyCondition]::new(
   [System.Windows.Automation.AutomationElement]::NameProperty,$name))
 foreach($item in $items){
  try{if($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button){return $true}}catch{}
 }
 return $false
}
# The review witness resolves stable V8 UIA identities, not an old combobox.
function Wait-ReviewControl($process,[string]$id,[string]$name,[bool]$enabled){
 for($i=0;$i -lt 120;$i++){
  $items=(Window $process).FindAll(
   [System.Windows.Automation.TreeScope]::Descendants,
   [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,$id))
  $exact=@()
  foreach($item in $items){
   try{
    if($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
       $item.Current.Name -ceq $name -and !$item.Current.IsOffscreen){$exact+=,$item}
   }catch{}
  }
  if($exact.Count -gt 1){throw 'EMPLOYEE_LICENSED_REVIEW_CONTROL_AMBIGUOUS'}
  if($exact.Count -eq 1 -and $exact[0].Current.IsEnabled -eq $enabled){return $exact[0]}
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_REVIEW_CONTROL_NOT_AVAILABLE'
}
function Wait-ExistingJob($process){
 # Only an existing bound job exposes these buttons, not a received file.
 for($i=0;$i -lt 360;$i++){
  if((Agent-HasJobButton $process 'Отслеживать выполнение') -or
     (Agent-HasJobButton $process 'Открыть работу в Agent')){return}
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_ORIGINAL_AGENT_JOB_NOT_OBSERVED'
}
function Check-ExactTask($process,[string]$text,[string]$id,[string]$sha,[string]$executor){
 Wait-Text $process $text 360
 # The section can already be open after a cold read; do not toggle it shut.
 if(!(Has-Text $process $id) -or !(Has-Text $process $sha) -or !(Has-Text $process $executor)){
  Press $process 'Происхождение поручения'
 }
 Wait-Text $process $id 240
 Wait-Text $process $sha 240
 Wait-Text $process $executor 240
}
# Atlas continuation: reuse the existing native user actions and original
# saved owner head. These reads never mutate the Atlas or company Store.
function Read-AtlasWorkRef{
 $store=Join-Path $atlasReg.DataLocation 'atlas-store-v1'
 $head=Get-Content -LiteralPath (Join-Path $store 'head.json') -Raw|ConvertFrom-Json -Depth 100
 $matches=@(foreach($entry in $head.projects){
  Need ([string]$entry.sha256 -cmatch '^[a-f0-9]{64}$') 'EMPLOYEE_LICENSED_ATLAS_BLOCK_DIGEST_INVALID'
  $file=Join-Path $store ('blocks/'+$entry.sha256+'.json')
  Need ((Digest $file) -ceq [string]$entry.sha256) 'EMPLOYEE_LICENSED_ATLAS_BLOCK_CHANGED'
  $project=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json -Depth 100
  if($project.name -ceq 'U05OwnerProject'){
   $works=@($project.items|Where-Object {$_.title -ceq 'U05OwnerAlpha'})
   Need ($works.Count -eq 1) 'EMPLOYEE_LICENSED_ATLAS_WORK_AMBIGUOUS'
   [pscustomobject]@{projectId=[string]$project.id;workId=[string]$works[0].id;revision=[string]$head.revision;generation=[string]$head.generation}
  }
 })
 Need ($matches.Count -eq 1 -and $matches[0].revision -cmatch '^(0|[1-9][0-9]*)$') 'EMPLOYEE_LICENSED_ATLAS_SOURCE_REQUIRED'
 return $matches[0]
}
function Read-ComboChoice($control){
 $selection=$null
 if($control.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern,[ref]$selection)){
  $rows=@($selection.Current.GetSelection())
  if($rows.Count -eq 1){return [string]$rows[0].Current.Name}
 }
 $value=$null
 if($control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value)){
  return [string]$value.Current.Value
 }
 return ''
}
function Select-ExactOption($process,[string]$name,[string]$option){
 Gui-Step 'COMBO'
 Focus-App $process
 $combo=Control $process $name 'ComboBox'
 Need ($combo.Current.IsEnabled) 'EMPLOYEE_LICENSED_ATLAS_COMBO_NOT_READY'
 if((Read-ComboChoice $combo) -ceq $option){return}
 $expand=$null
 if($combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$expand)){
  if($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed){$expand.Expand()}
 }else{
  $combo.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('%{DOWN}')
 }
 $condition=[System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::NameProperty,$option)
 $selected=$false
 for($i=0;$i -lt 80;$i++){
  $rows=@(foreach($row in (Window $process).FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)){
   $p=$null
   try{
    if($row.Current.IsEnabled -and !$row.Current.IsOffscreen -and
       $row.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$p)){
     [pscustomobject]@{element=$row;pattern=$p}
    }
   }catch{}
  })
  Need ($rows.Count -le 1) 'EMPLOYEE_LICENSED_ATLAS_OPTION_AMBIGUOUS'
  if($rows.Count -eq 1){$rows[0].pattern.Select();$selected=$true;break}
  Start-Sleep -Milliseconds 200
 }
 Need $selected 'EMPLOYEE_LICENSED_ATLAS_EXACT_OPTION_MISSING'
 for($i=0;$i -lt 80;$i++){
  # React can recreate the selection control after the original UIA action.
  # Re-resolve and observe; do not issue a second selection.
  try{
   if((Read-ComboChoice (Control $process $name 'ComboBox' 1)) -ceq $option){return}
  }catch{}
  Start-Sleep -Milliseconds 200
 }
 throw 'EMPLOYEE_LICENSED_ATLAS_OPTION_READBACK_FAILED'
}
function Open-AtlasProjectRow($process){
 Gui-Step 'BUTTON'
 Focus-App $process
 $condition=[System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
 for($i=0;$i -lt 120;$i++){
  $rows=@((Window $process).FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)|Where-Object {
   $_.Current.IsEnabled -and $_.Current.Name -cmatch '^U05OwnerProject(?:\s|$)'
  })
  Need ($rows.Count -le 1) 'EMPLOYEE_LICENSED_ATLAS_PROJECT_AMBIGUOUS'
  if($rows.Count -eq 1){
   $rows[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
   return
  }
  Start-Sleep -Milliseconds 200
 }
 throw 'EMPLOYEE_LICENSED_ATLAS_PROJECT_NOT_OBSERVED'
}
function Prepare-AtlasDraft($process,[string]$title,[string]$expectedPerson){
 $ref=Read-AtlasWorkRef
 $current=Get-Content -LiteralPath (Join-Path $centerReg.DataLocation 'atlas-store-v1/preparation/draft.json') -Raw|ConvertFrom-Json -Depth 100
 $org=@($current.organizations|Where-Object {$_.id -ceq $receipt.organizationId})
 Need ($org.Count -eq 1 -and @($org[0].workspaces).Count -eq 1) 'EMPLOYEE_LICENSED_ATLAS_UNIQUE_WORKSPACE_REQUIRED'
 $workspace=@($org[0].workspaces)[0]
 Press $process 'Планы Atlas' $true
 Press $process 'Открыть Atlas Desktop'
 Open-AtlasProjectRow $process
 Select-ExactOption $process 'Целевая рабочая область Atlas' ([string]$workspace.name)
 $link=Control $process 'Связать с рабочей областью'
 if($link.Current.IsEnabled){Press $process 'Связать с рабочей областью'}
 Wait-Text $process 'Связь с выбранной редакцией подтверждена в черновике' 240
 Select-ExactOption $process 'Выбранная работа Atlas' 'U05OwnerAlpha'
 Press $process 'Подготовить поручение по работе'
 Enter $process 'Что нужно сделать' $title
 Enter $process 'Критерии приёмки' 'Show the calculation and the correct total.'
 Press $process 'Сохранить черновик'
 Press $process 'Сохранить на компьютере'
 $draftRow=$null
 for($i=0;$i -lt 120;$i++){
  $saved=Get-Content -LiteralPath (Join-Path $centerReg.DataLocation 'atlas-store-v1/preparation/draft.json') -Raw|ConvertFrom-Json -Depth 100
  $found=@($saved.organizations|Where-Object {$_.id -ceq $receipt.organizationId}|ForEach-Object {$_.assignments}|Where-Object {$_.title -ceq $title})
  Need ($found.Count -le 1) 'EMPLOYEE_LICENSED_ATLAS_DRAFT_AMBIGUOUS'
  if($found.Count -eq 1){$draftRow=$found[0];break}
  Start-Sleep -Milliseconds 250
 }
 Need ($null -ne $draftRow -and $draftRow.workspaceId -ceq $workspace.id -and
  $draftRow.atlasRef.projectId -ceq $ref.projectId -and
  $draftRow.atlasRef.workId -ceq $ref.workId -and
  [string]$draftRow.atlasRef.revision -ceq $ref.revision) 'EMPLOYEE_LICENSED_ATLAS_DRAFT_REFERENCE_MISMATCH'
 $null=Open-ExactEmployee $process $expectedPerson
 Select-ExactOption $process 'Подготовить из черновика этой рабочей области' $title
 $text=Read-Edit $process 'Текст поручения'
 $footer='Ссылка на проект Atlas: '+$ref.projectId+' @ '+$ref.revision+', работа '+$ref.workId
 Need ($text.Contains($title) -and $text.Contains('Черновик Center: '+$draftRow.id+', редакция '+$draftRow.editNumber+'.') -and
  $text.TrimEnd().EndsWith($footer,[StringComparison]::Ordinal)) 'EMPLOYEE_LICENSED_ATLAS_SIGNED_DRAFT_TEXT_MISMATCH'
 $consent=Control $process 'Подтверждаю, что этот черновик предназначен выбранному подписанному сотруднику' 'CheckBox'
 $toggle=$consent.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
 Need ($consent.Current.IsEnabled -and $toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) 'EMPLOYEE_LICENSED_ATLAS_DRAFT_CONSENT_NOT_FRESH'
 $toggle.Toggle()
 $confirmed=$false
 for($i=0;$i -lt 80;$i++){
  try{
   $consent=Control $process 'Подтверждаю, что этот черновик предназначен выбранному подписанному сотруднику' 'CheckBox' 1
   if($consent.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On){
    $confirmed=$true;break
   }
  }catch{}
  Start-Sleep -Milliseconds 200
 }
 Need $confirmed 'EMPLOYEE_LICENSED_ATLAS_DRAFT_CONSENT_NOT_OBSERVED'
 Write-Host 'EMPLOYEE_LICENSED_ATLAS_EXACT_DRAFT_PREPARED'
 return $ref
}
function Read-AtlasReturnedResult($process,[string]$id,$expectedRef,$expectedResult){
 $pending=Read-Edit $process 'Исходный ID поручения'
 Need ($pending -ceq $id) 'EMPLOYEE_LICENSED_ATLAS_PENDING_TASK_CHANGED'
 Press $process 'Перечитать подписанную Task'
 Wait-Text $process 'Подписанная ссылка на Atlas: проект' 240
 foreach($value in @($expectedRef.projectId,$expectedRef.workId,('редакция '+$expectedRef.revision))){Wait-Text $process $value 240}
 Press $process 'Прочитать полученные результаты'
 Wait-Text $process 'Полученные Result: 1.' 240
 Press $process 'Прочитать содержание'
 $text=Read-Edit $process 'Выбранный Result (только чтение)'
 Need (Text-MatchesDigest $text $expectedResult.sha256) 'EMPLOYEE_LICENSED_ATLAS_SELECTED_RESULT_CHANGED'
 return $text
}
function Text-MatchesDigest([string]$text,[string]$expected){
 # Windows UIA may represent line endings as CRLF. Compare the original
 # UTF-8 bytes, permitting only that platform representation of newlines.
 foreach($v in @($text,($text -replace "`r`n","`n"))){
  $sha=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($v))).ToLowerInvariant()
  if($sha -ceq $expected){return $true}
 }
 return $false
}
function Find-InstalledAtlas{
 for($i=0;$i -lt 160;$i++){
  $matches=@(Get-Process -Name 'iwxa-atlas-desktop' -ErrorAction SilentlyContinue|Where-Object {$_.Path -ieq $AtlasExe})
  Need ($matches.Count -le 1) 'EMPLOYEE_LICENSED_ATLAS_PROCESS_AMBIGUOUS'
  if($matches.Count -eq 1){
   $matches[0].Refresh()
   if($matches[0].MainWindowHandle -ne [IntPtr]::Zero){return $matches[0]}
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_ATLAS_WINDOW_NOT_OBSERVED'
}
# Original installed Atlas close handling, reused from the successful U05 lane.
function Close-AtlasClean($proc) {
 if($null -eq $proc){return}
 $proc.Refresh()
 if(!$proc.HasExited){
   Write-Host 'U05_ATLAS_CLOSE_REQUESTED'
   if(![CorporateQualificationGui]::PostMessage($proc.MainWindowHandle,0x0010,
       [IntPtr]::Zero,[IntPtr]::Zero)){throw 'U05_ATLAS_CLOSE_SIGNAL_FAILED'}
   # The real Atlas close handler dismisses transient previews first and
   # deliberately blocks close during a write. Do not discard a draft or
   # force-kill a process and call that a successful cold reopen.
   $resent=$false
   for($i=0;$i -lt 120;$i++){
     if($proc.WaitForExit(250)){break}
     $proc.Refresh()
     if($proc.HasExited){break}
     if($proc.MainWindowHandle -eq [IntPtr]::Zero){continue}
     try {
       $controls=@((Window $proc).FindAll([System.Windows.Automation.TreeScope]::Descendants,
         [System.Windows.Automation.Condition]::TrueCondition))
     } catch {
       # Native close can finish between the process check and UIA lookup.
       $proc.Refresh()
       if($proc.HasExited){break}
       throw
     }
     $visible=@(foreach($item in $controls){
       try{if(!$item.Current.IsOffscreen -and $item.Current.Name){$item}}catch{}
     })
     $names=@($visible|ForEach-Object {try{[string]$_.Current.Name}catch{''}})
     if($names -contains 'Закрыть IWXA Atlas?'){
       if($names -contains 'В портфеле есть изменения, которые пока не записаны на диск.' -or
          $names -contains 'Открытая форма ещё не применена. Вернитесь, примените её к черновику и сохраните.'){
         throw 'U05_ATLAS_CLOSE_UNEXPECTED_UNSAVED_DATA'
       }
       if($names -contains 'Завершается запись или чтение. Закрытие пока недоступно.'){continue}
       if($names -contains 'Все изменения портфеля сохранены.'){
         # Only the explicitly clean guard may use this button. No actual
         # changes are discarded, and the original Store remains untouched.
         $button=@($visible|Where-Object {try{
           $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
           $_.Current.Name -ceq 'Закрыть без сохранения' -and $_.Current.IsEnabled
         }catch{$false}})
         if($button.Count -eq 1){
           $button[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
           Write-Host 'U05_ATLAS_CLEAN_CLOSE_GUARD_CONFIRMED'
           if(!$proc.WaitForExit(10000)){throw 'U05_ATLAS_CLEAN_CLOSE_GUARD_TIMEOUT'}
           break
         }
       }
     }elseif(!$resent -and $i -ge 8){
       # First WM_CLOSE can dismiss a transient review without closing.
       # One explicit second close is permitted, never an unbounded loop.
       $resent=$true
       [void][CorporateQualificationGui]::PostMessage($proc.MainWindowHandle,0x0010,
         [IntPtr]::Zero,[IntPtr]::Zero)
       Write-Host 'U05_ATLAS_SECOND_CLOSE_REQUESTED'
     }
   }
   $proc.Refresh()
   if(!$proc.HasExited){throw 'U05_ATLAS_GUI_CLOSE_TIMEOUT'}
 }
 Write-Host 'U05_ATLAS_GUI_CLOSED'
}
function Publish-AtlasReturn($process,$expectedRef,$expectedResult){
 $null=Read-AtlasReturnedResult $process $taskId $expectedRef $expectedResult
 Press $process 'Подготовить или проверить передачу'
 $next=Wait-Any $process @('Разрешить передачу в Atlas','Подписать для Atlas') 240
 if($next -ceq 'Разрешить передачу в Atlas'){
  Press-VerifiedEmployeeButton $process 'Разрешить передачу в Atlas'
  Original-Confirm $process 'IWXA T3: передача результата в Atlas'
  Press $process 'Подготовить или проверить передачу'
 }
 Press-VerifiedEmployeeButton $process 'Подписать для Atlas'
 Original-Confirm $process 'IWXA T3: передача результата в Atlas'
 Wait-Text $process 'Подписанный Result подготовлен.' 360
 Press $process 'Открыть Result в Atlas'
 $target=Find-InstalledAtlas
 Wait-Text $target 'Result передан из Center' 360
 Press-VerifiedEmployeeButton $target 'Открыть переданный Result'
 Wait-Text $target 'Оригинальный T3 проверил подпись' 360
 $observed=Read-Edit $target 'Оригинальный подписанный текст Result'
 Need (Text-MatchesDigest $observed $expectedResult.sha256) 'EMPLOYEE_LICENSED_ATLAS_RECIPIENT_TEXT_CHANGED'
 Press-VerifiedEmployeeButton $target 'Подтвердить получение'
 Wait-Text $target 'Выбранный подписанный Result сохранён в Atlas' 360
 Wait-Text $target 'Полученные результаты работ' 240
 Press $process 'Проверить получение в Atlas'
 Wait-Text $process 'Result сохранён в исходной работе Atlas.' 360
 Write-Host 'EMPLOYEE_LICENSED_ATLAS_ORIGINAL_PUBLICATION_AND_RECEIPT_PASS'
 return $target
}

$handoff=Join-Path $env:RUNNER_TEMP 'iwxa-licensed-employee-handoff'
$trust=Join-Path $handoff 'publisher-corporate-trust.json'
$license=Join-Path $handoff 'corporate-active.iwxa'
$receipt=Get-Content -LiteralPath (Join-Path $handoff 'receipt.json') -Raw|ConvertFrom-Json
$publisherReg=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.publisher'
Need (@(@($centerReg.DataLocation,$agentReg.DataLocation,$publisherReg.DataLocation)|Sort-Object -Unique).Count -eq 3) 'EMPLOYEE_LICENSED_PRODUCT_DATA_SCOPE_COLLISION'
Need ($receipt.schema -ceq 'IWXA_DISPOSABLE_LICENSED_EMPLOYEE_HANDOFF/1' -and
 $receipt.status -ceq 'ACTIVE' -and $receipt.sequence -eq 1 -and
 $receipt.recipientConfirmed -eq $true -and $receipt.employeeSeatAssigned -eq $false -and
 $receipt.productionActivation -eq $false -and
 $receipt.trustSha256 -ceq (Digest $trust) -and
 $receipt.packageSha256 -ceq (Digest $license) -and
 $receipt.centerSha256 -ceq (Digest $CenterExe) -and
 $receipt.publisherSha256 -ceq (Digest (Join-Path $publisherReg.InstallLocation 'iwxa-publisher.exe')) -and
 [DateTimeOffset]::Parse([string]$receipt.statusValidUntil) -gt [DateTimeOffset]::UtcNow.AddMinutes(8)) 'EMPLOYEE_LICENSED_ACTIVE_HANDOFF_INVALID_OR_EXPIRED'
$draft=Get-Content -LiteralPath (Join-Path $centerReg.DataLocation 'atlas-store-v1/preparation/draft.json') -Raw|ConvertFrom-Json -Depth 80
Need ($draft.activeOrganizationId -ceq $receipt.organizationId -and @($draft.organizations).Count -eq 1) 'EMPLOYEE_LICENSED_ORGANIZATION_SCOPE_INVALID'
$work=Join-Path $env:RUNNER_TEMP ('iwxa-employee-licensed-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($work)
$invite=Join-Path $work 'employee-current.iwxa'
$taskFile=Join-Path $work 'employee-task.iwxa'
$cen=$null;$agent=$null;$atlas=$null;$atlasRef=$null
try{
 Stage 'CENTER_REOPEN_EMPLOYEE'
 $cen=Start-App $CenterExe
 $person=Open-ExactEmployee $cen
 Record 'CENTER_COLD_EXACT_EMPLOYEE_RIGHTS'
 Stage 'CENTER_ASSIGN_ORIGINAL_SEAT'
 Press $cen 'Перечитать распределение'
 Check-SeatCapacity $cen 0
 # The exact employee reopened above is already the default target of
 # the real seat panel. Verify that identity, not a positional combobox.
 Wait-ExactText $cen ('Получатель места: '+$person)
 Press-VerifiedEmployeeButton $cen 'Назначить место'
 try{
  Original-Confirm $cen 'IWXA T3: распределение корпоративных мест'
 }catch{
  $diagnostic='NO_RECOGNIZED_STATE'
  try{$diagnostic=Read-SeatDispatchDiagnostic $cen}catch{}
  Write-Host ('EMPLOYEE_LICENSED_SEAT_DISPATCH='+$diagnostic)
  throw
 }
 Check-SeatCapacity $cen 1
 Wait-Text $cen 'Подтверждённая операция:' 240
 Record 'CENTER_ORIGINAL_SEAT_ASSIGNED'
 Stage 'CENTER_COLD_SEAT_READBACK'
 Stop-App $cen;$cen=Start-App $CenterExe
 $null=Open-ExactEmployee $cen $person
 Press $cen 'Перечитать распределение'
 Check-SeatCapacity $cen 1
 Record 'CENTER_SEAT_COLD_READBACK'
 Stage 'CENTER_EXPORT_CURRENT_MEMBERSHIP'
 Native-FileDialog $cen 'Сохранить персональное приглашение .iwxa' $invite $false
 Wait-Text $cen 'Подписанный .iwxa сохранён, доставка не подтверждена' 240
 Need ((Get-Item -LiteralPath $invite).Length -gt 0) 'EMPLOYEE_LICENSED_CURRENT_MEMBERSHIP_EMPTY'
 Stage 'AGENT_IMPORT_MEMBERSHIP'
 $agent=Start-App $agentExe $AgentRoot
 Open-Company $agent
 if(Has-Text $agent 'Пространство открыто'){
  Press $agent 'Вернуться к личной работе'
  Open-Company $agent
 }
 Wait-Text $agent 'Доступ подтверждён' 240
 Enter $agent 'Файл обновления .iwxa' $invite
 Press $agent 'Обновить полномочия'
 $null=Wait-Any $agent @('Обновление полномочий подтверждено T3','Полномочия уже актуальны') 360
 Record 'AGENT_ORIGINAL_MEMBERSHIP_UPDATE'
 Stage 'AGENT_IMPORT_ORIGINAL_LICENSE'
 Enter $agent 'Открытый файл доверия Publisher' $trust
 Enter $agent 'Независимо подтверждённый SHA-256' $receipt.trustSha256
 Press $agent 'Подтвердить доверие Publisher'
 Wait-Text $agent 'Нет действующей подписанной лицензии' 240
 Enter $agent 'Подписанное обновление LICENSE/STATUS (.iwxa)' $license
 Press $agent 'Принять подписанное обновление'
 Wait-Text $agent 'Подписанный тариф подтверждён на момент чтения' 360
 Wait-Text $agent 'Ваше назначение подтверждено на момент чтения' 360
 Record 'AGENT_ORIGINAL_LICENSE_AND_OWN_SEAT'
 Stage 'CENTER_SIGN_ADDRESSED_TASK'
 $taskId='task:licensed-'+[guid]::NewGuid().ToString('N')
 $taskText='Check the supplier invoice: 12 units at 45 currency units each and delivery at 80. Calculate the total and explain the calculation.'
 if($atlasMode){
  Stage 'CENTER_ATLAS_LINKED_DRAFT'
  $atlasRef=Prepare-AtlasDraft $cen $taskText $person
  Stage 'CENTER_SIGN_ADDRESSED_TASK'
 }
 Enter $cen 'Исходный ID поручения' $taskId
 if(!$atlasMode){Enter $cen 'Текст поручения' $taskText}
 Press-VerifiedEmployeeButton $cen '3. Подписать Task этому сотруднику'
 Original-Confirm $cen 'IWXA T3: подписать поручение независимому сотруднику'
 Wait-Text $cen ('Подписанная Task: '+$taskId) 360
 Press $cen 'Перечитать подписанную Task'
 Wait-Text $cen 'Исходный каталог подтверждён.' 240
 if($atlasMode){
  Wait-Text $cen 'Подписанная ссылка на Atlas: проект' 240
  foreach($value in @($atlasRef.projectId,$atlasRef.workId,('редакция '+$atlasRef.revision))){Wait-Text $cen $value 240}
 }
 Native-FileDialog $cen 'Сохранить подписанную Task .iwxa' $taskFile $false
 Need ((Get-Item -LiteralPath $taskFile).Length -gt 0) 'EMPLOYEE_LICENSED_TASK_CARRIER_EMPTY'
 $taskSha=Digest $taskFile
 Record 'CENTER_ORIGINAL_ADDRESSED_TASK_EXPORTED'
 Stage 'AGENT_IMPORT_EXACT_TASK'
 Press $agent 'Открыть предоставленное пространство'
 Wait-Text $agent 'Пространство открыто' 360
 Wait-Text $agent 'Рабочие данные находятся в локальном пространстве домена' 360
 Enter $agent 'Файл поручения .iwxa' $taskFile
 Press $agent 'Получить поручение'
 Check-ExactTask $agent $taskText $taskId $taskSha $person
 Record 'AGENT_EXACT_SIGNED_TASK_RECEIVED'
 Stage 'AGENT_ADMIT_LICENSED_JOB'
 Press $agent 'Выполнить в Agent'
 Wait-ExistingJob $agent
 Record 'AGENT_LICENSED_JOB_ADMITTED'
 Stage 'AGENT_COLD_EXISTING_JOB'
 Stop-App $agent;$agent=Start-App $agentExe $AgentRoot
 Open-Company $agent
 if(Has-Text $agent 'Доступ подтверждён'){
  Press $agent 'Открыть предоставленное пространство'
  Wait-Text $agent 'Пространство открыто' 360
 }
 Press $agent 'Прочитать сохранённое поручение'
 Check-ExactTask $agent $taskText $taskId $taskSha $person
 Wait-ExistingJob $agent
 Need (!(Agent-HasJobButton $agent 'Выполнить в Agent')) 'EMPLOYEE_LICENSED_COLD_JOB_OFFERS_DUPLICATE_SUBMISSION'
 Record 'AGENT_COLD_EXISTING_JOB_NO_RESUBMISSION'
 Write-Host ('EMPLOYEE_LICENSED_ADMISSION=PASS checks='+$checks.Count)
 Stage 'AGENT_LICENSED_REAL_RESULT'
 # Follow the existing bound job; no second submission or injected Result.
 if(Agent-HasJobButton $agent 'Открыть работу в Agent'){
  Press $agent 'Открыть работу в Agent'
 }else{
  Press $agent 'Отслеживать выполнение'
 }
 Wait-Text $agent $taskText 360
 for($i=0;$i -lt 2400;$i++){
  if(Agent-VisibleButton $agent 'Решение по результату'){break}
  Start-Sleep -Milliseconds 250
 }
 Need (Agent-VisibleButton $agent 'Решение по результату') 'EMPLOYEE_LICENSED_REAL_RESULT_NOT_READY'
 Wait-Text $agent $taskText 120
 Wait-Text $agent ([string](12*45+80)) 240
 Record 'AGENT_LICENSED_RESULT_REVIEW_AVAILABLE'
 Stage 'AGENT_LICENSED_HUMAN_REVIEW'
 Press $agent 'Решение по результату'
 $null=Wait-ReviewControl $agent 'iwxa-review-save' 'Сохранить решение' $false
 $approve=Wait-ReviewControl $agent 'iwxa-review-approve' 'Принять' $true
 $approve.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 $save=Wait-ReviewControl $agent 'iwxa-review-save' 'Сохранить решение' $true
 $save.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 Wait-Text $agent 'Результат принят' 480
 Wait-Text $agent $taskText 120
 Record 'AGENT_HUMAN_ACCEPTED_EXACT_LICENSED_RESULT'
 Stage 'AGENT_LICENSED_ORIGINAL_COMPANY_READBACK'
 Open-Company $agent
 Press $agent 'Прочитать сохранённое поручение'
 Check-ExactTask $agent $taskText $taskId $taskSha $person
 Press $agent 'Проверить результат'
 Wait-Text $agent 'Оригинальный T2 подтвердил Task и принятый Result в Workspace компании.' 480
 Wait-Text $agent 'Передача получателю ещё не подтверждена.' 120
 Record 'AGENT_ORIGINAL_COMPANY_TASK_RESULT_READBACK'
 Stage 'AGENT_LICENSED_COLD_ACCEPTED_RESULT'
 Stop-App $agent;$agent=Start-App $agentExe $AgentRoot
 Open-Company $agent
 if(Has-Text $agent 'Доступ подтверждён'){
  Press $agent 'Открыть предоставленное пространство'
  Wait-Text $agent 'Пространство открыто' 360
 }
 Press $agent 'Прочитать сохранённое поручение'
 Check-ExactTask $agent $taskText $taskId $taskSha $person
 Press $agent 'Проверить результат'
 Wait-Text $agent 'Оригинальный T2 подтвердил Task и принятый Result в Workspace компании.' 480
 Wait-Text $agent 'Передача получателю ещё не подтверждена.' 120
 Need (!(Agent-HasJobButton $agent 'Выполнить в Agent')) 'EMPLOYEE_LICENSED_COLD_RESULT_OFFERS_DUPLICATE_SUBMISSION'
 Record 'AGENT_COLD_COMPANY_RESULT_NO_RESUBMISSION'
 Write-Host ('EMPLOYEE_LICENSED_RESULT_ACCEPTANCE=PASS checks='+$checks.Count)
 Stage 'AGENT_EXCHANGE_READBACK'
 Press $agent 'Открыть Workspace для передачи'
 Exchange-Nav $agent
 Exchange-Action $agent 'iwxa-company-readback-refresh'
 Wait-Text $agent 'Подтверждены рабочие записи:' 240
 $sourceTask=Read-CompanyRecord $agent 'Поручение' $taskId $taskSha $person $taskText
 $sourceResult=Read-CompanyRecord $agent 'Результат' $taskId $taskSha $person ([string](12*45+80))
 Need ($sourceTask.revision -ceq $sourceResult.revision) 'EMPLOYEE_LICENSED_EXCHANGE_TASK_RESULT_REVISION_MISMATCH'
 Record 'AGENT_ORIGINAL_EXCHANGE_EXACT_TASK_AND_RESULT'
 Stage 'AGENT_EXCHANGE_EXPORT'
 Exchange-Action $agent 'packages-tab-export'
 Exchange-Action $agent 'iwxa-exchange-export-preview'
 Exchange-Confirm $agent 'iwxa-exchange-ack-sensitive' 'iwxa-exchange-export-package'
 Exchange-Action $agent 'iwxa-exchange-export-package'
 $companyArchive=Join-Path $work 'company-return.iwxa'
 $transfer=Export-CompanyArchive $agent $companyArchive
 Exchange-Confirm $agent 'iwxa-exchange-confirm-saved-file' 'iwxa-exchange-export-confirm'
 Exchange-Action $agent 'iwxa-exchange-export-confirm'
 Wait-Text $agent 'Сохранение архива подтверждено вами' 240
 Wait-Text $agent 'Она не означает, что другой получатель импортировал .iwxa.' 240
 Record 'AGENT_ORIGINAL_EXCHANGE_PHYSICAL_ARCHIVE_SAVED'
 Stage 'CENTER_EXCHANGE_BEFORE_IMPORT'
 Open-CenterExchange $cen
 Exchange-Action $cen 'iwxa-company-readback-refresh'
 Wait-Text $cen 'Подтверждены рабочие записи:' 240
 Need (!(Has-Text $cen ('Результат: '+$taskId) $true)) 'EMPLOYEE_LICENSED_EXCHANGE_RESULT_ALREADY_PRESENT'
 Record 'CENTER_EXACT_RESULT_ABSENT_BEFORE_TRANSFER'
 Stage 'CENTER_EXCHANGE_IMPORT'
 Exchange-Action $cen 'packages-tab-import'
 Need ((Digest $companyArchive) -ceq $transfer.fileSha256) 'EMPLOYEE_LICENSED_EXCHANGE_TRANSFER_BYTES_CHANGED'
 Import-CompanyArchive $cen $companyArchive
 Exchange-Action $cen 'iwxa-exchange-import-commit'
 $receivedDigest=Exchange-ReadValue $cen 'iwxa-exchange-import-receipt-digest' '^[a-f0-9]{64}$'
 Need ($receivedDigest -ceq $transfer.packageDigest) 'EMPLOYEE_LICENSED_EXCHANGE_PACKAGE_DIGEST_MISMATCH'
 Need (!(Has-Text $cen 'Импорт выполнен не полностью') -and !(Has-Text $cen 'Импорт требует проверки')) 'EMPLOYEE_LICENSED_EXCHANGE_IMPORT_UNCONFIRMED'
 Exchange-Action $cen 'iwxa-company-readback-refresh'
 $targetTask=Read-CompanyRecord $cen 'Поручение' $taskId $taskSha $person $taskText
 $targetResult=Read-CompanyRecord $cen 'Результат' $taskId $taskSha $person ([string](12*45+80))
 Compare-CompanyRecord $sourceTask $targetTask
 Compare-CompanyRecord $sourceResult $targetResult
 Record 'CENTER_ORIGINAL_EXCHANGE_EXACT_IMPORTED_TASK_AND_RESULT'
 Stage 'CENTER_EXCHANGE_COLD_READBACK'
 Stop-App $cen;$cen=Start-App $CenterExe
 $null=Open-ExactEmployee $cen $person
 Open-CenterExchange $cen
 Exchange-Action $cen 'iwxa-company-readback-refresh'
 $coldTask=Read-CompanyRecord $cen 'Поручение' $taskId $taskSha $person $taskText
 $coldResult=Read-CompanyRecord $cen 'Результат' $taskId $taskSha $person ([string](12*45+80))
 Compare-CompanyRecord $sourceTask $coldTask
 Compare-CompanyRecord $sourceResult $coldResult
 Record 'CENTER_COLD_ORIGINAL_EXCHANGE_EXACT_RESULT_NO_REIMPORT'
 if($atlasMode){
  Stage 'CENTER_PUBLISH_RETURNED_RESULT_TO_ATLAS'
  # The whole original Workspace has already been physically imported and
  # independently reread. Only now publish a selected result to Atlas.
  Press $cen 'К приёмке' $true
  $null=Open-ExactEmployee $cen $person
  $atlas=Publish-AtlasReturn $cen $atlasRef $sourceResult
  Stage 'CENTER_ATLAS_COLD_PUBLICATION_READBACK'
  Close-AtlasClean $atlas;$atlas=$null
  Stop-App $cen;$cen=Start-App $CenterExe
  $null=Open-ExactEmployee $cen $person
  $null=Read-AtlasReturnedResult $cen $taskId $atlasRef $sourceResult
  Press $cen 'Подготовить или проверить передачу'
  Wait-Text $cen 'Result сохранён в исходной работе Atlas.' 360
  Need (!(Has-Text $cen 'Подписать для Atlas' $true)) 'EMPLOYEE_LICENSED_ATLAS_COLD_RESIGN_OFFERED'
  Write-Host 'EMPLOYEE_LICENSED_ATLAS_COLD_NO_RESIGN_PASS'
 }
 # Private continuation receipt for the same installed license lifecycle.
 # Written only after the exact cold readback; never used as a grant.
 Need ($checks.Count -eq 18) 'EMPLOYEE_LICENSED_RETURN_RECEIPTS_INCOMPLETE'
 $ready=Join-Path $handoff 'employee-lifecycle-ready.json'
 Need (!(Test-Path -LiteralPath $ready)) 'EMPLOYEE_LICENSED_LIFECYCLE_RECEIPT_ALREADY_EXISTS'
 [ordered]@{
  schema='IWXA_DISPOSABLE_EMPLOYEE_LIFECYCLE_READY/1'
  status='ORIGINAL_RETURN_DELIVERY_CONFIRMED'
  checks=$checks.Count
  originalHandoffSha256=(Digest (Join-Path $handoff 'receipt.json'))
  organizationId=$receipt.organizationId;licenseId=$receipt.licenseId
  employeePersonId=$person;returnArchiveSha256=$transfer.fileSha256
  agentExecutableSha256=(Digest $agentExe)
  taskId=$taskId;taskPackageSha256=$taskSha
  taskRecord=$sourceTask;resultRecord=$sourceResult
 }|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $ready -Encoding UTF8
 Write-Host ('EMPLOYEE_LICENSED_RETURN_DELIVERY=PASS checks='+$checks.Count)
}catch{
 Write-Host ('EMPLOYEE_LICENSED_FAILURE_STAGE='+$script:stage)
 Write-Host ('EMPLOYEE_LICENSED_FAILURE_STEP='+$script:guiOrdinal)
 Write-Host ('EMPLOYEE_LICENSED_FAILURE_KIND='+$script:guiLastKind)
 throw
}finally{
 [System.Windows.Forms.Clipboard]::Clear()
 foreach($p in @($atlas,$agent,$cen)){
  if($null -ne $p){
   try{Stop-App $p}catch{
    $p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
   }
  }
 }
 Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
