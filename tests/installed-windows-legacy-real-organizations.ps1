# Real 0.2 UI-derived organization data for cross-version preservation.
[CmdletBinding()]param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$old=Join-Path $env:LOCALAPPDATA 'IWXA Admin Center/iwxa-admin-center.exe'
$draft=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/atlas-store-v1/preparation/draft.json'
$report=Join-Path $env:GITHUB_WORKSPACE 'artifacts/legacy-real-organizations-result.json'
if(!(Test-Path -LiteralPath $old) -or (Test-Path -LiteralPath $draft)){
  throw 'LEGACY_REAL_ORG_NON_CLEAN_INPUT'
}
$p=Start-Process -FilePath $old -WorkingDirectory (Split-Path -Parent $old) -PassThru
function Root {
  $p.Refresh()
  if($p.HasExited -or $p.MainWindowHandle -eq [IntPtr]::Zero){
    throw 'LEGACY_REAL_ORG_WINDOW_UNAVAILABLE'
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}
function FindNode([string]$name,[string]$kind,[bool]$partial=$false){
  for($i=0;$i -lt 80;$i++){
    $nodes=(Root).FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($node in $nodes){
      try {
        $label=[string]$node.Current.Name
        $ok=if($partial){$label.Contains($name)}else{$label -eq $name}
        if($ok -and $node.Current.ControlType.ProgrammaticName.EndsWith('.'+$kind) -and
          !$node.Current.IsOffscreen -and $node.Current.IsEnabled){return $node}
      }catch{}
    }
    Start-Sleep -Milliseconds 300
  }
  throw ('LEGACY_REAL_ORG_CONTROL_NOT_FOUND_{0}_{1}' -f $kind,$name)
}
function Click([string]$name,[bool]$partial=$false){
  $node=FindNode $name 'Button' $partial
  try {
    $node.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  }catch{
    $r=$node.Current.BoundingRectangle
    [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
      [int]($r.Left+$r.Width/2),[int]($r.Top+$r.Height/2))
    Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class M{[DllImport("user32.dll")]public static extern void mouse_event(uint a,uint b,uint c,uint d,UIntPtr e);}' -ErrorAction SilentlyContinue
    [M]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [M]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
  }
  Start-Sleep -Milliseconds 400
}
function Type([string]$name,[string]$value){
  $node=FindNode $name 'Edit'
  $node.SetFocus()
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait($value)
  Start-Sleep -Milliseconds 150
}
function ReadCount([int]$count){
  for($i=0;$i -lt 90;$i++){
    if(Test-Path -LiteralPath $draft){
      try{
        $d=Get-Content -LiteralPath $draft -Raw|ConvertFrom-Json -Depth 100
        if(@($d.organizations).Count -eq $count -and $d.activeOrganizationId){
          return $d
        }
      }catch{}
    }
    Start-Sleep -Milliseconds 300
  }
  throw ('LEGACY_REAL_ORG_SAVE_NOT_VISIBLE_{0}' -f $count)
}
try {
  for($i=0;$i -lt 90;$i++){
    Start-Sleep -Milliseconds 350
    $p.Refresh()
    if($p.HasExited){throw 'LEGACY_REAL_ORG_GUI_EXITED_EARLY'}
    if($p.MainWindowHandle -ne [IntPtr]::Zero){break}
  }
  Type 'Название' 'LegacyVerifiedOrgOne'
  Click 'Создать черновик организации'
  Click 'Сохранить на компьютере'
  $first=ReadCount 1
  Write-Host 'LEGACY_02_REAL_ORGANIZATION_ONE_SAVED_PASS'
  Click 'Добавить организацию' $true
  Type 'Название' 'LegacyVerifiedOrgTwo'
  Click 'Создать черновик организации'
  Click 'Сохранить на компьютере'
  $second=ReadCount 2
  $names=@($second.organizations|ForEach-Object{$_.name}|Sort-Object)
  if(($names -join '|') -ne 'LegacyVerifiedOrgOne|LegacyVerifiedOrgTwo' -or
    $second.organizations[0].id -eq $second.organizations[1].id){
    throw 'LEGACY_REAL_ORG_TWO_ORG_IDENTITY_MISMATCH'
  }
  [pscustomobject]@{status='PASS_REAL_02_GUI';organizations=@($second.organizations|ForEach-Object{
    [pscustomobject]@{id=$_.id;name=$_.name}
  })}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $report
  Write-Host 'LEGACY_02_REAL_TWO_ORGANIZATION_GUI_SAVE_PASS'
}finally{
  $p.Refresh()
  if(!$p.HasExited){
    $null=$p.CloseMainWindow()
    if(!$p.WaitForExit(10000)){
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
  $p.Dispose()
}
