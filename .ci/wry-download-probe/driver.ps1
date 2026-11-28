param([int]$ProcessId,[string]$Trace,[ValidateSet('invoke','keyboard','mixed')][string]$Mode)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ProbeWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint f);
}
'@
$p=[Diagnostics.Process]::GetProcessById($ProcessId)
function Lines {if(Test-Path -LiteralPath $Trace){Get-Content -LiteralPath $Trace}}
function Wait-Trace([string]$value,[int]$count=1){
 for($i=0;$i -lt 100;$i++){if(@(Lines | Where-Object {$_ -ceq $value}).Count -ge $count){return $true};Start-Sleep -Milliseconds 200};return $false
}
function Find-Node([string]$name,[string]$kind){
 for($i=0;$i -lt 100;$i++){
  $p.Refresh();if($p.HasExited){throw 'HOST_EXITED'}
  $h=$p.MainWindowHandle
  if($h -ne [IntPtr]::Zero){
   $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
   $r=$root.Current.BoundingRectangle
   $roots=@($root)
   foreach($fraction in @(0.15,0.55)){
    try{
     $point=[System.Windows.Point]::new($r.Left+$r.Width*0.5,$r.Top+$r.Height*$fraction)
     $native=[ProbeWindow+POINT]::new();$native.X=[int]$point.X;$native.Y=[int]$point.Y
     $hit=[ProbeWindow]::WindowFromPoint($native)
     if($hit -eq [IntPtr]::Zero -or ($hit -ne $h -and [ProbeWindow]::GetAncestor($hit,2) -ne $h)){continue}
     $roots+=,[System.Windows.Automation.AutomationElement]::FromHandle($hit)
     $node=[System.Windows.Automation.AutomationElement]::FromPoint($point)
     $walker=[System.Windows.Automation.TreeWalker]::RawViewWalker
     for($d=0;$d -lt 10 -and $null -ne $node;$d++){
      if(!$r.Contains($node.Current.BoundingRectangle)){break}
      $roots+=,$node
      if($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document){break}
      $node=$walker.GetParent($node)
     }
    }catch{}
   }
   $cond=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
   $found=@{}
   foreach($provider in $roots){
    try{$nodes=$provider.FindAll([System.Windows.Automation.TreeScope]::Subtree,$cond)}catch{continue}
    foreach($node in $nodes){try{
     if($node.Current.ControlType.ProgrammaticName -ceq ('ControlType.'+$kind) -and $node.Current.IsEnabled -and !$node.Current.IsOffscreen -and $r.Contains($node.Current.BoundingRectangle)){
      $found[($node.GetRuntimeId() -join ',')]=$node
     }
    }catch{}}
   }
   if($found.Count -gt 1){throw 'AMBIGUOUS_CONTROL'}
   if($found.Count -eq 1){return @($found.Values)[0]}
  }
  Start-Sleep -Milliseconds 200
 }
 throw 'CONTROL_UNAVAILABLE'
}
function Click-Link([bool]$keyboard){
 $node=Find-Node 'Download file' 'Hyperlink'
 if(!$keyboard){$node.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke();return}
 $p.Refresh();$h=$p.MainWindowHandle
 $null=[ProbeWindow]::SetForegroundWindow($h)
 $node.SetFocus()
 for($i=0;$i -lt 30;$i++){
  $fresh=Find-Node 'Download file' 'Hyperlink'
  if([ProbeWindow]::GetForegroundWindow() -eq $h -and $fresh.Current.HasKeyboardFocus){[System.Windows.Forms.SendKeys]::SendWait('{ENTER}');return}
  Start-Sleep -Milliseconds 100
 }
 throw 'KEYBOARD_FOCUS_UNCONFIRMED'
}
$first=$Mode -ceq 'keyboard'
$second=$Mode -cne 'invoke'
try{
 if(!(Wait-Trace 'READY')){throw 'NATIVE_NOT_READY'}
 Write-Output 'PHASE FIRST_DISPATCH';Click-Link $first
 Write-Output ('FIRST_BLOCKED '+(Wait-Trace 'REQUEST_BLOCKED'))
 $arm=Find-Node 'Arm download' 'Button'
 Write-Output 'PHASE ARM';$arm.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 if(!(Wait-Trace 'ARMED')){throw 'ARM_NOT_READBACK'}
 Write-Output 'PHASE SECOND_DISPATCH';Click-Link $second
 Write-Output ('SECOND_ALLOWED '+(Wait-Trace 'REQUEST_ALLOWED'))
 Write-Output ('SECOND_SAVED '+(Wait-Trace 'FINISH_SAVED'))
}catch{Write-Output ('DRIVER_ERROR '+$_.Exception.GetType().Name+' '+$_.Exception.Message);exit 1}
