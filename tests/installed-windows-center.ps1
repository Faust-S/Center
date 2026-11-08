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
  [DllImport("user32.dll", SetLastError=true)]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
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
$expectedSecondOrganization='CenterGUISecondOrganization'
$expectedSecondProject='CenterGUISecondProject'
$expectedSecondWork='CenterGUISecondWork'
$expectedRevisedAssignment='CenterGUIAssignmentRevised'
$staffNames=@('CenterGUIStaffA','CenterGUIStaffB')

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
  } elseif($kind -eq 'ComboBox'){
    [System.Windows.Automation.ControlType]::ComboBox
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
  # On a real installed WebView, a missing control can mean app rendering,
  # navigation or UIA provider failure. Capture bounded evidence before failing,
  # rather than silently extending all waits or treating it as a Store defect.
  $diagnostic=@()
  try {
    $root=Root-Element
    $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($node in $all){
      if($diagnostic.Count -ge 24){break}
      try {
        $label=[string]$node.Current.Name
        if($label.Length -gt 0){
          $diagnostic+=([string]$node.Current.ControlType.ProgrammaticName+':' +
            $label.Substring(0,[Math]::Min(90,$label.Length)))
        }
      } catch {}
    }
    Write-Host "CENTER_INSTALLED_UIA_CONTROL_DIAGNOSTIC count=$($all.Count) sample=$($diagnostic -join ' | ')"
  } catch {Write-Host "CENTER_INSTALLED_UIA_DIAGNOSTIC_UNAVAILABLE $($_.Exception.Message)"}
  throw "UI Automation control not found: $kind '$name'"
}
function Click-VisibleUiButton($control,[string]$name){
  # UIA's InvokePattern and focus can intermittently fail in installed WebView2.
  # Fall back to an actual native desktop mouse click at the visible element.
  $bounds=$control.Current.BoundingRectangle
  if($control.Current.IsOffscreen -or $bounds.IsEmpty -or
     $bounds.Width -lt 2 -or $bounds.Height -lt 2){
    throw "CENTER_UIA_BUTTON_NOT_CLICKABLE: $name"
  }
  $point=[System.Drawing.Point]::new(
    [int][Math]::Round($bounds.Left + $bounds.Width/2),
    [int][Math]::Round($bounds.Top + $bounds.Height/2)
  )
  [System.Windows.Forms.Cursor]::Position=$point
  [CenterNativeWindow]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [CenterNativeWindow]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
  Write-Host "CENTER_UIA_REAL_MOUSE_FALLBACK name=$name"
}
function Click-Control([string]$name){
  $control=Find-Control $name 'Button'
  try {
    $pattern=$control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
  } catch {
    # Try ordinary keyboard navigation; some WebView2 controls report a
    # focusable-looking node but reject SetFocus.
    try {
      $control.SetFocus()
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    } catch {
      Click-VisibleUiButton $control $name
    }
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
    # Try ordinary keyboard navigation; some WebView2 controls report a
    # focusable-looking node but reject SetFocus.
    try {
      $control.SetFocus()
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    } catch {
      Click-VisibleUiButton $control $name
    }
  }
  Start-Sleep -Milliseconds 350
}
function Type-Control([string]$name,[string]$value){
  # WinForms/WebView2 focus may be taken by an asynchronous React render.
  # Read the actual UIA ValuePattern after typing instead of assuming that
  # SendKeys succeeded. This qualifies the real installed GUI, not DOM state.
  for($attempt=1;$attempt -le 4;$attempt++){
    $control=Find-Control $name 'Edit'
    $control.SetFocus()
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    # Fixture values intentionally avoid SendKeys metacharacters.
    [System.Windows.Forms.SendKeys]::SendWait($value)
    Start-Sleep -Milliseconds 250
    try {
      $current=Find-Control $name 'Edit' 8
      $valuePattern=$current.GetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern)
      $readback=[string]$valuePattern.Current.Value
      if($readback -eq $value){
        Write-Host "CENTER_UIA_EDIT_READBACK_PASS name=$name attempt=$attempt"
        return
      }
      Write-Host "CENTER_UIA_EDIT_NOT_APPLIED name=$name attempt=$attempt"
    } catch [System.InvalidOperationException] {
      # Some hosted WebView providers omit ValuePattern; still use the
      # existing real keyboard route but do not invent readback evidence.
      Write-Host "CENTER_UIA_EDIT_PATTERN_UNAVAILABLE name=$name"
      return
    }
  }
  throw "CENTER_UIA_EDIT_READBACK_MISMATCH name=$name"
}
function Find-ProjectButton([string]$text,[int]$attempts=65){
  for($i=0;$i -lt $attempts;$i++){
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
function Read-NativeProject([string]$organizationId='') {
  if(!(Test-Path $organizationsRoot)){return $null}
  if($organizationId) {
    if($organizationId -notmatch '^[a-zA-Z0-9_-]{1,100}$'){throw 'Invalid organization ID in Windows acceptance'}
    $headPath=Join-Path (Join-Path $organizationsRoot $organizationId) 'head.json'
    if(!(Test-Path $headPath)){return $null}
    $heads=@(Get-Item -LiteralPath $headPath)
  } else {
    $heads=@(Get-ChildItem -LiteralPath $organizationsRoot -Filter 'head.json' -Recurse -File -ErrorAction SilentlyContinue)
  }
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
function Wait-SavedProject([int]$expectedWorkCount,[string]$organizationId='',
  [string]$projectName=$expectedProject,[string]$workName=$expectedWork){
  for($i=0;$i -lt 90;$i++){
    $snapshot=Read-NativeProject $organizationId
    if($null -ne $snapshot -and $snapshot.project.name -eq $projectName -and
      @($snapshot.project.items).Count -eq $expectedWorkCount){
      if($expectedWorkCount -eq 0 -or (@($snapshot.project.items|ForEach-Object{$_.title}) -contains $workName)){
        return $snapshot
      }
    }
    Start-Sleep -Milliseconds 350
  }
  throw "Native Atlas did not persist $projectName / work count $expectedWorkCount in organization $organizationId"
}
function Wait-SavedDraftOrganizationCount([int]$count){
  for($i=0;$i -lt 90;$i++){
    if(Test-Path $localDraft){
      try {
        $current=Get-Content -LiteralPath $localDraft -Raw | ConvertFrom-Json -Depth 100
        if(@($current.organizations).Count -eq $count -and
           $current.activeOrganizationId){return $current}
      } catch { }
    }
    Start-Sleep -Milliseconds 300
  }
  throw "Manager draft did not persist $count organizations"
}
function Wait-FirstOrganizationQualification([string]$orgId){
  for($i=0;$i -lt 90;$i++){
    try{
      if(Test-Path $localDraft){
        $draft=Get-Content -LiteralPath $localDraft -Raw | ConvertFrom-Json -Depth 100
        $org=@($draft.organizations|Where-Object{$_.id -eq $orgId})|Select-Object -First 1
        if($org -and @($org.participants).Count -eq 2 -and
           @($org.participants|Where-Object{$_.personalAgentPlan -eq 'PLANNED'}).Count -eq 1 -and
           @($org.assignments).Count -eq 1 -and
           $org.assignments[0].title -eq $expectedRevisedAssignment -and
           $org.assignments[0].editNumber -eq 2){
          return $org
        }
      }
    }catch{}
    Start-Sleep -Milliseconds 300
  }
  throw 'Installed GUI did not persist participant/seat plan and edited assignment'
}
function Select-OrganizationByKeyboard([string]$movement){
  # React's native organization select is the only selected corporate context.
  # WebView2 exposes the labeled <select> as a ComboBox to Windows UIA.
  $picker=Find-Control 'Организация' 'ComboBox'
  $picker.SetFocus()
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait($movement)
  [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  Start-Sleep -Milliseconds 450
}
function Find-TextContaining([string]$value){
  # Reads WebView2's real UIA text nodes; not a DOM/browser mock.
  for($i=0;$i -lt 65;$i++){
    $root=Root-Element
    $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($node in $nodes){
      try{
        if($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
           $node.Current.Name.Contains($value)){return $node}
      }catch{}
    }
    Start-Sleep -Milliseconds 350
  }
  throw "Installed Corporate Panel text not found: $value"
}
function Assert-ButtonDisabled([string]$label){
  $button=Find-ProjectButton $label
  if($button.Current.IsEnabled){
    throw "Unauthorized corporate action is enabled: $label"
  }
}
function Visible-ButtonContaining([string]$name){
  $root=Root-Element
  $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  foreach($node in $nodes){
    try{
      if($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
         $node.Current.Name.Contains($name)){return $true}
    } catch {}
  }
  return $false
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
  $installer=Get-Item -LiteralPath 'artifacts/iwxa-setup-core-center-0.3-preview.exe' -ErrorAction Stop
  $installReport=Join-Path $artifactDir 'center-setup-core-installed.json'
  $installProcess=Start-Process -FilePath $installer.FullName -ArgumentList ('--install-file "{0}"' -f $installReport) -PassThru
  if(!$installProcess.WaitForExit(120000)){Stop-Process -Id $installProcess.Id -Force;throw 'IWXA Setup Core install timed out'}
  if($installProcess.ExitCode -ne 0){throw "IWXA Setup Core install failed: $($installProcess.ExitCode)"}
  if(!(Test-Path -LiteralPath $installReport -PathType Leaf)){throw 'IWXA Setup Core install report missing'}
  $setupResult=Get-Content -LiteralPath $installReport -Raw|ConvertFrom-Json
  $expectedRoot=Join-Path $env:LOCALAPPDATA 'Programs\IWXA Admin Center'
  if($setupResult.status -ne 'INSTALLED_NOT_LAUNCHED' -or
      $setupResult.product -ne 'iwxa.admin-center' -or
      $setupResult.version -ne '0.3.0-dev.1' -or
      [IO.Path]::GetFullPath([string]$setupResult.installRoot) -ne [IO.Path]::GetFullPath($expectedRoot)){
    throw 'IWXA Setup Core installed receipt mismatch'
  }
  $exe=Join-Path $expectedRoot 'iwxa-admin-center.exe'
  if(!(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'IWXA Setup Core installed executable not found'}
  Write-Host "CENTER_SETUP_CORE_INSTALL_PASS exe=$exe"
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
  # UIA Invoke success does not always mean the native WebView actually
  # submitted the React form. Confirm the assignment-row appeared.
  $row=$null
  try {$row=Find-ProjectButton $expectedAssignment 8}
  catch {
    Write-Host 'CENTER_UIA_ASSIGNMENT_SUBMIT_RETRY_REAL_MOUSE'
    $save=Find-Control 'Сохранить черновик' 'Button' 8
    Click-VisibleUiButton $save 'Сохранить черновик'
    $row=Find-ProjectButton $expectedAssignment 25
  }
  if(!$row){throw 'CENTER_ASSIGNMENT_GUI_SUBMISSION_NOT_CONFIRMED'}
  Write-Host 'CENTER_INSTALLED_ASSIGNMENT_EDITOR_CLOSED_PASS'
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
  # Qualify the ordinary manager journey in the installed GUI, not just
  # creating one assignment. Planning a seat must NOT issue any license.
  Click-Control 'Сотрудники и роли'
  foreach($staffName in $staffNames){
    Type-Control 'Имя' $staffName
    Click-Control 'Добавить участника'
  }
  Click-Control 'Personal Agent и лицензии'
  Click-ButtonContaining 'Запланировать место'
  Click-ButtonContaining 'Поручения'
  Click-ButtonContaining $expectedAssignment
  Type-Control 'Что нужно сделать' $expectedRevisedAssignment
  Type-Control 'Критерии приёмки' 'Revised verified acceptance report'
  Click-Control 'Сохранить черновик'
  Click-Control 'Сохранить на компьютере'
  $qualified=Wait-FirstOrganizationQualification $saved.organizationId
  $staffIds=@($qualified.participants|ForEach-Object{$_.id})
  $savedNames=@($qualified.participants|ForEach-Object{$_.name})
  if(@($staffIds|Select-Object -Unique).Count -ne 2 -or
     @($savedNames|Where-Object{$_ -in $staffNames}).Count -ne 2 -or
     $qualified.assignments[0].atlasRef.projectId -ne $projectId){
    throw 'Installed manager participant IDs or Atlas source binding changed after editing'
  }
  if($qualified.assignments[0].atlasRef.workId -ne $workId -or
     [string]$qualified.assignments[0].atlasRef.revision -ne [string]$saved.revision -or
     $qualified.assignments[0].status -ne 'DRAFT'){
    throw 'Edited assignment changed its original Atlas work or revision'
  }
  # Reading draft.json proves the disk write, not that the asynchronous
  # WebView invoke acknowledgement reached React. Closing during an in-flight
  # save must show the unsaved-work guard; this ordinary close is AFTER the
  # UI confirms the exact saved revision.
  [void](Find-TextContaining 'Черновики сохранены на этом компьютере')
  Write-Host "CENTER_INSTALLED_GUI_STAFF_SEAT_EDIT_SAVE_PASS employees=2 plannedSeats=1 edit=2"
  Close-Center
  Start-Center
  Click-ButtonContaining 'Поручения'
  $assignmentButton=Find-ProjectButton $expectedRevisedAssignment
  if(!$assignmentButton){throw 'Edited Atlas assignment not shown after installed GUI restart'}
  Click-Control 'Сотрудники и роли'
  [void](Find-TextContaining $staffNames[0])
  [void](Find-TextContaining $staffNames[1])
  Click-Control 'Personal Agent и лицензии'
  [void](Find-TextContaining 'Места запланированы')
  $reopenedDraft=Get-Content -LiteralPath $localDraft -Raw | ConvertFrom-Json -Depth 100
  $reopenedOrg=@($reopenedDraft.organizations|Where-Object{$_.id -eq $saved.organizationId})[0]
  if(@($reopenedOrg.participants).Count -ne 2 -or
     @($reopenedOrg.participants|Where-Object{$_.personalAgentPlan -eq 'PLANNED'}).Count -ne 1 -or
     $reopenedOrg.assignments[0].title -ne $expectedRevisedAssignment){
    throw 'Edited assignment or planned Personal Agent seat did not survive installed restart'
  }
  Write-Host "CENTER_INSTALLED_GUI_STAFF_SEAT_EDIT_RESTART_PASS employees=2 plannedSeats=1"
  # The actual installed WebView must fail closed: no approved T3 owner is
  # packaged. Contract-double results cannot enable real corporate actions.
  Click-Control 'Результаты'
  [void](Find-TextContaining 'NOT_CONNECTED')
  Assert-ButtonDisabled 'Выдать через CEN02'
  Assert-ButtonDisabled 'Сохранить .iwxa'
  Assert-ButtonDisabled 'Получить Result'
  if(Visible-ButtonContaining 'ACCEPT' -or Visible-ButtonContaining 'Apply'){
    throw 'Corporate decision or application appeared without an owner Review'
  }
  Write-Host "CENTER_INSTALLED_GUI_CORPORATE_OWNER_NOT_CONNECTED_PASS"
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
  # Qualify two independent organization roots using the REAL installed UI,
  # not direct calls to the storage layer or a fabricated imported draft.
  Click-ButtonContaining 'Добавить организацию'
  Type-Control 'Название' $expectedSecondOrganization
  Click-Control 'Создать черновик организации'
  Click-Control 'Сохранить на компьютере'
  $twoOrgDraft=Wait-SavedDraftOrganizationCount 2
  $secondOrgId=[string]$twoOrgDraft.activeOrganizationId
  if(!$secondOrgId -or $secondOrgId -eq $saved.organizationId -or
     [string]$twoOrgDraft.organizations[0].id -ne $saved.organizationId -or
     [string]$twoOrgDraft.organizations[0].assignments[0].id -ne [string]$task.id){
    throw 'Creating second organization overwrote the first organizational draft'
  }
  if($null -ne (Read-NativeProject $secondOrgId)){
    throw 'New organization sees first organization native Atlas project'
  }
  Click-Control 'Планы Atlas'
  Type-Control 'Название рабочей области' 'CenterGUISecondWorkspace'
  Click-Control 'Добавить'
  Click-Control 'Открыть локальный Atlas'
  if(Visible-ButtonContaining $expectedProject){
    throw 'First Atlas project leaked into second organization GUI'
  }
  Type-Control 'Новый проект Atlas' $expectedSecondProject
  Click-Control 'Создать проект'
  $secondProjectOnly=Wait-SavedProject 0 $secondOrgId $expectedSecondProject $expectedSecondWork
  Type-Control 'Работа Atlas' $expectedSecondWork
  Click-Control 'Добавить работу'
  $secondSaved=Wait-SavedProject 1 $secondOrgId $expectedSecondProject $expectedSecondWork
  $secondProjectId=[string]$secondSaved.project.id
  $secondWorkId=[string]$secondSaved.project.items[0].id
  if(!$secondProjectId -or !$secondWorkId -or $secondProjectId -eq $projectId -or
     $secondSaved.organizationId -ne $secondOrgId){
    throw 'Second Atlas organization reused first project/work identity'
  }
  $firstAfterSecond=Read-NativeProject $saved.organizationId
  if($firstAfterSecond.generation -ne $saved.generation -or
     $firstAfterSecond.project.id -ne $projectId -or
     [string]$firstAfterSecond.project.items[0].id -ne $workId){
    throw 'Second organization mutated first Atlas storage'
  }
  Click-Control 'Сохранить на компьютере'
  Write-Host "CENTER_INSTALLED_GUI_TWO_ORG_STORAGE_ISOLATION_PASS first=$($saved.organizationId) second=$secondOrgId"
  Close-Center
  Start-Center
  Click-Control 'Планы Atlas'
  Click-Control 'Открыть локальный Atlas'
  if(!(Find-ProjectButton $expectedSecondProject)){throw 'Second Atlas organization did not reopen after restart'}
  if(Visible-ButtonContaining $expectedProject){throw 'First organization project visible in second after restart'}
  $secondReopened=Wait-SavedProject 1 $secondOrgId $expectedSecondProject $expectedSecondWork
  if($secondReopened.project.id -ne $secondProjectId -or
     [string]$secondReopened.project.items[0].id -ne $secondWorkId -or
     $secondReopened.generation -ne $secondSaved.generation){
    throw 'Second Atlas organization lost identity or revision after restart'
  }
  Select-OrganizationByKeyboard '{HOME}'
  Click-Control 'Планы Atlas'
  Click-Control 'Открыть локальный Atlas'
  if(!(Find-ProjectButton $expectedProject)){throw 'First organization was not restored after context switch'}
  if(Visible-ButtonContaining $expectedSecondProject){throw 'Second project leaked into first organization GUI'}
  $firstFinal=Wait-SavedProject 1 $saved.organizationId
  if($firstFinal.generation -ne $saved.generation -or $firstFinal.project.id -ne $projectId){
    throw 'First organizational Atlas identity changed after context switch and restart'
  }
  Write-Host "CENTER_INSTALLED_GUI_TWO_ORG_SWITCH_RESTART_PASS first=$($saved.organizationId) second=$secondOrgId"
  # Selecting another organization persists a different active context and
  # intentionally dirties the manager draft. Prove the native unsaved-close
  # guard first, then save the selected context before ordinary WM_CLOSE.
  $proc.Refresh()
  if(-not [CenterNativeWindow]::PostMessage($proc.MainWindowHandle,0x0010,
      [IntPtr]::Zero,[IntPtr]::Zero)){throw 'Unsaved native WM_CLOSE could not be posted'}
  Start-Sleep -Milliseconds 900
  $proc.Refresh()
  if($proc.HasExited){throw 'Unsaved manager context closed without confirmation'}
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  Start-Sleep -Milliseconds 300
  $proc.Refresh()
  if($proc.HasExited){throw 'Cancelling unsaved close still terminated the GUI'}
  Write-Host "CENTER_INSTALLED_GUI_UNSAVED_CONTEXT_CLOSE_CANCEL_PASS"
  Click-Control 'Сохранить на компьютере'
  [void](Find-TextContaining 'Черновики сохранены на этом компьютере')
  Close-Center
  [pscustomobject]@{status='INSTALLED_GUI_TWO_ORG_ATLAS_RESTART_PASS';
    orgId=$saved.organizationId;generation=$saved.generation;revision=$saved.revision;
    reopenedGeneration=$reopened.generation;reopenedRevision=$reopened.revision;
    projectId=$projectId;workId=$workId;project=$expectedProject;work=$expectedWork;
    assignmentId=$task.id;assignment=$expectedAssignment;assignmentAtlasRevision=$task.atlasRef.revision;
    secondOrgId=$secondOrgId;secondProjectId=$secondProjectId;secondWorkId=$secondWorkId;
    secondGeneration=$secondSaved.generation;secondRevision=$secondSaved.revision;
    secondReopenedGeneration=$secondReopened.generation;
    managerStaffCount=2;managerPlannedAgentSeats=1;
    managerAssignmentEditNumber=2;managerEditedAssignment=$expectedRevisedAssignment;
    managerStaffSeatEditRestart='PASS_INSTALLED_GUI';
    organizationIsolation='TWO_NATIVE_ATLAS_ROOTS_AND_GUI_SWITCH_RESTART_PASS';
    corporateOwner='NOT_CONNECTED';
    corporateActions='ISSUE_EXPORT_RECEIVE_DISABLED_NO_REVIEW_OR_APPLY';
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
