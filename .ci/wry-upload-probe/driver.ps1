param([int]$ProcessId,[string]$Trace,[string]$Fixture,[ValidateSet('strict','anchored','keyboard')][string]$Mode)
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
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint f);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,System.Text.StringBuilder value,int max);
}
'@
$p=[Diagnostics.Process]::GetProcessById($ProcessId)
function Lines {if(Test-Path -LiteralPath $Trace){Get-Content -LiteralPath $Trace}}
function Wait-Trace([string]$value,[int]$count=1){
 for($i=0;$i -lt 100;$i++){if(@(Lines | Where-Object {$_ -ceq $value}).Count -ge $count){return $true};Start-Sleep -Milliseconds 200};return $false
}
function Find-Node([string]$name,[string]$kind,[string]$id=""){
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
   foreach($byId in @($true,$false)){
    if($byId -and !$id){continue}
    $property=if($byId){[System.Windows.Automation.AutomationElement]::AutomationIdProperty}else{[System.Windows.Automation.AutomationElement]::NameProperty}
    $key=if($byId){$id}else{$name}
    $cond=[System.Windows.Automation.PropertyCondition]::new($property,$key)
    $found=@{}
    foreach($provider in $roots){
     try{$nodes=$provider.FindAll([System.Windows.Automation.TreeScope]::Subtree,$cond)}catch{continue}
     foreach($node in $nodes){try{
      $type=$node.Current.ControlType.ProgrammaticName
      if($type -in @('ControlType.Document','ControlType.Window')){continue}
      if(($kind -eq 'Any' -or $type -ceq ('ControlType.'+$kind)) -and $node.Current.IsEnabled -and !$node.Current.IsOffscreen -and $r.Contains($node.Current.BoundingRectangle)){
       $found[($node.GetRuntimeId() -join ',')]=$node
      }
     }catch{}}
    }
    if($found.Count -gt 1){throw 'AMBIGUOUS_CONTROL'}
    if($found.Count -eq 1){return @($found.Values)[0]}
   }
  }
  Start-Sleep -Milliseconds 200
 }
 throw 'CONTROL_UNAVAILABLE'
}
function Emit([string]$s){[Console]::WriteLine($s)}
function Activate([string]$name,[string]$kind,[string]$id,[bool]$keyboard){
 $node=Find-Node $name $kind $id
 Emit ('CONTROL '+$node.Current.ControlType.ProgrammaticName)
 if(!$keyboard){
  $pattern=$node.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke();return
 }
 $p.Refresh();$h=$p.MainWindowHandle
 $null=[ProbeWindow]::SetForegroundWindow($h)
 $identity=$node.GetRuntimeId() -join ','
 $node.SetFocus()
 for($i=0;$i -lt 30;$i++){
  $fresh=Find-Node $name $kind $id
  if(($fresh.GetRuntimeId() -join ',') -cne $identity){throw 'CONTROL_CHANGED'}
  if([ProbeWindow]::GetForegroundWindow() -eq $h -and $fresh.Current.HasKeyboardFocus){
   [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');return
  }
  Start-Sleep -Milliseconds 100
 }
 throw 'KEYBOARD_FOCUS_UNCONFIRMED'
}
function By-Id($root,[string]$id){
 $cond=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$id)
 return $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
}
function Visible-Edit($node){
 return ($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $node.Current.IsEnabled -and !$node.Current.IsOffscreen)
}
function Owned-Chain([IntPtr]$dialog,[IntPtr]$hostHandle){
 $owner=$dialog
 for($i=0;$i -lt 12;$i++){
  $owner=[ProbeWindow]::GetWindow($owner,4)
  if($owner -eq [IntPtr]::Zero){return $false}
  if($owner -eq $hostHandle -or [ProbeWindow]::GetAncestor($owner,2) -eq $hostHandle){return $true}
 }
 return $false
}
function Select-File([IntPtr]$hostHandle){
 $script:stage='DIALOG_DISCOVERY'
 $dialog=[IntPtr]::Zero
 $last='NONE'
 for($i=0;$i -lt 100;$i++){
  $h=[ProbeWindow]::GetForegroundWindow()
  if($h -eq $hostHandle){$last='HOST'}
  elseif($h -ne [IntPtr]::Zero -and [ProbeWindow]::IsWindowVisible($h)){
   $last='OTHER_WINDOW'
   $nativeClass=[System.Text.StringBuilder]::new(256)
   $null=[ProbeWindow]::GetClassName($h,$nativeClass,$nativeClass.Capacity)
   $nativeStandard=$nativeClass.ToString() -ceq '#32770'
   $candidate=[System.Windows.Automation.AutomationElement]::FromHandle($h)
   $uiaStandard=$candidate.Current.ClassName -ceq '#32770'
   if($nativeStandard -or $uiaStandard){
    $last='STANDARD_DIALOG'
    $rootOwned=[ProbeWindow]::GetAncestor($h,3) -eq $hostHandle
    $chainOwned=Owned-Chain $h $hostHandle
    Emit ('DIALOG_NATIVE_CLASS '+$nativeStandard+' UIA_CLASS '+$uiaStandard+' ROOT_OWNER_HOST '+$rootOwned+' OWNER_CHAIN_HOST '+$chainOwned)
    if($Mode -ceq 'strict'){
     if(!$uiaStandard -or !$rootOwned){throw 'DIALOG_LEGACY_IDENTITY_UNCONFIRMED'}
    }elseif(!$nativeStandard -or !($rootOwned -or $chainOwned)){throw 'DIALOG_OWNERSHIP_UNCONFIRMED'}
    $dialog=$h;break
   }
  }
  Start-Sleep -Milliseconds 200
 }
 Emit ('DIALOG_FOREGROUND_LAST '+$last)
 if($dialog -eq [IntPtr]::Zero){throw 'DIALOG_UNAVAILABLE'}
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($dialog)
 $script:stage='FILENAME_DISCOVERY'
 $numeric=@(By-Id $root '1148')
 $hostControls=@(By-Id $root 'FileNameControlHost')
 $direct=@($numeric | Where-Object {Visible-Edit $_})
 Emit ('ID1148_COUNT '+$numeric.Count+' DIRECT_EDIT_COUNT '+$direct.Count+' NAMED_HOST_COUNT '+$hostControls.Count)
 foreach($node in $numeric){Emit ('ID1148_TYPE '+$node.Current.ControlType.ProgrammaticName)}
 $edits=@{}
 $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
 foreach($anchor in @($numeric+$hostControls)){
  if(Visible-Edit $anchor){$edits[($anchor.GetRuntimeId() -join ',')]=$anchor}
  foreach($node in $anchor.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)){
   if(Visible-Edit $node){$edits[($node.GetRuntimeId() -join ',')]=$node}
  }
 }
 Emit ('ANCHORED_EDIT_COUNT '+$edits.Count)
 $choices=if($Mode -ceq 'strict'){@($direct)}else{@($edits.Values)}
 $choices=@($choices)
 if($choices.Count -ne 1){throw 'FILENAME_NOT_UNIQUE'}
 $script:stage='FILENAME_VALUE'
 $value=$choices[0].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
 if($value.Current.IsReadOnly -or [ProbeWindow]::GetForegroundWindow() -ne $dialog){throw 'FILENAME_NOT_WRITABLE'}
 $value.SetValue($Fixture)
 if($value.Current.Value -cne $Fixture){throw 'FILENAME_READBACK_MISMATCH'}
 Emit 'FILENAME_READBACK_PASS'
 $script:stage='DIALOG_OPEN'
 $buttons=@(By-Id $root '1' | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled -and !$_.Current.IsOffscreen})
 Emit ('OPEN_BUTTON_COUNT '+$buttons.Count)
 if($buttons.Count -ne 1 -or [ProbeWindow]::GetForegroundWindow() -ne $dialog){throw 'OPEN_BUTTON_UNAVAILABLE'}
 $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 $script:stage='DIALOG_CLOSE'
 for($i=0;$i -lt 100;$i++){
  if(![ProbeWindow]::IsWindow($dialog) -and [ProbeWindow]::GetForegroundWindow() -eq $hostHandle){Emit 'DIALOG_CLOSED';return}
  Start-Sleep -Milliseconds 200
 }
 throw 'DIALOG_CLOSE_UNCONFIRMED'
}
$script:stage='START'
try{
 if(!(Wait-Trace 'READY')){throw 'NATIVE_NOT_READY'}
 if(!(Test-Path -LiteralPath $Fixture -PathType Leaf)){throw 'FIXTURE_MISSING'}
 $script:stage='DOWNLOAD_BLOCK'
 Activate 'Download file' 'Hyperlink' 'link' $true
 if(!(Wait-Trace 'REQUEST_BLOCKED')){throw 'DOWNLOAD_FIRST_BLOCK_MISSING'}
 $script:stage='DOWNLOAD_ARM'
 Activate 'Arm download' 'Button' 'arm' $false
 if(!(Wait-Trace 'ARMED')){throw 'ARM_NOT_READBACK'}
 $script:stage='DOWNLOAD_SAVE'
 Activate 'Download file' 'Hyperlink' 'link' $true
 if(!(Wait-Trace 'REQUEST_ALLOWED') -or !(Wait-Trace 'FINISH_SAVED')){throw 'DOWNLOAD_SAVE_UNCONFIRMED'}
 $script:stage='DOWNLOAD_BLOCK_AGAIN'
 Activate 'Download file' 'Hyperlink' 'link' $true
 if(!(Wait-Trace 'REQUEST_BLOCKED' 2)){throw 'DOWNLOAD_SECOND_BLOCK_MISSING'}
 $script:stage='PICKER_ACTIVATE'
 $p.Refresh();$hostHandle=$p.MainWindowHandle
 if($hostHandle -eq [IntPtr]::Zero){throw 'HOST_WINDOW_UNAVAILABLE'}
 Activate 'Qualification upload' 'Any' 'fixture-upload' ($Mode -ceq 'keyboard')
 Select-File $hostHandle
 $script:stage='FILE_SELECTED'
 if(!(Wait-Trace 'FILE_SELECTED')){throw 'FILE_SELECTION_UNCONFIRMED'}
 $script:stage='UPLOAD_SUBMIT'
 Activate 'Submit qualification file' 'Button' 'fixture-upload-submit' ($Mode -ceq 'keyboard')
 if(!(Wait-Trace 'UPLOAD_SUBMIT')){throw 'SUBMISSION_UNCONFIRMED'}
 $script:stage='UPLOAD_READBACK'
 $null=Find-Node 'Upload accepted' 'Text'
 Emit 'GUI_UPLOAD_PASS'
}catch{
 Emit ('DRIVER_STAGE '+$script:stage)
 $message=if($_.Exception.Message -cmatch '^[A-Z_]+$'){$_.Exception.Message}else{'NATIVE_EXCEPTION'}
 Emit ('DRIVER_ERROR '+$_.Exception.GetType().Name+' '+$message)
 exit 1
}
