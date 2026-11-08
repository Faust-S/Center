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
$staged=Call-Setup '--stage-legacy-file' 'stage'
if($staged.status -ne 'LEGACY_MIGRATION_STAGED_NSIS_PRESERVED' -or
   $staged.version -ne '0.3.0-dev.1' -or
   $staged.installRoot -ne $newRoot -or
   !(Test-Path -LiteralPath (Join-Path $newRoot 'iwxa-admin-center.exe'))){
  throw ('LEGACY_STAGE_NOT_CONFIRMED_{0}' -f $staged.status)
}
Assert-Original
$plan=Call-Setup '--upgrade-plan-file' 'pending'
if($plan.status -ne 'LEGACY_MIGRATION_PENDING_GUI_READBACK'){
  throw ('LEGACY_PREVIEW_PLAN_INVALID_{0}' -f $plan.status)
}
Check-Window (Join-Path $newRoot 'iwxa-admin-center.exe') 'NEW_03'
Assert-Original
$cancel=Call-Setup '--uninstall-file' 'cancel'
if($cancel.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
   (Test-Path -LiteralPath $newRoot)){
  throw ('LEGACY_PREVIEW_CANCEL_FAILED_{0}' -f $cancel.status)
}
Assert-Original
$after=Call-Setup '--legacy-inspect-file' 'after'
if($after.status -ne 'LEGACY_CONFIRMED_READ_ONLY' -or
   $after.registryName -ne $before.registryName -or
   $after.installedVersion -ne $before.installedVersion){
  throw 'LEGACY_02_NSIS_REGISTRY_CHANGED_AFTER_PREVIEW'
}
Check-Window $oldExe 'RESTORED_02'
Write-Host 'LEGACY_REAL_NSIS_PREVIEW_AND_CANCEL_PASS'
Write-Host 'LEGACY_FULL_ORGANIZATIONAL_DATA_MIGRATION_ACCEPTED=NO'
