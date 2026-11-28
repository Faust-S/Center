param([int]$ProcessId,[string]$Trace,[string]$Fixture,[ValidateSet('focus-open','focus-enter')][string]$Mode)
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
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
  public uint cbSize,flags;
  public IntPtr hwndActive,hwndFocus,hwndCapture,hwndMenuOwner,hwndMoveSize,hwndCaret;
  public RECT rcCaret;
 }
 [DllImport("user32.dll",SetLastError=true)] public static extern bool GetGUIThreadInfo(uint thread,ref GUITHREADINFO info);
 [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,UIntPtr wParam,System.Text.StringBuilder text,uint flags,uint ms,out UIntPtr result);
 public static IntPtr Focused() {
  var info=new GUITHREADINFO();info.cbSize=(uint)Marshal.SizeOf(typeof(GUITHREADINFO));
  return GetGUIThreadInfo(0,ref info)?info.hwndFocus:IntPtr.Zero;
 }
 public static string NativeClass(IntPtr h) {
  var value=new System.Text.StringBuilder(256);GetClassName(h,value,value.Capacity);return value.ToString();
 }
 public static string ReadEdit(IntPtr h) {
  var value=new System.Text.StringBuilder(32768);UIntPtr count;
  if(SendMessageTimeout(h,0x000D,(UIntPtr)32768,value,3,2000,out count)==IntPtr.Zero)throw new InvalidOperationException("EDIT_READBACK_UNAVAILABLE");
  return value.ToString();
 }
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
function Focused-Filename([IntPtr]$dialog){
 if([ProbeWindow]::GetForegroundWindow() -ne $dialog){return [IntPtr]::Zero}
 $h=[ProbeWindow]::Focused()
 if($h -eq [IntPtr]::Zero -or ![ProbeWindow]::IsChild($dialog,$h) -or ![ProbeWindow]::IsWindowVisible($h) -or ![ProbeWindow]::IsWindowEnabled($h)){return [IntPtr]::Zero}
 if([ProbeWindow]::NativeClass($h) -cne 'Edit'){return [IntPtr]::Zero}
 return $h
}
function Require-FilenameFocus([IntPtr]$dialog,[IntPtr]$edit){
 if($edit -eq [IntPtr]::Zero -or (Focused-Filename $dialog) -ne $edit){throw 'FILENAME_FOCUS_CHANGED'}
}
function Choose-Filename([IntPtr]$dialog){
 $script:stage='FILENAME_FOCUS'
 if([ProbeWindow]::GetForegroundWindow() -ne $dialog){throw 'DIALOG_FOCUS_CHANGED'}
 # The native file dialog's File name mnemonic selects the intended field.
 # Never send file data until its actual owned, enabled Edit HWND has focus.
 [System.Windows.Forms.SendKeys]::SendWait('%n')
 $edit=[IntPtr]::Zero
 for($i=0;$i -lt 40;$i++){
  $edit=Focused-Filename $dialog
  if($edit -ne [IntPtr]::Zero){break}
  Start-Sleep -Milliseconds 100
 }
 if($edit -eq [IntPtr]::Zero){throw 'FILENAME_FOCUS_UNAVAILABLE'}
 Emit ('NATIVE_FILENAME_ID '+[ProbeWindow]::GetDlgCtrlID($edit))
 $parent=[ProbeWindow]::GetParent($edit)
 Emit ('NATIVE_FILENAME_PARENT '+[ProbeWindow]::NativeClass($parent)+' '+[ProbeWindow]::GetDlgCtrlID($parent))
 try{
  $node=[System.Windows.Automation.AutomationElement]::FromHandle($edit)
  Emit ('NATIVE_FILENAME_UIA_TYPE '+$node.Current.ControlType.ProgrammaticName)
 }catch{Emit 'NATIVE_FILENAME_UIA_UNAVAILABLE'}
 $script:stage='FILENAME_VALUE'
 try{
  [System.Windows.Forms.Clipboard]::SetText($Fixture)
  Require-FilenameFocus $dialog $edit
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Require-FilenameFocus $dialog $edit
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Require-FilenameFocus $dialog $edit
  if([ProbeWindow]::ReadEdit($edit) -cne $Fixture){throw 'FILENAME_READBACK_MISMATCH'}
 }finally{[System.Windows.Forms.Clipboard]::Clear()}
 Emit 'FILENAME_READBACK_PASS'
 return $edit
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
    if(!$nativeStandard -or !$uiaStandard -or !$rootOwned -or !$chainOwned){throw 'DIALOG_OWNERSHIP_UNCONFIRMED'}
    $dialog=$h;break
   }
  }
  Start-Sleep -Milliseconds 200
 }
 Emit ('DIALOG_FOREGROUND_LAST '+$last)
 if($dialog -eq [IntPtr]::Zero){throw 'DIALOG_UNAVAILABLE'}
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($dialog)
 $edit=Choose-Filename $dialog
 $script:stage='DIALOG_OPEN'
 Require-FilenameFocus $dialog $edit
 if($Mode -ceq 'focus-open'){
  $buttons=@(By-Id $root '1' | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled -and !$_.Current.IsOffscreen})
  Emit ('OPEN_BUTTON_COUNT '+$buttons.Count)
  if($buttons.Count -ne 1 -or [ProbeWindow]::GetForegroundWindow() -ne $dialog){throw 'OPEN_BUTTON_UNAVAILABLE'}
  $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 }else{
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 }
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
 Activate 'Qualification upload' 'Any' 'fixture-upload' $false
 Select-File $hostHandle
 $script:stage='FILE_SELECTED'
 if(!(Wait-Trace 'FILE_SELECTED')){throw 'FILE_SELECTION_UNCONFIRMED'}
 $script:stage='UPLOAD_SUBMIT'
 Activate 'Submit qualification file' 'Button' 'fixture-upload-submit' $false
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
