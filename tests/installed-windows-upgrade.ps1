# True installed 0.1 to installed 0.2 upgrade on one Windows profile.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CenterUpgradeClose {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
}
'@
$proc=$null
$art=Join-Path $env:GITHUB_WORKSPACE 'artifacts'
function Check([bool]$ok,[string]$reason){if(!$ok){throw $reason}}
function InstalledExe {
  foreach($p in @((Join-Path $env:LOCALAPPDATA 'IWXA Admin Center/iwxa-admin-center.exe'),
                 (Join-Path $env:LOCALAPPDATA 'Programs/IWXA Admin Center/iwxa-admin-center.exe'))){
    if(Test-Path -LiteralPath $p){return $p}
  }
  throw 'CENTER_UPGRADE_EXE_MISSING'
}
function OwnerHead([string]$root,[string]$org){
  $path=Join-Path (Join-Path (Join-Path $root 'organizations') $org) 'head.json'
  Check (Test-Path $path) "CENTER_UPGRADE_HEAD_MISSING_$org"
  return (Get-FileHash $path -Algorithm SHA256).Hash
}
function WaitUi([string]$label){
  for($i=0;$i -lt 90;$i++){
    $proc.Refresh()
    if($proc.HasExited){throw 'CENTER_UPGRADE_APP_EXITED_EARLY'}
    if($proc.MainWindowHandle -ne [IntPtr]::Zero){
      $window=[System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
      $nodes=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      foreach($node in $nodes){
        try {if($node.Current.Name.Contains($label)){return}} catch {}
      }
    }
    Start-Sleep -Milliseconds 350
  }
  throw "CENTER_UPGRADE_UI_TEXT_NOT_FOUND: $label"
}
try{
  $baseline=Get-Content (Join-Path $art 'installed-gui-result.json') -Raw|ConvertFrom-Json -Depth 100
  Check ($baseline.status -eq 'INSTALLED_GUI_TWO_ORG_ATLAS_RESTART_PASS') 'CENTER_UPGRADE_BASELINE_GUI_NOT_ACCEPTED'
  $root=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/atlas-store-v1'
  $draft=Join-Path $root 'preparation/draft.json'
  Check (Test-Path $draft) 'CENTER_UPGRADE_BASELINE_DRAFT_MISSING'
  $hash=(Get-FileHash $draft -Algorithm SHA256).Hash
  $state=Get-Content $draft -Raw|ConvertFrom-Json -Depth 100
  Check (@($state.organizations).Count -eq 2) 'CENTER_UPGRADE_BASELINE_ORGS_MISSING'
  $first=@($state.organizations|Where-Object{$_.id -eq $baseline.orgId})[0]
  Check ($first.participants.Count -eq 2 -and $first.assignments.Count -eq 1) 'CENTER_UPGRADE_BASELINE_CONTENT_MISSING'
  Check ($first.assignments[0].id -eq $baseline.assignmentId -and
    $first.assignments[0].atlasRef.projectId -eq $baseline.projectId -and
    $first.assignments[0].atlasRef.workId -eq $baseline.workId) 'CENTER_UPGRADE_BASELINE_REF_MISMATCH'
  $a=OwnerHead $root $baseline.orgId
  $b=OwnerHead $root $baseline.secondOrgId
  [void](InstalledExe)
  $candidate=Get-ChildItem 'candidate-artifact' -Recurse -File -Filter '*_x64-setup.exe'|Select-Object -First 1
  Check ($null -ne $candidate) 'CENTER_UPGRADE_02_INSTALLER_MISSING'
  $candidateHash=(Get-FileHash $candidate.FullName -Algorithm SHA256).Hash
  $install=Start-Process -FilePath $candidate.FullName -ArgumentList '/S' -PassThru
  if(!$install.WaitForExit(120000)){Stop-Process -Id $install.Id -Force;throw 'CENTER_UPGRADE_INSTALL_TIMEOUT'}
  Check ($install.ExitCode -eq 0) "CENTER_UPGRADE_INSTALL_ERROR: $($install.ExitCode)"
  Check ($hash -eq (Get-FileHash $draft -Algorithm SHA256).Hash) 'CENTER_UPGRADE_DRAFT_CHANGED'
  Check ($a -eq (OwnerHead $root $baseline.orgId)) 'CENTER_UPGRADE_ATLAS_FIRST_CHANGED'
  Check ($b -eq (OwnerHead $root $baseline.secondOrgId)) 'CENTER_UPGRADE_ATLAS_SECOND_CHANGED'
  $after=Get-Content $draft -Raw|ConvertFrom-Json -Depth 100
  Check ($state.activeOrganizationId -eq $after.activeOrganizationId) 'CENTER_UPGRADE_SELECTED_ORG_CHANGED'
  $updated=@($after.organizations|Where-Object{$_.id -eq $baseline.orgId})[0]
  Check ($updated.assignments[0].id -eq $baseline.assignmentId -and
    $updated.assignments[0].atlasRef.projectId -eq $baseline.projectId -and
    $updated.assignments[0].atlasRef.workId -eq $baseline.workId) 'CENTER_UPGRADE_WORK_REF_CHANGED'
  Write-Host "CENTER_UPGRADE_01_TO_02_NATIVE_READBACK_PASS orgs=2 people=2 assignment=$($baseline.assignmentId)"
  $exe=InstalledExe
  $proc=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
  WaitUi 'IWXA Admin Center · 0.2.0-dev.1'
  WaitUi $baseline.managerEditedAssignment
  Write-Host "CENTER_UPGRADE_01_TO_02_GUI_READBACK_PASS project=$($baseline.projectId) work=$($baseline.workId)"
  $proc.Refresh()
  Check ([CenterUpgradeClose]::PostMessage($proc.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)) 'CENTER_UPGRADE_CLOSE_POST_FAILED'
  Check ($proc.WaitForExit(9000)) 'CENTER_UPGRADE_CLOSE_FAILED'
  Check ($proc.ExitCode -eq 0) 'CENTER_UPGRADE_EXIT_CODE'
  [pscustomobject]@{
    schema='IWXA_ADMIN_CENTER_INSTALLED_UPGRADE/1';status='PASS';
    sourceVersion='0.1.0';targetVersion='0.2.0-dev.1';
    baselineHead='60ec9a3483f4f947f2e83c098c62807f6af6c05e';
    installerSha256=$candidateHash;draftSha256=$hash;
    organizationIds=@($baseline.orgId,$baseline.secondOrgId);
    firstAtlasHeadSha256=$a;secondAtlasHeadSha256=$b;
    assignmentId=$baseline.assignmentId;projectId=$baseline.projectId;workId=$baseline.workId;
    verification='TWO_INSTALLED_VERSIONS_SAME_PROFILE_SAME_IDS_AND_GUI'
  }|ConvertTo-Json -Depth 100|Set-Content -LiteralPath (Join-Path $art 'upgrade-01-to-02-result.json')
  Write-Host "CENTER_UPGRADE_01_TO_02_FULL_PASS SHA256=$candidateHash"
}catch{
  Write-Host "CENTER_UPGRADE_01_TO_02_FAIL $($_.Exception.Message)"
  try{
    $rect=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp=[System.Drawing.Bitmap]::new($rect.Width,$rect.Height)
    $gfx=[System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($rect.Location,[System.Drawing.Point]::Empty,$rect.Size)
    $bmp.Save((Join-Path $art 'upgrade-failure.png'),[System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose();$bmp.Dispose()
  }catch{}
  throw
}finally{
  if($proc){$proc.Refresh();if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}}
}
