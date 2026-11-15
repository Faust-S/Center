# Public disposable Windows acceptance of the REAL installed Publisher
# 0.4.0-dev.2 -> 0.5.0-dev.1 lifecycle using original IWXA Setup Core.
# Exercises the actual two EXEs and the same retained draft/data directory.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or
   $env:GITHUB_REPOSITORY -ne 'Faust-S/Center'){
  throw 'PUBLISHER_UPGRADE_PUBLIC_DISPOSABLE_WINDOWS_REQUIRED'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$baselineSha='8a1c390f7263b5a6fac60b5fd8bae2db3fe58679'
$baseline=(Resolve-Path -LiteralPath 'vendor/publisher04').Path
$actual=(& git -C $baseline rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $actual -ne $baselineSha){
  throw 'PUBLISHER_UPGRADE_04_SOURCE_PIN_MISMATCH'
}
$art=(Resolve-Path -LiteralPath 'artifacts/publisher-setupcore').Path
$older=(Resolve-Path -LiteralPath 'artifacts/publisher-0.4-baseline').Path
$oldItems=@(Get-ChildItem -LiteralPath $older -Recurse -File -Filter 'IWXA-Publisher-SetupCore-0.4.0-dev.2.exe')
if($oldItems.Count -ne 1){throw 'PUBLISHER_UPGRADE_04_RELEASE_INSTALLER_MISSING'}
$oldSetup=$oldItems[0].FullName
$newSetup=Join-Path $art 'IWXA-Publisher-SetupCore-0.5.0-dev.1.exe'
if(-not (Test-Path -LiteralPath $newSetup -PathType Leaf)){
  throw 'PUBLISHER_UPGRADE_05_CANDIDATE_INSTALLER_MISSING'
}
$reports=Join-Path $art 'upgrade-04-05'
[IO.Directory]::CreateDirectory($reports)|Out-Null
$installedRoot=Join-Path $env:LOCALAPPDATA 'Programs/IWXA Publisher'
$dataRoot=Join-Path $env:LOCALAPPDATA 'ru.iwxa.publisher'
$dataFile=Join-Path $dataRoot 'publisher-preparation-v1.json'
$draftReceipt=Join-Path $reports 'original-04-draft.json'
$script:appProcess=$null
$installed=$false
$upgraded=$false
$manifest=$null
function Call-Setup([string]$exe,[string]$verb,[string]$name){
  $output=Join-Path $reports "$name.json"
  if(Test-Path -LiteralPath $output){throw "PUBLISHER_UPGRADE_REPORT_EXISTS $name"}
  $process=Start-Process -FilePath $exe -ArgumentList ('{0} "{1}"' -f $verb,$output) -PassThru
  try{
    if(-not $process.WaitForExit(120000)){
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "PUBLISHER_UPGRADE_SETUP_TIMEOUT $verb"
    }
    if($process.ExitCode -ne 0){
      throw "PUBLISHER_UPGRADE_SETUP_EXIT_$verb $($process.ExitCode)"
    }
  }finally{$process.Dispose()}
  if(-not (Test-Path -LiteralPath $output -PathType Leaf)){
    throw "PUBLISHER_UPGRADE_SETUP_RECEIPT_MISSING $verb"
  }
  return Get-Content -LiteralPath $output -Raw | ConvertFrom-Json -Depth 40
}
function Check-Draft([string]$stage){
  $observed=(Get-FileHash -LiteralPath $dataFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if($observed -ne $manifest.draftSha256){
    throw "PUBLISHER_UPGRADE_USER_DRAFT_MODIFIED $stage"
  }
}
function UIA-Root {
  if($null -eq $script:appProcess){throw 'PUBLISHER_UPGRADE_PROCESS_NOT_STARTED'}
  $script:appProcess.Refresh()
  if($script:appProcess.HasExited){throw 'PUBLISHER_UPGRADE_NATIVE_APP_EXITED'}
  if($script:appProcess.MainWindowHandle -eq [IntPtr]::Zero){return $null}
  return [System.Windows.Automation.AutomationElement]::FromHandle(
    $script:appProcess.MainWindowHandle)
}
function Click-Native([string]$label){
  $until=[DateTime]::UtcNow.AddSeconds(45)
  while([DateTime]::UtcNow -lt $until){
    $root=UIA-Root
    if($null -ne $root){
      $matches=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::NameProperty,$label))
      foreach($node in $matches){
        try{
          if($node.Current.IsEnabled -and
             $node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button){
            try{
              $node.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            }catch{
              $node.SetFocus()
              [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
            }
            Start-Sleep -Milliseconds 500
            return
          }
        }catch{}
      }
    }
    Start-Sleep -Milliseconds 300
  }
  throw "PUBLISHER_UPGRADE_NATIVE_BUTTON_MISSING $label"
}
function See-Native([string]$part){
  $until=[DateTime]::UtcNow.AddSeconds(40)
  while([DateTime]::UtcNow -lt $until){
    $root=UIA-Root
    if($null -ne $root){
      $elements=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      foreach($item in $elements){
        try{if($item.Current.Name.Contains($part)){return}}catch{}
      }
    }
    Start-Sleep -Milliseconds 300
  }
  throw "PUBLISHER_UPGRADE_USER_DRAFT_NOT_VISIBLE $part"
}
function Close-Native {
  if($null -eq $script:appProcess){return}
  $script:appProcess.Refresh()
  if(-not $script:appProcess.HasExited){
    [void]$script:appProcess.CloseMainWindow()
    if(-not $script:appProcess.WaitForExit(15000)){
      throw 'PUBLISHER_UPGRADE_NATIVE_CLOSE_FAILED'
    }
  }
  $script:appProcess.Dispose()
  $script:appProcess=$null
}
function Check-Installed-Gui([string]$version){
  $exe=Join-Path $installedRoot 'iwxa-publisher.exe'
  if(-not (Test-Path -LiteralPath $exe -PathType Leaf)){
    throw "PUBLISHER_UPGRADE_INSTALLED_EXE_MISSING $version"
  }
  $script:appProcess=Start-Process -FilePath $exe -WorkingDirectory $installedRoot -PassThru
  Click-Native 'Продукты'
  See-Native 'Atlas Upgrade Baseline'
  Click-Native 'Лицензии'
  See-Native 'Подготовленные запросы (1)'
  Check-Draft $version
  Close-Native
  Write-Host "PUBLISHER_UPGRADE_INSTALLED_GUI_USER_DRAFT_PASS $version"
}
try{
  $oldInfo=Call-Setup $oldSetup '--inspect-file' 'baseline-inspect'
  $newInfo=Call-Setup $newSetup '--inspect-file' 'candidate-inspect'
  $head=(& git rev-parse HEAD).Trim()
  if($oldInfo.status -ne 'VERIFIED' -or $oldInfo.product -ne 'iwxa.publisher' -or
     $oldInfo.version -ne '0.4.0-dev.2' -or $oldInfo.sourceCommit -ne $baselineSha -or
     $oldInfo.files -ne 1){
    throw 'PUBLISHER_UPGRADE_04_RELEASE_SOURCE_UNVERIFIED'
  }
  if($newInfo.status -ne 'VERIFIED' -or $newInfo.product -ne 'iwxa.publisher' -or
     $newInfo.version -ne '0.5.0-dev.1' -or $newInfo.sourceCommit -ne $head -or
     $newInfo.files -ne 1){
    throw 'PUBLISHER_UPGRADE_05_RELEASE_SOURCE_UNVERIFIED'
  }
  if(Test-Path -LiteralPath $installedRoot){
    throw 'PUBLISHER_UPGRADE_REQUIRES_UNINSTALLED_PRODUCT'
  }
  & node publisher/tests/installed-upgrade-04-seed.mjs $baseline $dataFile $draftReceipt
  if($LASTEXITCODE -ne 0){throw 'PUBLISHER_UPGRADE_04_MODEL_SEED_FAILED'}
  $manifest=Get-Content -LiteralPath $draftReceipt -Raw | ConvertFrom-Json -Depth 10
  if($manifest.baseline -ne '0.4.0-dev.2' -or $manifest.version -ne 2 -or
     $manifest.productId -ne 'IWXA_ATLAS'){
    throw 'PUBLISHER_UPGRADE_04_MODEL_DRAFT_INVALID'
  }
  $preflight=Call-Setup $oldSetup '--preflight-file' 'baseline-preflight'
  if($preflight.status -ne 'READY_FOR_FIRST_INSTALL'){
    throw "PUBLISHER_UPGRADE_04_FIRST_INSTALL_BLOCKED_$($preflight.status)"
  }
  $installedResult=Call-Setup $oldSetup '--install-file' 'baseline-install'
  if($installedResult.status -ne 'INSTALLED_NOT_LAUNCHED'){
    throw 'PUBLISHER_UPGRADE_04_INSTALL_NOT_CONFIRMED'
  }
  $installed=$true
  $oldRegistry=Get-ItemProperty -Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.publisher'
  if($oldRegistry.Version -ne '0.4.0-dev.2' -or
     $oldRegistry.InstallLocation -ne $installedRoot -or
     $oldRegistry.DataLocation -ne $dataRoot){
    throw 'PUBLISHER_UPGRADE_04_INSTALL_LOCATION_WRONG'
  }
  Check-Draft '04_INSTALL'
  Check-Installed-Gui '04'
  $plan=Call-Setup $newSetup '--upgrade-plan-file' 'candidate-plan'
  if($plan.status -ne 'UPGRADE_CANDIDATE_NOT_ACTIVATED' -or
     $plan.installedVersion -ne '0.4.0-dev.2' -or
     $plan.candidateVersion -ne '0.5.0-dev.1'){
    throw "PUBLISHER_UPGRADE_04_05_PLAN_INVALID_$($plan.status)"
  }
  $changed=Call-Setup $newSetup '--upgrade-file' 'candidate-upgrade'
  if($changed.status -ne 'UPGRADED_BACKUP_RETAINED' -or
     $changed.version -ne '0.5.0-dev.1' -or
     -not (Test-Path -LiteralPath ($installedRoot+'.iwxa-previous'))){
    throw 'PUBLISHER_UPGRADE_04_05_ATOMIC_SWITCH_FAILED'
  }
  $upgraded=$true
  $newRegistry=Get-ItemProperty -Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.publisher'
  if($newRegistry.Version -ne '0.5.0-dev.1' -or
     $newRegistry.InstallLocation -ne $installedRoot -or
     $newRegistry.DataLocation -ne $dataRoot){
    throw 'PUBLISHER_UPGRADE_05_CHANGED_USER_LOCATIONS'
  }
  Check-Draft '05_SWITCH'
  Check-Installed-Gui '05'
  $confirmed=Call-Setup $newSetup '--confirm-upgrade-file' 'candidate-confirm'
  if($confirmed.status -ne 'UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED' -or
     (Test-Path -LiteralPath ($installedRoot+'.iwxa-previous'))){
    throw 'PUBLISHER_UPGRADE_05_CONFIRM_FAILED'
  }
  $verified=Call-Setup $newSetup '--verify-installed-file' 'candidate-verify'
  if($verified.status -ne 'OWNED_FILES_VERIFIED'){
    throw 'PUBLISHER_UPGRADE_05_OWNED_FILES_INVALID'
  }
  Check-Draft '05_CONFIRM'
  $final=Call-Setup $newSetup '--upgrade-plan-file' 'candidate-final-plan'
  if($final.status -ne 'REPAIR_CANDIDATE_NOT_ACTIVATED'){
    throw "PUBLISHER_UPGRADE_05_FINAL_PLAN_INVALID_$($final.status)"
  }
}finally{
  if($null -ne $appProcess){
    try{Close-Native}catch{
      try{Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue}catch{}
    }
  }
  if($installed){
    $uninstaller=if($upgraded){$newSetup}else{$oldSetup}
    $removed=Call-Setup $uninstaller '--uninstall-file' 'final-uninstall'
    if($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
       (Test-Path -LiteralPath $installedRoot)){
      throw 'PUBLISHER_UPGRADE_UNINSTALL_INVALID'
    }
    Check-Draft 'AFTER_UNINSTALL'
  }
}
[ordered]@{
  status='PUBLISHER_04_TO_05_INSTALLED_UPGRADE_PASS'
  oldSourceSha=$baselineSha;newSourceSha=$head
  oldPackageSha256=$oldInfo.packageSha256
  newPackageSha256=$newInfo.packageSha256
  originalProposalId=$manifest.proposalId
  originalUserDraftSha256=$manifest.draftSha256
  sameInstallDirectory=$true;sameDataDirectory=$true
  installed04GuiReadback=$true;installed05GuiReadback=$true
  privatePersonIssuerRun=$false
}|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (
  Join-Path $art 'upgrade-04-to-05-result.json') -Encoding utf8
Write-Host 'PUBLISHER_04_TO_05_INSTALLED_UPGRADE_PASS'