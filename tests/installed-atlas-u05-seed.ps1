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
function Root {
 $proc.Refresh()
 if($proc.HasExited -or $proc.MainWindowHandle -eq [IntPtr]::Zero){
   throw 'U05_INSTALLED_ATLAS_WINDOW_UNAVAILABLE'
 }
 return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
}
function Find-UI([string]$name,[string]$type='Button',[bool]$contains=$false){
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
          (($contains -and $label.Contains($name)) -or (!$contains -and $label -eq $name))){
         return $item
       }
     }catch{}
   }
   Start-Sleep -Milliseconds 240
 }
 throw "U05_INSTALLED_ATLAS_CONTROL_NOT_FOUND $type $name"
}
function Click-UI([string]$name,[bool]$contains=$false){
 $element=Find-UI $name 'Button' $contains
 try{$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()}
 catch{$element.SetFocus();[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')}
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
function Start-Atlas {
 $script:proc=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
 for($i=0;$i -lt 90;$i++){
   Start-Sleep -Milliseconds 300
   $proc.Refresh()
   if($proc.HasExited){throw 'U05_ATLAS_PROCESS_EXITED_EARLY'}
   if($proc.MainWindowHandle -ne [IntPtr]::Zero){break}
 }
 if($proc.MainWindowHandle -eq [IntPtr]::Zero){throw 'U05_ATLAS_WINDOW_MISSING'}
 Wait-Title 'Портфель'
}
function Close-Atlas {
 if($null -eq $proc){return}
 $proc.Refresh()
 if(!$proc.HasExited){
   if(![AtlasU05NativeWin]::PostMessage($proc.MainWindowHandle,0x0010,
       [IntPtr]::Zero,[IntPtr]::Zero)){throw 'U05_ATLAS_CLOSE_SIGNAL_FAILED'}
   if(!$proc.WaitForExit(12000)){throw 'U05_ATLAS_GUI_CLOSE_TIMEOUT'}
 }
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
try{
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
}finally{
 if($null -ne $proc){
   try{Close-Atlas}catch{
     $proc.Refresh()
     if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
     throw
   }
 }
}
