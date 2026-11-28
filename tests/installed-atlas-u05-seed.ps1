# Center U05 installed Atlas GUI seed: use visible native Windows controls.
# Replaces the obsolete pixel-based keyboard driver in the cross-product test.
# Never writes source project blocks directly; native Atlas Save owns persistence.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AtlasU05NativeWin {
 [DllImport("user32.dll",SetLastError=true)]
 public static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$exe=$env:ATLAS_INSTALLED_EXE
if(!$exe -or !(Test-Path -LiteralPath $exe)){throw 'U05_INSTALLED_ATLAS_BINARY_NOT_FOUND'}
$owner=Join-Path $env:LOCALAPPDATA 'ru.iwxa.atlas/atlas-store-v1'
$manifest=Join-Path $owner 'head.json'
$projectName='U05OwnerProject'
$firstWork='U05OwnerAlpha'
$secondWork='U05OwnerBeta'
$script:proc=$null
$script:primaryFailure=$false
$script:signedStage=''
function Root {
 $proc.Refresh()
 if($proc.HasExited -or $proc.MainWindowHandle -eq [IntPtr]::Zero){
   throw 'U05_INSTALLED_ATLAS_WINDOW_UNAVAILABLE'
 }
 return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
}
function Find-UI([string]$name,[string]$type='Button',[bool]$contains=$false,[bool]$visibleOnly=$false,[bool]$enabledOnly=$false){
 $target=switch($type){
   'Edit' {[System.Windows.Automation.ControlType]::Edit}
   'Text' {[System.Windows.Automation.ControlType]::Text}
   default {[System.Windows.Automation.ControlType]::Button}
 }
 for($attempt=0;$attempt -lt 70;$attempt++){
   $items=(Root).FindAll([System.Windows.Automation.TreeScope]::Descendants,
     [System.Windows.Automation.Condition]::TrueCondition)
   foreach($item in $items){
     try{
       $label=[string]$item.Current.Name
       if($item.Current.ControlType -eq $target -and
          (!$visibleOnly -or !$item.Current.IsOffscreen) -and
          (!$enabledOnly -or $item.Current.IsEnabled) -and
          (($contains -and $label.Contains($name)) -or (!$contains -and $label -eq $name))){
         return $item
       }
     }catch{}
   }
   Start-Sleep -Milliseconds 240
 }
 try{
   $observed=@((Root).FindAll([System.Windows.Automation.TreeScope]::Descendants,
     [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
       try{if($_.Current.Name){[string]$_.Current.ControlType.ProgrammaticName+' '+[string]$_.Current.Name}}catch{}
     } | Select-Object -First 80)
   Write-Host ("U05_ATLAS_UIA_DIAGNOSTIC "+($observed -join ' | '))
 }catch{}
 throw "U05_INSTALLED_ATLAS_CONTROL_NOT_FOUND $type $name title=$($proc.MainWindowTitle)"
}
function Click-UI([string]$name,[bool]$contains=$false,[bool]$requireReady=$false){
 $element=Find-UI $name 'Button' $contains $requireReady $requireReady
 if($requireReady){
   # The native navigation notification can arrive before the asynchronous
   # original Consumer route. Observe the enabled control, not just its label.
   # Do not send a second activation after an uncertain Invoke outcome.
   $pattern=$null
   if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){
     ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
   }else{
     $element.SetFocus()
     [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
   }
 }else{
   try{$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()}
   catch{$element.SetFocus();[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')}
 }
 Start-Sleep -Milliseconds 350
}
function Fill-UI([string]$name,[string]$value){
 $element=Find-UI $name 'Edit'
 $element.SetFocus()
 Start-Sleep -Milliseconds 130
 [System.Windows.Forms.SendKeys]::SendWait('^a')
 if($value -match '[+^%~{}()]'){throw 'U05_UNSAFE_GUI_FIXTURE_TEXT'}
 [System.Windows.Forms.SendKeys]::SendWait($value)
 Start-Sleep -Milliseconds 150
}
function Wait-Title([string]$fragment){
 for($i=0;$i -lt 72;$i++){
   $proc.Refresh()
   if($proc.HasExited){throw 'U05_ATLAS_CLOSED_BEFORE_EXPECTED_VIEW'}
   if($proc.MainWindowTitle.Contains($fragment)){return}
   Start-Sleep -Milliseconds 250
 }
 throw "U05_ATLAS_VIEW_NOT_SHOWN $fragment actual=$($proc.MainWindowTitle)"
}
function Start-Atlas([string[]]$arguments=@()) {
 if($arguments.Count -gt 0){
   $script:proc=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList $arguments -PassThru
 }else{
   $script:proc=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
 }
 for($i=0;$i -lt 90;$i++){
   Start-Sleep -Milliseconds 300
   $proc.Refresh()
   if($proc.HasExited){throw 'U05_ATLAS_PROCESS_EXITED_EARLY'}
   if($proc.MainWindowHandle -ne [IntPtr]::Zero){break}
 }
 if($proc.MainWindowHandle -eq [IntPtr]::Zero){throw 'U05_ATLAS_WINDOW_MISSING'}
 # WebView2 can expose the native window before React and the original
 # store are ready. Observe the actual rendered controls as well as title.
 $lastReadyState='NO_RENDERED_WORKSPACE'
 for($i=0;$i -lt 160;$i++){
   $proc.Refresh()
   if($proc.HasExited){throw 'U05_ATLAS_PROCESS_EXITED_EARLY'}
   if($proc.MainWindowTitle.Contains('Портфель')){return}
   try{
     $elements=@((Root).FindAll([System.Windows.Automation.TreeScope]::Descendants,
       [System.Windows.Automation.Condition]::TrueCondition))
     $names=@(foreach($element in $elements){
       try{if(!$element.Current.IsOffscreen){[string]$element.Current.Name}}catch{}
     })
     if(($names -contains 'Открыть портфель проектов' -or $names -contains 'Портфель') -and
        ($names -contains 'Создать проект' -or $names -contains 'Файл')){
       Write-Host 'U05_ATLAS_WORKSPACE_RENDERED_WITHOUT_TITLE_UPDATE'
       return
     }
     if($names -contains 'Восстановить сохранённую версию'){throw 'U05_ATLAS_STARTUP_RECOVERY_REQUIRED'}
     if($names -contains 'Открытие нативного хранилища…'){$lastReadyState='NATIVE_STORE_OPEN_PENDING'}
     elseif($elements.Count -gt 2){$lastReadyState='RENDERED_ENTRY_NOT_READY'}
   }catch{
     if($_.Exception.Message -eq 'U05_ATLAS_STARTUP_RECOVERY_REQUIRED'){throw}
   }
   Start-Sleep -Milliseconds 250
 }
 Write-Host "U05_ATLAS_STARTUP_STATE $lastReadyState"
 throw "U05_ATLAS_WORKSPACE_NOT_READY $lastReadyState"
}
function Close-Atlas {
 if($null -eq $proc){return}
 $proc.Refresh()
 if(!$proc.HasExited){
   Write-Host 'U05_ATLAS_CLOSE_REQUESTED'
   if(![AtlasU05NativeWin]::PostMessage($proc.MainWindowHandle,0x0010,
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
       $controls=@((Root).FindAll([System.Windows.Automation.TreeScope]::Descendants,
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
       [void][AtlasU05NativeWin]::PostMessage($proc.MainWindowHandle,0x0010,
         [IntPtr]::Zero,[IntPtr]::Zero)
       Write-Host 'U05_ATLAS_SECOND_CLOSE_REQUESTED'
     }
   }
   $proc.Refresh()
   if(!$proc.HasExited){throw 'U05_ATLAS_GUI_CLOSE_TIMEOUT'}
 }
 Write-Host 'U05_ATLAS_GUI_CLOSED'
 $script:proc=$null
}
function Owner-Snapshot {
 if(!(Test-Path -LiteralPath $manifest)){return $null}
 $head=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json -Depth 100
 $projects=@(foreach($entry in @($head.projects)){
   $path=Join-Path (Join-Path $owner 'blocks') ([string]$entry.sha256+'.json')
   $content=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -Depth 100
   if([string]$content.id -ne [string]$entry.id){throw 'U05_NATIVE_OWNER_ID_MISMATCH'}
   $content
 })
 return [pscustomobject]@{head=$head;projects=$projects}
}
function Await-Owner([int]$works,[string]$previous){
 for($i=0;$i -lt 100;$i++){
   try{
     $saved=Owner-Snapshot
     $project=@($saved.projects | Where-Object {$_.name -eq $projectName})
     if($project.Count -eq 1 -and @($project[0].items).Count -eq $works -and
        [string]$saved.head.generation -ne $previous){return $saved}
   }catch{}
   Start-Sleep -Milliseconds 250
 }
 throw "U05_OWNER_NATIVE_READBACK_NOT_OBSERVED works=$works"
}
# Reuse this installed GUI driver for the original T3 signed-file witness.
# The fixture is supplied by the private original T3 test, never generated or
# signed here. All persistence is through the actual Atlas UI and U05 store.
function Await-SignedText([string]$fragment){
 for($i=0;$i -lt 120;$i++){
   $items=(Root).FindAll([System.Windows.Automation.TreeScope]::Descendants,
     [System.Windows.Automation.Condition]::TrueCondition)
   foreach($item in $items){
     try{if(([string]$item.Current.Name).Contains($fragment)){return}}catch{}
   }
   Start-Sleep -Milliseconds 250
 }
 $stage=switch -Wildcard ($fragment){
   'Result передан из Center*' {'HANDOFF_NOTICE'}
   'Оригинальный T3*' {'PREVIEW'}
   'Этот Result*' {'COLD_PREVIEW'}
   'План изменился с момента*' {'HISTORICAL_EDITION'}
   'Выбранный подписанный*' {'READBACK'}
   'Полученные результаты работ*' {'PLAN_FACT'}
   'U05OwnerAlpha · Result*' {'EXACT_WORK'}
   default {'SELECTED_CONTENT'}
 }
 throw ('ATLAS_U05_SIGNED_UI_TEXT_NOT_OBSERVED_'+$stage)
}
# In standalone v6 Atlas, the legacy commandbar and its "Сохранение и
# копии" menu are hidden by CSS. The real menu lives in AtlasChromeTopbar.
# HTML summary can appear as Button or another accessible disclosure type.
function Open-AtlasFileMenu{
 for($i=0;$i -lt 70;$i++){
   $items=(Root).FindAll([System.Windows.Automation.TreeScope]::Descendants,
     [System.Windows.Automation.Condition]::TrueCondition)
   foreach($item in $items){
     try{
       if([string]$item.Current.Name -cne 'Файл' -or $item.Current.IsOffscreen -or !$item.Current.IsEnabled){continue}
       try{
         $expand=$item.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
         if($expand.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded){$expand.Expand()}
       }catch{
         try{$item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()}
         catch{$item.SetFocus();[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')}
       }
       Start-Sleep -Milliseconds 250
       return
     }catch{}
   }
   Start-Sleep -Milliseconds 240
 }
 throw 'ATLAS_U05_SIGNED_FILE_MENU_NOT_FOUND'
}
function Open-SignedFile([string]$archive){
 Open-AtlasFileMenu
 try{$control=Find-UI 'Принять подписанный Result .iwxa' 'Button' $false $true $true}
 catch{throw 'ATLAS_U05_SIGNED_FILE_ACTION_NOT_FOUND'}
 if(!$control.Current.IsEnabled -or $control.Current.IsOffscreen){throw 'ATLAS_U05_SIGNED_FILE_ACTION_DISABLED'}
 # Real keyboard activation preserves the WebView file picker's user gesture.
 $control.SetFocus()
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 $dialog=$null
 for($i=0;$i -lt 80;$i++){
   $handle=[AtlasU05NativeWin]::GetForegroundWindow()
   if($handle -ne [IntPtr]::Zero -and $handle -ne $proc.MainWindowHandle){
     try{
       $candidate=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
       if($candidate.Current.ClassName -eq '#32770'){$dialog=$candidate;break}
     }catch{}
   }
   Start-Sleep -Milliseconds 150
 }
 if($null -eq $dialog){throw 'ATLAS_U05_SIGNED_FILE_DIALOG_NOT_OPEN'}
 $field=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
   [System.Windows.Automation.PropertyCondition]::new(
     [System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1148'))
 $set=$false
 if($null -ne $field){
   try{
     if($field.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox){
       $field=$field.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
         [System.Windows.Automation.PropertyCondition]::new(
           [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
           [System.Windows.Automation.ControlType]::Edit))
     }
     $value=$field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
     $value.SetValue($archive)
     $set=([string]$value.Current.Value -ceq $archive)
   }catch{}
 }
 if(!$set){
   if($archive -match '[+^%~{}()]'){throw 'ATLAS_U05_SIGNED_FILE_PATH_UNSUPPORTED'}
   [System.Windows.Forms.SendKeys]::SendWait('%n')
   Start-Sleep -Milliseconds 150
   [System.Windows.Forms.SendKeys]::SendWait('^a')
   [System.Windows.Forms.SendKeys]::SendWait($archive)
 }
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 # Wait for the real signed-file review, not just disappearance of the dialog.
 Assert-SignedPreview
}
function Assert-SignedPreview{
 Await-SignedText 'Оригинальный T3 проверил подпись'
 $preview=Find-UI 'Оригинальный подписанный текст Result' 'Edit'
 $text=$preview.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
 if([string]$text.Current.Value -cne $env:ATLAS_U05_SIGNED_RESULT_SUMMARY){
   throw 'ATLAS_U05_SIGNED_PREVIEW_TEXT_MISMATCH'
 }
}
function Read-SignedDecision($saved,[string]$sha){
 $prefix='T3_RESULT_LINK/1 '
 $matches=@(foreach($project in @($saved.projects)){
   foreach($decision in @($project.decisions)){
     $text=[string]$decision.text
     if($text.StartsWith($prefix)){
       $row=$text.Substring($prefix.Length)|ConvertFrom-Json -Depth 100
       if($row.archiveSha256 -ceq $sha){
         [pscustomobject]@{project=$project;decision=$decision;row=$row}
       }
     }
   }
 })
 if($matches.Count -gt 1){throw 'ATLAS_U05_SIGNED_DUPLICATE_DECISION'}
 if($matches.Count -eq 1){return $matches[0]}
 return $null
}
function Receive-SignedResult{
 $script:signedStage='PREPARE'
 $archive=$env:ATLAS_U05_SIGNED_RESULT_FILE
 $sha=$env:ATLAS_U05_SIGNED_RESULT_SHA256
 $issuedRevision=$env:ATLAS_U05_SIGNED_SOURCE_REVISION
 $expectedKind=$env:ATLAS_U05_SIGNED_SOURCE_KIND
 if(!$expectedKind){$expectedKind='ADMIN_APPLIED_RESULT'}
 if($expectedKind -notin @('ADMIN_APPLIED_RESULT','ADMIN_WORKSPACE_RESULT')){throw 'ATLAS_U05_SIGNED_SOURCE_KIND_INVALID'}
 if($issuedRevision -notmatch '^(0|[1-9][0-9]*)$'){throw 'ATLAS_U05_SIGNED_ISSUED_REVISION_REQUIRED'}
 if(!(Test-Path -LiteralPath $archive -PathType Leaf) -or $sha -notmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sha){
   throw 'ATLAS_U05_SIGNED_FIXTURE_MISMATCH'
 }
 $before=Owner-Snapshot
 if([long]$before.head.revision -le [long]$issuedRevision){
   throw 'ATLAS_U05_SIGNED_HISTORICAL_EDITION_NOT_ADVANCED'
 }
 $project=@($before.projects|Where-Object {$_.name -ceq $projectName})
 if($project.Count -ne 1){throw 'ATLAS_U05_SIGNED_PROJECT_REQUIRED'}
 $work=@($project[0].items|Where-Object {$_.title -ceq $firstWork})
 if($work.Count -ne 1 -or $null -ne (Read-SignedDecision $before $sha)){
   throw 'ATLAS_U05_SIGNED_FRESH_WORK_REQUIRED'
 }
 if($expectedKind -eq 'ADMIN_WORKSPACE_RESULT'){
   # Exercise the actual local Atlas launch and signed preview using the
   # existing exact original carrier fixture. No Atlas Store injection.
   # This is NOT a witness that an installed Center performed the export.
   $centerReg=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center' -ErrorAction SilentlyContinue
   $centerRoot=if($null -ne $centerReg -and $centerReg.DataLocation){
      [string]$centerReg.DataLocation
   }else{Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center'}
   $handoffRoot=Join-Path $centerRoot 'atlas-handoff'
   New-Item -ItemType Directory -Path $handoffRoot -Force|Out-Null
   $handoffId=[guid]::NewGuid().ToString()
   $handoffPath=Join-Path $handoffRoot ($handoffId+'.iwxa')
   Copy-Item -LiteralPath $archive -Destination $handoffPath
   try{
     $script:signedStage='HANDOFF_LAUNCH'
     Start-Atlas @('--iwxa-open-result',$handoffId,$sha)
     $script:signedStage='HANDOFF_NOTICE'
     Await-SignedText 'Result передан из Center'
     $script:signedStage='HANDOFF_OPEN'
     Click-UI 'Открыть переданный Result' $false $true
     $script:signedStage='HANDOFF_PREVIEW'
     Assert-SignedPreview
     if(Test-Path -LiteralPath $handoffPath){throw 'ATLAS_U05_SIGNED_HANDOFF_NOT_CONSUMED'}
     Write-Host 'ATLAS_INSTALLED_SIGNED_LOCAL_HANDOFF_PREVIEW_PASS'
   }finally{
     Remove-Item -LiteralPath $handoffPath -Force -ErrorAction SilentlyContinue
   }
 }else{
   $script:signedStage='FILE_LAUNCH'
   Start-Atlas
   $script:signedStage='FILE_PREVIEW'
   Open-SignedFile $archive
 }
 $script:signedStage='HISTORICAL_PREVIEW'
 Await-SignedText 'План изменился с момента выдачи поручения.'
 $script:signedStage='CONFIRM'
 Click-UI 'Подтвердить получение' $false $true
 Await-SignedText 'Выбранный подписанный Result сохранён в Atlas'
 $script:signedStage='NATIVE_READBACK'
 $saved=Owner-Snapshot
 $entry=Read-SignedDecision $saved $sha
 if($null -eq $entry -or $saved.head.generation -ceq $before.head.generation -or
    [long]$saved.head.revision -ne ([long]$before.head.revision+1) -or
    $entry.project.id -cne $project[0].id -or $entry.row.projectId -cne $project[0].id -or
    $entry.row.workId -cne $work[0].id -or
    [string]$entry.row.sourceRevision -cne $issuedRevision -or
    $entry.row.sourceKind -cne $expectedKind -or
    $entry.row.signedFileMode -ne $true -or $entry.row.originalKernelEventVerified -ne $false -or
    $entry.row.selectedAcceptedSummary -cne $env:ATLAS_U05_SIGNED_RESULT_SUMMARY){
   throw 'ATLAS_U05_SIGNED_NATIVE_DECISION_MISMATCH'
 }
 if($expectedKind -eq 'ADMIN_WORKSPACE_RESULT' -and
    ($entry.row.sourceObjectRef.schema_id -cne 'iwxa.t3.company-work-record' -or
     $entry.row.taskObjectId -notmatch '^company:work:[a-f0-9]{64}$' -or
     !$entry.row.taskEventId -or !$entry.row.resultEventId -or
     $null -ne $entry.row.acceptanceId -or $null -ne $entry.row.applicationEffectKey)){
   throw 'ATLAS_U05_SIGNED_WORKSPACE_PROVENANCE_MISMATCH'
 }
 # A received Result is evidence, not an implicit edit of the original plan.
 if(($entry.project.items|ConvertTo-Json -Depth 100 -Compress) -cne
    ($project[0].items|ConvertTo-Json -Depth 100 -Compress) -or
    ($entry.project.dependencies|ConvertTo-Json -Depth 100 -Compress) -cne
    ($project[0].dependencies|ConvertTo-Json -Depth 100 -Compress)){
   throw 'ATLAS_U05_SIGNED_UNREQUESTED_PLAN_MUTATION'
 }
 $unrelatedBefore=@($before.projects|Where-Object {$_.id -cne $project[0].id})
 $unrelatedAfter=@($saved.projects|Where-Object {$_.id -cne $project[0].id})
 if($unrelatedBefore.Count -lt 1 -or $unrelatedBefore.Count -ne $unrelatedAfter.Count -or
    (ConvertTo-Json -InputObject $unrelatedBefore -Depth 100 -Compress) -cne
    (ConvertTo-Json -InputObject $unrelatedAfter -Depth 100 -Compress)){
   throw 'ATLAS_U05_SIGNED_UNRELATED_PROJECT_CHANGED'
 }
 # Receipt navigation must expose the exact existing Plan / Fact card.
 # The preview dialog was already closed by the confirmed native readback.
 $script:signedStage='PLAN_FACT'
 Await-SignedText 'Полученные результаты работ'
 Await-SignedText ($firstWork+' · Result '+[string]$entry.row.resultId)
 Await-SignedText $env:ATLAS_U05_SIGNED_RESULT_SUMMARY
 $generation=[string]$saved.head.generation
 $decisionId=[string]$entry.decision.id
 $script:signedStage='COLD_LAUNCH'
 Close-Atlas
 Start-Atlas
 $script:signedStage='COLD_PREVIEW'
 Open-SignedFile $archive
 Await-SignedText 'Этот Result уже сохранён в Atlas'
 $script:signedStage='COLD_RECEIPT'
 Click-UI 'Проверить квитанцию' $false $true
 Await-SignedText 'Выбранный подписанный Result сохранён в Atlas'
 Await-SignedText 'Полученные результаты работ'
 Await-SignedText ($firstWork+' · Result '+[string]$entry.row.resultId)
 Await-SignedText $env:ATLAS_U05_SIGNED_RESULT_SUMMARY
 $script:signedStage='COLD_NATIVE_READBACK'
 $cold=Owner-Snapshot
 $observed=Read-SignedDecision $cold $sha
 if($null -eq $observed -or $cold.head.generation -cne $generation -or
    $observed.decision.id -cne $decisionId -or $observed.decision.text -cne $entry.decision.text){
   throw 'ATLAS_U05_SIGNED_COLD_READBACK_CHANGED'
 }
 Write-Host 'ATLAS_INSTALLED_SIGNED_HISTORICAL_RESULT_PASS'
 Write-Host 'ATLAS_INSTALLED_SIGNED_RESULT_GUI_PASS'
}
try{
 if($env:ATLAS_U05_SIGNED_RESULT_FILE){
   Receive-SignedResult
   return
 }
 $append=$env:ATLAS_U05_APPEND_PROJECT -eq '1'
 $before=Owner-Snapshot
 if(!$append -and $null -ne $before){
   throw 'U05_OWNER_SEED_EXPECTED_FRESH_PROFILE'
 }
 if($append){
   $source=@($before.projects|Where-Object {$_.name -eq $projectName})
   if($source.Count -ne 1 -or @($source[0].items).Count -ne 2){
     throw 'U05_OWNER_PREVIOUS_GUI_WORKS_NOT_PRESENT'
   }
   $previous=[string]$before.head.generation
   Start-Atlas
   Click-UI 'Портфель'
   Click-UI '＋ Новый проект'
   Wait-Title 'Форма: Новый проект'
   Fill-UI 'Название проекта' 'U05AfterCenterLink'
   Click-UI 'Применить к черновику'
   Wait-Title 'U05AfterCenterLink'
   Click-UI 'Сохранить'
   $saved=$null
   for($i=0;$i -lt 100;$i++){
     try{
       $candidate=Owner-Snapshot
       if([string]$candidate.head.generation -ne $previous -and
          @($candidate.projects|Where-Object {$_.name -eq 'U05AfterCenterLink'}).Count -eq 1){
         $saved=$candidate
         break
       }
     }catch{}
     Start-Sleep -Milliseconds 250
   }
   if(!$saved){throw 'U05_OWNER_GUI_NEW_REVISION_NOT_PERSISTED'}
   $originalProject=@($saved.projects|Where-Object {$_.name -eq $projectName})
   if($originalProject.Count -ne 1 -or @($originalProject[0].items).Count -ne 2){
     throw 'U05_OWNER_OLD_WORKS_CHANGED_AFTER_APPEND'
   }
   Write-Host "U05_OWNER_GUI_REVISION_ADVANCED_PASS version=$($saved.head.revision)"
 }else{
   Start-Atlas
   Click-UI 'Портфель'
   Click-UI '＋ Новый проект'
   Wait-Title 'Форма: Новый проект'
   Fill-UI 'Название проекта' $projectName
   Click-UI 'Применить к черновику'
   Wait-Title "$projectName — Обзор"
   Click-UI 'Сохранить'
   $saved=Await-Owner 0 'none'
   Click-UI 'Таблица'
   Wait-Title 'Таблица'
   foreach($name in @($firstWork,$secondWork)){
     Click-UI '＋ Работа'
     Wait-Title 'Форма: Новая работа'
     Fill-UI 'Что нужно сделать?' $name
     Click-UI 'Применить к черновику'
     Wait-Title 'Таблица · Не сохранено'
   }
   Click-UI 'Сохранить'
   $result=Await-Owner 2 ([string]$saved.head.generation)
   $project=@($result.projects|Where-Object {$_.name -eq $projectName})[0]
   if(@($project.items|ForEach-Object {$_.title}) -notcontains $firstWork -or
      @($project.items|ForEach-Object {$_.title}) -notcontains $secondWork){
     throw 'U05_OWNER_GUI_WORK_TITLES_DID_NOT_SURVIVE_NATIVE_SAVE'
   }
   Write-Host "U05_INSTALLED_ATLAS_GUI_TWO_WORKS_PASS version=$($result.head.revision)"
 }
}catch{
 $script:primaryFailure=$true
 if($script:signedStage){
   # Only fixed stage and error-kind tokens leave the private log. The
   # existing CI filter will never need to print a source path or Result text.
   $failureKind=switch($_.Exception){
     {$_ -is [System.Windows.Automation.ElementNotAvailableException]} {'UIA_STALE';break}
     {$_ -is [System.Runtime.InteropServices.COMException]} {'UIA_COM';break}
     {$_ -is [System.Management.Automation.MethodInvocationException]} {'INVOCATION';break}
     {$_ -is [System.Management.Automation.ParameterBindingException]} {'PARAMETER';break}
     {$_ -is [System.IO.IOException]} {'IO';break}
     default {'OTHER'}
   }
   Write-Host ('ATLAS_U05_SIGNED_FAILURE_STAGE_'+$script:signedStage)
   Write-Host ('ATLAS_U05_SIGNED_FAILURE_KIND_'+$failureKind)
 }
 # Retain the actual product or UI failure if cleanup also encounters a
 # modal or a delayed close. The private log filter prints stable codes.
 Write-Host "U05_ATLAS_PRIMARY_FAILURE $($_.Exception.Message)"
 throw
}finally{
 if($null -ne $proc){
   try{Close-Atlas}catch{
     $proc.Refresh()
     if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
     Write-Host 'U05_ATLAS_CLEANUP_CLOSE_FAILED'
     if(!$script:primaryFailure){throw}
   }
 }
}
