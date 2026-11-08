$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PublisherWindow {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extraInfo);
}
'@
$exe=Join-Path $env:LOCALAPPDATA 'IWXA Publisher\iwxa-publisher.exe'
$data=Join-Path $env:LOCALAPPDATA 'ru.iwxa.publisher\publisher-preparation-v1.json'
$proc=$null
function Start-Publisher {
  $script:proc=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
  for($i=0;$i -lt 80;$i++){
    Start-Sleep -Milliseconds 350
    $proc.Refresh()
    if($proc.HasExited){throw 'Installed Publisher exited before showing GUI'}
    if($proc.MainWindowHandle -ne [IntPtr]::Zero){return}
  }
  throw 'Installed Publisher did not expose a native window'
}
function Root-Element {
  $proc.Refresh()
  return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
}
function Find-Control([string]$name,[string]$kind){
  $expected=if($kind -eq 'Edit'){[System.Windows.Automation.ControlType]::Edit}else{[System.Windows.Automation.ControlType]::Button}
  $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
  for($i=0;$i -lt 60;$i++){
    $nodes=(Root-Element).FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
    foreach($node in $nodes){
      try { if($node.Current.ControlType -eq $expected){return $node} }catch{}
    }
    Start-Sleep -Milliseconds 300
  }
  throw "Installed Publisher UIA control missing: $kind $name"
}
function Click-Publisher([string]$name){
  $node=Find-Control $name 'Button'
  try {
    $node.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  } catch {
    $b=$node.Current.BoundingRectangle
    if($b.IsEmpty){throw "Installed Publisher button is not clickable: $name"}
    [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
      [int]($b.Left+$b.Width/2),[int]($b.Top+$b.Height/2))
    [PublisherWindow]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [PublisherWindow]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  }
  Start-Sleep -Milliseconds 300
}
function Enter-Value([string]$name,[string]$value){
  $node=Find-Control $name 'Edit'
  $node.SetFocus()
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait($value)
  Start-Sleep -Milliseconds 150
}
function Close-Publisher {
  $proc.Refresh()
  if(!$proc.HasExited) {
    if(![PublisherWindow]::PostMessage($proc.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Publisher WM_CLOSE failed'}
    if(!$proc.WaitForExit(12000)){throw 'Publisher did not close'}
  }
  Write-Host "PUBLISHER_NATIVE_CLOSE_PASS"
}
try {
  $installer=Get-ChildItem 'publisher/src-tauri/target/release/bundle/nsis/*.exe'|Select-Object -First 1
  if(!$installer){throw 'Publisher NSIS installer absent'}
  $install=Start-Process -FilePath $installer.FullName -ArgumentList '/S' -PassThru
  if(!$install.WaitForExit(120000)){throw 'Publisher installation timed out'}
  if($install.ExitCode -ne 0){throw "Publisher installer exit $($install.ExitCode)"}
  if(!(Test-Path -LiteralPath $exe)){throw "Installed Publisher exe missing: $exe"}
  Write-Host "PUBLISHER_INSTALLED_EXE_PASS sha256=$((Get-FileHash $exe -Algorithm SHA256).Hash)"
  Start-Publisher
  Click-Publisher 'Продукты'
  Enter-Value 'Идентификатор продукта' 'IWXA_PUBLISHER_TEST'
  Enter-Value 'Название' 'PublisherInstalledTest'
  Enter-Value 'Версия' '0.2.0'
  Click-Publisher 'Сохранить продукт'
  $readback=$null
  for($i=0;$i -lt 60;$i++) {
    if(Test-Path -LiteralPath $data){
      try{
        $candidate=Get-Content -LiteralPath $data -Raw|ConvertFrom-Json -Depth 50
        if(@($candidate.products).Count -eq 1 -and $candidate.products[0].id -eq 'IWXA_PUBLISHER_TEST'){
          $readback=$candidate;break
        }
      }catch{}
    }
    Start-Sleep -Milliseconds 350
  }
  if(!$readback){throw 'Publisher GUI did not persist native preparation draft'}
  if(@($readback.proposals).Count -ne 0){throw 'Publisher created a fake signed license'}
  Write-Host 'PUBLISHER_INSTALLED_GUI_NATIVE_DRAFT_WRITE_PASS'
  Close-Publisher
  Start-Publisher
  if(!(Test-Path -LiteralPath $data)){throw 'Publisher preparation disappeared after native restart'}
  $again=Get-Content -LiteralPath $data -Raw|ConvertFrom-Json -Depth 50
  if(@($again.products).Count -ne 1 -or $again.products[0].name -ne 'PublisherInstalledTest'){
    throw 'Publisher preparation readback mismatch after relaunch'
  }
  Write-Host 'PUBLISHER_INSTALLED_GUI_RESTART_READBACK_PASS'
} finally {
  if($proc -and !$proc.HasExited){
    try{Close-Publisher}catch{Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
  }
}
