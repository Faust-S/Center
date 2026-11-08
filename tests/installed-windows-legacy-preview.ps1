# Exact NSIS 0.2 -> Setup Core 0.3 preview only.
# No attempt to qualify old two-organization GUI. Verify ownership,
# original binary/registration, test-created files, both GUI startups,
# and cancellation without executing the legacy NSIS uninstaller.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LegacySetupMouse {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@

$artifact=Join-Path $env:GITHUB_WORKSPACE 'artifacts'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
function Capture-SetupPreview([System.Diagnostics.Process]$process,[string]$filename){
  $process.Refresh()
  if($process.MainWindowHandle -eq [IntPtr]::Zero){
    throw 'LEGACY_SETUP_VISUAL_WINDOW_MISSING'
  }
  $window=[System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
  $bounds=$window.Current.BoundingRectangle
  $screen=[System.Windows.Forms.Screen]::FromHandle($process.MainWindowHandle).Bounds
  $x=[int][Math]::Max($screen.Left,$bounds.Left)
  $y=[int][Math]::Max($screen.Top,$bounds.Top)
  $width=[int][Math]::Min($screen.Right,$bounds.Right)-$x
  $height=[int][Math]::Min($screen.Bottom,$bounds.Bottom)-$y
  if($width -lt 400 -or $height -lt 300){
    throw 'LEGACY_SETUP_VISUAL_BOUNDS_INVALID'
  }
  $image=[System.Drawing.Bitmap]::new($width,$height)
  $graphics=[System.Drawing.Graphics]::FromImage($image)
  try{
    $graphics.CopyFromScreen([System.Drawing.Point]::new($x,$y),
      [System.Drawing.Point]::Empty,$image.Size)
    $image.Save((Join-Path $artifact $filename),
      [System.Drawing.Imaging.ImageFormat]::Png)
  }finally{$graphics.Dispose();$image.Dispose()}
  Write-Host "LEGACY_SETUP_REAL_VISUAL_CAPTURE_PASS $filename"
}

$bundle=Join-Path $artifact 'iwxa-setup-core-center-0.3-preview.exe'
$oldRoot=Join-Path $env:LOCALAPPDATA 'IWXA Admin Center'
$newRoot=Join-Path $env:LOCALAPPDATA 'Programs/IWXA Admin Center'
$oldExe=Join-Path $oldRoot 'iwxa-admin-center.exe'
$oldUninstall=Join-Path $oldRoot 'uninstall.exe'
foreach($p in @($bundle,$oldExe,$oldUninstall)){
  if(!(Test-Path -LiteralPath $p)){throw "LEGACY_INPUT_MISSING_$p"}
}
if(Test-Path -LiteralPath $newRoot){throw 'LEGACY_PREVIEW_ROOT_ALREADY_EXISTS'}

function Call-Setup([string]$command,[string]$tag){
  $report=Join-Path $artifact "legacy-nsis-preview-$tag.json"
  if(Test-Path -LiteralPath $report){Remove-Item -LiteralPath $report -Force}
  $p=Start-Process -FilePath $bundle -ArgumentList ('{0} "{1}"' -f $command,$report) -PassThru
  try{
    if(!$p.WaitForExit(90000)){
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      throw ('LEGACY_SETUP_TIMEOUT_{0}' -f $command)
    }
    if($p.ExitCode -ne 0){throw ('LEGACY_SETUP_EXIT_{0}_{1}' -f $command,$p.ExitCode)}
  } finally {$p.Dispose()}
  if(!(Test-Path -LiteralPath $report)){throw ('LEGACY_REPORT_MISSING_{0}' -f $command)}
  return Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
}
function Check-Window([string]$exe,[string]$label){
  $proc=Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
  try{
    $visible=$false
    for($i=0;$i -lt 80;$i++){
      Start-Sleep -Milliseconds 350
      $proc.Refresh()
      if($proc.HasExited){throw ('LEGACY_GUI_{0}_EXITED_{1}' -f $label,$proc.ExitCode)}
      if($proc.MainWindowHandle -ne [IntPtr]::Zero){
        $element=[System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
        if($null -ne $element){$visible=$true;break}
      }
    }
    if(!$visible){throw ('LEGACY_GUI_{0}_WINDOW_MISSING' -f $label)}
    Write-Host ('LEGACY_GUI_{0}_WINDOW_PASS' -f $label)
  } finally {
    $proc.Refresh()
    if(!$proc.HasExited){
      $null=$proc.CloseMainWindow()
      if(!$proc.WaitForExit(10000)){
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        throw ('LEGACY_GUI_{0}_CLOSE_TIMEOUT' -f $label)
      }
    }
    $proc.Dispose()
  }
}
function Click-SetupGuiAction([string[]]$labels,[bool]$expectNative) {
  $setup=Start-Process -FilePath $bundle -PassThru
  try {
    $clicked=$false
    for($i=0;$i -lt 90;$i++){
      Start-Sleep -Milliseconds 350
      $setup.Refresh()
      if($setup.HasExited){throw 'LEGACY_GUI_SETUP_EXITED_EARLY'}
      if($setup.MainWindowHandle -eq [IntPtr]::Zero){continue}
      $window=[System.Windows.Automation.AutomationElement]::FromHandle($setup.MainWindowHandle)
      $nodes=$window.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      foreach($node in $nodes){
        try {
          if($node.Current.Name -notin $labels -or
             !$node.Current.IsEnabled -or $node.Current.IsOffscreen){continue}
          $rect=$node.Current.BoundingRectangle
          if($rect.Width -lt 24 -or $rect.Height -lt 18){continue}
          $imageFile = if ($expectNative) {
            'setup-core-visual-legacy-before-preview.png'
          } else {
            'setup-core-visual-legacy-before-cancel.png'
          }
          Capture-SetupPreview $setup $imageFile
          try {
            $invoke=$node.GetCurrentPattern(
              [System.Windows.Automation.InvokePattern]::Pattern)
            $invoke.Invoke()
          } catch {
            $x=[int]($rect.Left+$rect.Width/2)
            $y=[int]($rect.Top+$rect.Height/2)
            if(![LegacySetupMouse]::SetCursorPos($x,$y)){
              throw 'LEGACY_GUI_SET_MOUSE_POSITION_FAILED'
            }
            Start-Sleep -Milliseconds 80
            [LegacySetupMouse]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
            Start-Sleep -Milliseconds 80
            [LegacySetupMouse]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
          }
          $clicked=$true
          Write-Host ('LEGACY_GUI_SETUP_BUTTON_CLICKED={0}' -f $node.Current.Name)
          break
        } catch {}
      }
      if($clicked){break}
    }
    if(!$clicked){throw ('LEGACY_GUI_ACTION_NOT_FOUND_{0}' -f ($labels -join '|'))}
    $settled=$false
    for($wait=0;$wait -lt 120;$wait++){
      Start-Sleep -Milliseconds 250
      $registered=Test-Path -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center'
      $active=Test-Path -LiteralPath (Join-Path $newRoot 'iwxa-admin-center.exe')
      $receipt=Test-Path -LiteralPath (Join-Path $newRoot '.iwxa-setup-ownership.json')
      if($expectNative){
        if($registered -and $active -and $receipt){$settled=$true;break}
      } else {
        if(!$registered -and !(Test-Path -LiteralPath $newRoot)){$settled=$true;break}
      }
    }
    if(!$settled){throw ('LEGACY_GUI_ACTION_DID_NOT_FINISH_{0}' -f ($labels -join '|'))}
    return $true
  } finally {
    $setup.Refresh()
    if(!$setup.HasExited){
      $null=$setup.CloseMainWindow()
      if(!$setup.WaitForExit(25000)){
        Stop-Process -Id $setup.Id -Force -ErrorAction SilentlyContinue
        throw 'LEGACY_GUI_SETUP_WINDOW_CLOSE_TIMEOUT'
      }
    }
    $setup.Dispose()
  }
}
$savedDraft=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/atlas-store-v1/preparation/draft.json'
$guiProof=Join-Path $artifact 'legacy-real-organizations-result.json'
if(!(Test-Path -LiteralPath $guiProof)){throw 'LEGACY_REAL_ORG_GUI_PROOF_MISSING'}
$beforeData=Get-Content -LiteralPath $savedDraft -Raw|ConvertFrom-Json -Depth 100
if(@($beforeData.organizations).Count -ne 2){throw 'LEGACY_REAL_ORG_EXPECTED_TWO'}
$namesBefore=@($beforeData.organizations|ForEach-Object{$_.name}|Sort-Object)
$idsBefore=@($beforeData.organizations|ForEach-Object{$_.id}|Sort-Object)
$hashBefore=(Get-FileHash -LiteralPath $savedDraft -Algorithm SHA256).Hash
function Assert-RealOrganizations([string]$phase){
  $afterData=Get-Content -LiteralPath $savedDraft -Raw|ConvertFrom-Json -Depth 100
  $names=@($afterData.organizations|ForEach-Object{$_.name}|Sort-Object)
  $ids=@($afterData.organizations|ForEach-Object{$_.id}|Sort-Object)
  if(@($afterData.organizations).Count -ne 2 -or
    ($names -join '|') -ne ($namesBefore -join '|') -or
    ($ids -join '|') -ne ($idsBefore -join '|') -or
    (Get-FileHash -LiteralPath $savedDraft -Algorithm SHA256).Hash -ne $hashBefore){
    throw ('LEGACY_REAL_ORG_READBACK_CHANGED_{0}' -f $phase)
  }
  Write-Host ('LEGACY_REAL_ORG_READBACK_{0}_PASS' -f $phase)
}
$hashOld=(Get-FileHash -LiteralPath $oldExe -Algorithm SHA256).Hash
$hashUninstaller=(Get-FileHash -LiteralPath $oldUninstall -Algorithm SHA256).Hash
$before=Call-Setup '--legacy-inspect-file' 'before'
Write-Host ('LEGACY_DISCOVERY_STATUS={0} VERSION={1} REGISTRY={2}' -f
  $before.status,$before.installedVersion,$before.registryName)
if($before.status -ne 'LEGACY_CONFIRMED_READ_ONLY' -or
   $before.installedVersion -ne '0.2.0' -or
   $before.installRoot -ne $oldRoot){
  throw ('LEGACY_EXACT_NSIS_IDENTITY_NOT_CONFIRMED_{0}' -f $before.status)
}
Check-Window $oldExe 'OLD_02'
$fixture=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/setup-core-qualification'
New-Item -ItemType Directory -Force -Path $fixture|Out-Null
$files=@(
 (Join-Path $fixture 'preserve-organization-A.txt'),
 (Join-Path $fixture 'preserve-organization-B.txt')
)
[IO.File]::WriteAllText($files[0],'preserve-existing-A')
[IO.File]::WriteAllText($files[1],'preserve-existing-B')
$hashes=@($files|ForEach-Object{(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash})
function Assert-Original {
  for($i=0;$i -lt $files.Count;$i++){
    if(!(Test-Path -LiteralPath $files[$i]) -or
       (Get-FileHash -LiteralPath $files[$i] -Algorithm SHA256).Hash -ne $hashes[$i]){
      throw ('LEGACY_PRESERVED_FIXTURE_CHANGED_{0}' -f $i)
    }
  }
  if((Get-FileHash -LiteralPath $oldExe -Algorithm SHA256).Hash -ne $hashOld -or
     (Get-FileHash -LiteralPath $oldUninstall -Algorithm SHA256).Hash -ne $hashUninstaller){
    throw 'LEGACY_ORIGINAL_NSIS_BINARIES_CHANGED'
  }
}
$preflight=Call-Setup '--preflight-file' 'preflight'
if($preflight.status -ne 'LEGACY_INSTALLATION'){
  throw ('LEGACY_PREFLIGHT_STATUS_{0}' -f $preflight.status)
}
$null=Click-SetupGuiAction @('Install to preview','Установить для проверки') $true
$ready=$false
for($i=0;$i -lt 60;$i++){
  Start-Sleep -Milliseconds 250
  if((Test-Path -LiteralPath (Join-Path $newRoot 'iwxa-admin-center.exe')) -and
     (Test-Path -LiteralPath (Join-Path $newRoot '.iwxa-setup-ownership.json'))){
    $ready=$true;break
  }
}
if(!$ready){throw 'LEGACY_GUI_STAGE_NOT_ACTIVATED'}
Write-Host 'LEGACY_REAL_GUI_STAGE_ACCEPTED_03_PASS'
Assert-Original
$plan=Call-Setup '--upgrade-plan-file' 'pending'
if($plan.status -ne 'LEGACY_MIGRATION_PENDING_GUI_READBACK'){
  throw ('LEGACY_PREVIEW_PLAN_INVALID_{0}' -f $plan.status)
}
Check-Window (Join-Path $newRoot 'iwxa-admin-center.exe') 'NEW_03'
Assert-RealOrganizations 'AFTER_03'
Assert-Original

# Explicit reversible default-launch handoff. This is NOT NSIS uninstall.
# Keep exact bytes of the old Start Menu shortcut and its old uninstall entry.
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'IWXA Admin Center.lnk'
$shortcutBeforeExists=Test-Path -LiteralPath $shortcut -PathType Leaf
$shortcutBeforeSha=if($shortcutBeforeExists){
  (Get-FileHash -LiteralPath $shortcut -Algorithm SHA256).Hash
}else{''}
$legacyUninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$before.registryName
if(!(Test-Path -LiteralPath $legacyUninstallKey)){
  throw 'LEGACY_SWITCH_OLD_UNINSTALL_REGISTRY_MISSING'
}
$oldUninstallCommand=(Get-ItemProperty -LiteralPath $legacyUninstallKey).UninstallString
$active=Call-Setup '--activate-legacy-file' 'activate-shortcut'
if($active.status -ne 'LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED'){
  throw ('LEGACY_SWITCH_ACTIVATION_FAILED_'+$active.status)
}
$activePlan=Call-Setup '--upgrade-plan-file' 'active-shortcut-plan'
if($activePlan.status -ne 'LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED'){
  throw ('LEGACY_SWITCH_ACTIVE_PLAN_INVALID_'+$activePlan.status)
}
if(!(Test-Path -LiteralPath $shortcut -PathType Leaf)){
  throw 'LEGACY_SWITCH_ACTIVE_SHORTCUT_MISSING'
}
$shortcutShell=New-Object -ComObject WScript.Shell
$activeTarget=$shortcutShell.CreateShortcut($shortcut).TargetPath
if([IO.Path]::GetFullPath($activeTarget) -ne
   [IO.Path]::GetFullPath((Join-Path $newRoot 'iwxa-admin-center.exe'))){
  throw 'LEGACY_SWITCH_START_MENU_NOT_NEW_EXE'
}
if((Get-ItemProperty -LiteralPath $legacyUninstallKey).UninstallString -ne
   $oldUninstallCommand){
  throw 'LEGACY_SWITCH_NSIS_UNINSTALL_CHANGED'
}
Assert-Original
Assert-RealOrganizations 'AFTER_ACTIVATE'
Write-Host 'LEGACY_REAL_START_MENU_DEFAULT_SWITCH_PASS'

$restored=Call-Setup '--restore-legacy-file' 'restore-shortcut'
if($restored.status -ne 'LEGACY_DEFAULT_RESTORED_NSIS_PRESERVED'){
  throw 'LEGACY_DEFAULT_RESTORE_FAILED'
}
$restoredPlan=Call-Setup '--upgrade-plan-file' 'restored-shortcut-plan'
if($restoredPlan.status -ne 'LEGACY_MIGRATION_PENDING_GUI_READBACK'){
  throw ('LEGACY_DEFAULT_RESTORE_PLAN_INVALID_'+$restoredPlan.status)
}
if((Test-Path -LiteralPath $shortcut -PathType Leaf) -ne $shortcutBeforeExists){
  throw 'LEGACY_SWITCH_SHORTCUT_PRESENCE_CHANGED_AFTER_RESTORE'
}
if($shortcutBeforeExists -and
   (Get-FileHash -LiteralPath $shortcut -Algorithm SHA256).Hash -ne
     $shortcutBeforeSha){
  throw 'LEGACY_SWITCH_ORIGINAL_SHORTCUT_HASH_NOT_RESTORED'
}
if((Get-ItemProperty -LiteralPath $legacyUninstallKey).UninstallString -ne
   $oldUninstallCommand){
  throw 'LEGACY_SWITCH_NSIS_REGISTRY_CHANGED_AFTER_RESTORE'
}
Assert-Original
Assert-RealOrganizations 'AFTER_RESTORE'
Write-Host 'LEGACY_REAL_DEFAULT_SWITCH_REVERTED_PASS'

$null=Click-SetupGuiAction @('Cancel preview','Отменить переход') $false
$gone=$false
for($i=0;$i -lt 60;$i++){
  Start-Sleep -Milliseconds 250
  if(!(Test-Path -LiteralPath $newRoot)){
    $gone=$true;break
  }
}
if(!$gone){throw 'LEGACY_GUI_CANCEL_NOT_ACTIVATED'}
Write-Host 'LEGACY_REAL_GUI_CANCEL_PREVIEW_PASS'
Assert-Original
$after=Call-Setup '--legacy-inspect-file' 'after'
if($after.status -ne 'LEGACY_CONFIRMED_READ_ONLY' -or
   $after.registryName -ne $before.registryName -or
   $after.installedVersion -ne $before.installedVersion){
  throw 'LEGACY_02_NSIS_REGISTRY_CHANGED_AFTER_PREVIEW'
}
Check-Window $oldExe 'RESTORED_02'
Assert-RealOrganizations 'AFTER_CANCEL'
Write-Host 'LEGACY_REAL_NSIS_GUI_PREVIEW_AND_CANCEL_PASS'
Write-Host 'LEGACY_FULL_ORGANIZATIONAL_DATA_MIGRATION_ACCEPTED=NO'
