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
}
'@
$atlas=Join-Path $env:LOCALAPPDATA 'ru.iwxa.atlas/atlas-store-v1'
$center=Join-Path $env:LOCALAPPDATA 'IWXA Admin Center/iwxa-admin-center.exe'
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
function Click([string]$name,[bool]$contains=$false) {
  $button=Find-UI $name 'Button' $contains
  try{$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()}
  catch{$button.SetFocus();[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')}
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
  Start-Center
  Click 'Планы Atlas'
  Click 'Открыть Atlas Desktop'
  $revisionText=Find-UI "Atlas Desktop" 'Text' $true
  $title=Find-UI $projectTitle 'Button' $true
  if(!$title){throw 'U05_CANONICAL_PROJECT_NOT_RENDERED'}
  $revisionNode=Find-UI "редакция портфеля: $revision" 'Text' $true
  if(!$revisionNode){throw 'U05_ATLAS_REVISION_NOT_VISIBLE'}
  Click $projectTitle $true
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
  $now=Find-UI "редакция портфеля: $revision" 'Text' $true
  if(!$now){throw 'U05_RESTART_CANONICAL_REVISION_MISMATCH'}
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
