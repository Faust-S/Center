# Native Windows installed-app qualification. Uses the real WebView2 UI via
# Windows UI Automation; no Chromium/CDP or synthetic native-store writes.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

# Post WM_CLOSE to the real installed Tauri HWND, identical to clicking X in
# the window chrome. The UIA Window root itself is not focusable in WebView2.
# Do not kill the process or bypass the application's window-close lifecycle.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CenterNativeWindow {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@

$artifactDir=Join-Path $env:GITHUB_WORKSPACE 'artifacts'
[void][System.IO.Directory]::CreateDirectory($artifactDir)
$proc=$null
$exe=$null
$base=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center\atlas-store-v1'
$organizationsRoot=Join-Path $base 'organizations'
$localDraft=Join-Path $base 'preparation\draft.json'
$expectedProject='CenterGUIProject'
$expectedWork='CenterGUIWork'
$expectedAssignment='CenterGUIAssignment'

function Capture-CenterFailure {
  try {
    $bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp=[System.Drawing.Bitmap]::new($bounds.Width,$bounds.Height)
    $gfx=[System.Drawing.Graphics]::FromImage($bmp)
    try {
      $gfx.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size)
      $bmp.Save((Join-Path $artifactDir 'installed-gui-failure.png'),[System.Drawing.Imaging.ImageFormat]::Png)
    } finally {$gfx.Dispose();$bmp.Dispose()}
  } catch {Write-Warning "Screenshot failed: $($_.Exception.Message)"}
}
function Start-Center {
  $script:proc=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
  for($i=0;$i -lt 90;$i++){
    Start-Sleep -Milliseconds 400
    $script:proc.Refresh()
    if($script:proc.HasExited){throw "Installed Center exited early: $($script:proc.ExitCode)"}
    if($script:proc.MainWindowHandle -ne [IntPtr]::Zero){break}
  }
  if($script:proc.MainWindowHandle -eq [IntPtr]::Zero){throw 'Installed Center did not show a native window'}
  Write-Host "CENTER_INSTALLED_NATIVE_WINDOW_PASS pid=$($script:proc.Id)"
}
function Root-Element {
  $proc.Refresh()
  if($proc.HasExited){throw 'Installed GUI closed during qualification'}
  $h=$proc.MainWindowHandle
  if($h -eq [IntPtr]::Zero){throw 'Native GUI handle unavailable'}
  return [System.Windows.Automation.AutomationElement]::FromHandle($h)
}
function Find-Control([string]$name,[string]$kind='Button',[int]$attempts=65){
  $desired=if($kind -eq 'Edit'){
    [System.Windows.Automation.ControlType]::Edit
  } else {
    [System.Windows.Automation.ControlType]::Button
  }
  $condition=[System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::NameProperty,$name
  )
  for($i=0;$i -lt $attempts;$i++){
    $root=Root-Element
    $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
    foreach($node in $nodes){
      try{if($node.Current.ControlType -eq $desired){return $node}}
      catch{}
    }
    Start-Sleep -Milliseconds 350
  }
  throw "UI Automation control not found: $kind '$name'"
}
function Click-Control([string]$name){
  $control=Find-Control $name 'Button'
  try {
    $pattern=$control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
  } catch {
    $control.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
  Start-Sleep -Milliseconds 350
}
# Button accessible names include dynamic React badge counts (e.g. "Поручения 1").
# Keep exact-name matching for ordinary controls; use substring match for
# navigation where the badge is an intentional part of the accessible name.
function Click-ButtonContaining([string]$name){
  $control=Find-ProjectButton $name
  try {
    $pattern=$control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
  } catch {
    $control.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
  Start-Sleep -Milliseconds 350
}
function Type-Control([string]$name,[string]$value){
  $control=Find-Control $name 'Edit'
  $control.SetFocus()
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  # These CI fixture names are deliberately ASCII; SendKeys special characters
  # do not reinterpret the input and alter the intended data.
  [System.Windows.Forms.SendKeys]::SendWait($value)
  Start-Sleep -Milliseconds 200
}
function Find-ProjectButton([string]$text){
  for($i=0;$i -lt 65;$i++){
    $root=Root-Element
    $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($control in $all){
      try{
        if($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
           $control.Current.Name.Contains($text)){
          return $control
        }
      } catch{}
    }
    Start-Sleep -Milliseconds 350
  }
  throw "Project not visible in installed GUI: $text"
}
function Read-NativeProject {
  if(!(Test-Path $organizationsRoot)){return $null}
  $heads=@(Get-ChildItem -LiteralPath $organizationsRoot -Filter 'head.json' -Recurse -File -ErrorAction SilentlyContinue)
  if($heads.Count -ne 1){return $null}
  $head=$heads[0]|Get-Content -Raw|ConvertFrom-Json -Depth 100
  if(@($head.projects).Count -ne 1){return $null}
  $blockId=[string]$head.projects[0].sha256
  if($blockId -notmatch '^[a-f0-9]{64}$'){throw 'Native Atlas manifest block hash is invalid'}
  $root=$heads[0].DirectoryName
  $blockFile=Join-Path (Join-Path $root 'blocks') ($blockId+'.json')
  if(!(Test-Path $blockFile)){throw 'Native Atlas block missing'}
  $project=Get-Content -LiteralPath $blockFile -Raw | ConvertFrom-Json -Depth 100
  return [pscustomobject]@{generation=[string]$head.generation;revision=[long]$head.revision;
    organizationId=Split-Path $root -Leaf;project=$project}
}
function Wait-SavedProject([int]$expectedWorkCount){
  for($i=0;$i -lt 90;$i++){
    $snapshot=Read-NativeProject
    if($null -ne $snapshot -and $snapshot.project.name -eq $expectedProject -and
      @($snapshot.project.items).Count -eq $expectedWorkCount){
      if($expectedWorkCount -eq 0 -or (@($snapshot.project.items|ForEach-Object{$_.title}) -contains $expectedWork)){
        return $snapshot
      }
    }
    Start-Sleep -Milliseconds 350
  }
  throw "Native Atlas did not persist project/work count $expectedWorkCount"
}
function Close-Center {
  $proc.Refresh()
  if($proc.HasExited){throw 'Installed GUI exited before deliberate close'}
  $window=$proc.MainWindowHandle
  if($window -eq [IntPtr]::Zero){throw 'Installed Center window handle unavailable before close'}
  # WM_CLOSE goes to the native window itself; UIA root.SetFocus() is invalid.
  if(-not [CenterNativeWindow]::PostMessage($window,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){
    throw 'Installed Center could not receive native WM_CLOSE'
  }
  if(!$proc.WaitForExit(9000)){
    throw 'Installed Center did not close after native window close'
  }
  if($proc.ExitCode -ne 0){throw "Installed Center exit code $($proc.ExitCode)"}
  Write-Host "CENTER_INSTALLED_GUI_GRACEFUL_WINDOW_CLOSE_PASS"
}

try {
  $installer=Get-ChildItem 'src-tauri/target/release/bundle/nsis/*.exe'|Select-Object -First 1
  if(!$installer){throw 'NSIS installer absent'}
  $installProcess=Start-Process -FilePath $installer.FullName -ArgumentList '/S' -PassThru
  if(!$installProcess.WaitForExit(120000)){Stop-Process -Id $installProcess.Id -Force;throw 'Installer timed out'}
  if($installProcess.ExitCode -ne 0){throw "Installer failed: $($installProcess.ExitCode)"}
  $candidates=@(
    (Join-Path $env:LOCALAPPDATA 'IWXA Admin Center\iwxa-admin-center.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\IWXA Admin Center\iwxa-admin-center.exe')
  )
  $exe=$candidates|Where-Object {Test-Path $_}|Select-Object -First 1
  if(!$exe){throw "Installer exited but no installed app found: $($candidates -join '; ')"}
  Write-Host "CENTER_NSIS_INSTALL_PASS exe=$exe"
  if(Test-Path $localDraft){throw 'Windows runner already contains Center draft state'}
  if(Test-Path $organizationsRoot){throw 'Windows runner already contains Center organizational Atlas data'}
  Start-Center
  Type-Control 'Название' 'CenterGUIOrganization'
  Click-Control 'Создать черновик организации'
  Click-Control 'Планы Atlas'
  Type-Control 'Название рабочей области' 'CenterGUIWorkspace'
  Click-Control 'Добавить'
  Click-Control 'Открыть локальный Atlas'
  Type-Control 'Новый проект Atlas' $expectedProject
  Click-Control 'Создать проект'
  $projectOnly=Wait-SavedProject 0
  $visible=Find-ProjectButton $expectedProject
  if(!$visible){throw 'Native Atlas project was stored but was not rendered'}
  Write-Host "CENTER_INSTALLED_GUI_ATLAS_PROJECT_READBACK_PASS generation=$($projectOnly.generation)"
  Type-Control 'Работа Atlas' $expectedWork
  Click-Control 'Добавить работу'
  $saved=Wait-SavedProject 1
  if($saved.revision -lt 2){throw 'Atlas did not advance native revision'}
  $projectId=[string]$saved.project.id
  $workId=[string]$saved.project.items[0].id
  if([string]::IsNullOrWhiteSpace($projectId) -or [string]::IsNullOrWhiteSpace($workId)){
    throw 'Native Atlas project/work identifiers are missing'
  }
  if($projectId -ne [string]$projectOnly.project.id -or
     $saved.organizationId -ne $projectOnly.organizationId){
    throw 'Native Atlas project identity changed while creating a work item'
  }
  Click-Control 'Связать с рабочей областью'
  Click-Control 'Подготовить поручение по работе'
  Type-Control 'Что нужно сделать' $expectedAssignment
  Type-Control 'Критерии приёмки' 'Verified delivery report'
  Click-Control 'Сохранить черновик'
  Click-Control 'Сохранить на компьютере'
  for($i=0;$i -lt 60 -and !(Test-Path $localDraft);$i++){Start-Sleep -Milliseconds 300}
  if(!(Test-Path $localDraft)){throw 'Manager draft not stored locally'}
  $draft=Get-Content -LiteralPath $localDraft -Raw | ConvertFrom-Json -Depth 100
  if($draft.organizations[0].id -ne $saved.organizationId){
    throw 'Saved Center organization does not match native Atlas organization root'
  }
  if(@($draft.organizations[0].assignments).Count -ne 1){
    throw 'Manager assignment draft was not persisted'
  }
  $task=$draft.organizations[0].assignments[0]
  if($task.title -ne $expectedAssignment -or
     $task.atlasRef.projectId -ne $projectId -or
     $task.atlasRef.workId -ne $workId -or
     [string]$task.atlasRef.revision -ne [string]$saved.revision -or
     $task.status -ne 'DRAFT'){
    throw 'Assignment lost exact Atlas work and revision binding'
  }
  Write-Host "CENTER_INSTALLED_GUI_ATLAS_WORK_ASSIGNMENT_LINK_PASS assignment=$($task.id) project=$projectId work=$workId revision=$($saved.revision)"
  Write-Host "CENTER_INSTALLED_GUI_PROJECT_WORK_AND_DRAFT_SAVED_PASS revision=$($saved.revision)"
  Close-Center
  Start-Center
  Click-ButtonContaining 'Поручения'
  $assignmentButton=Find-ProjectButton $expectedAssignment
  if(!$assignmentButton){throw 'Persisted Atlas assignment not shown after installed GUI restart'}
  Click-Control 'Планы Atlas'
  Click-Control 'Открыть локальный Atlas'
  $projectButton=Find-ProjectButton $expectedProject
  if(!$projectButton){throw 'Installed GUI did not reopen previous Atlas project'}
  $reopened=Wait-SavedProject 1
  if($reopened.generation -ne $saved.generation -or $reopened.organizationId -ne $saved.organizationId -or
     $reopened.revision -ne $saved.revision){
    throw 'Native project generation, revision or organization changed during installed app restart'
  }
  if([string]$reopened.project.id -ne $projectId -or
     [string]$reopened.project.items[0].id -ne $workId -or
     [string]$reopened.project.items[0].title -ne $expectedWork){
    throw 'Native Atlas project/work identity or content changed during installed app restart'
  }
  Write-Host "CENTER_INSTALLED_GUI_ATLAS_RESTART_PASS organization=$($saved.organizationId) project=$projectId work=$workId generation=$($saved.generation) revision=$($saved.revision)"
  Close-Center
  [pscustomobject]@{status='INSTALLED_GUI_ATLAS_PROJECT_AND_WORK_RESTART_PASS';
    orgId=$saved.organizationId;generation=$saved.generation;revision=$saved.revision;
    reopenedGeneration=$reopened.generation;reopenedRevision=$reopened.revision;
    projectId=$projectId;workId=$workId;project=$expectedProject;work=$expectedWork;
    assignmentId=$task.id;assignment=$expectedAssignment;assignmentAtlasRevision=$task.atlasRef.revision;
    installerSha256=(Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash;
    installerBytes=$installer.Length}|ConvertTo-Json|Set-Content (Join-Path $artifactDir 'installed-gui-result.json')
} catch {
  Write-Host "CENTER_INSTALLED_GUI_FAIL $($_.Exception.Message)"
  Capture-CenterFailure
  throw
} finally {
  if($null -ne $proc){
    $proc.Refresh()
    if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
  }
}
