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
