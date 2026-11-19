# Capture only the current verified native Setup Core package, not a simulated/unverified stub.
# The script is a screenshot witness; it never chooses installation or writes user data.
[CmdletBinding()]
param([string]$Bundle = 'artifacts/iwxa-setup-core-center-0.3-preview.exe', [Parameter(Mandatory=$true)][string]$ExpectedBundleCommit)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$bundlePath=[IO.Path]::GetFullPath($Bundle)
if (!(Test-Path -LiteralPath $bundlePath -PathType Leaf)){throw 'QA_SETUP_VERIFIED_BUNDLE_MISSING'}
$folder=Join-Path $env:GITHUB_WORKSPACE 'artifacts'
[void][IO.Directory]::CreateDirectory($folder)
$identity=Join-Path $folder 'qa-setup-current-inspection.json'
$inspect=Start-Process -FilePath $bundlePath -ArgumentList ('--inspect-file "{0}"' -f $identity) -PassThru -Wait
try {
  if($inspect.ExitCode -ne 0){throw 'QA_SETUP_BUNDLE_INSPECTION_EXIT'}
}finally{$inspect.Dispose()}
if(!(Test-Path -LiteralPath $identity)){throw 'QA_SETUP_BUNDLE_NO_IDENTITY'}
$state=Get-Content -LiteralPath $identity -Raw | ConvertFrom-Json
if($state.status -cne 'VERIFIED' -or $state.product -cne 'iwxa.admin-center' -or
   $state.sourceCommit -cne $ExpectedBundleCommit){
  throw 'QA_SETUP_BUNDLE_INVALID_PROVENANCE'
}
$process=$null
try{
  $process=Start-Process -FilePath $bundlePath -PassThru
  $ready=$false
  $window=$null
  for($i=0;$i -lt 100;$i++){
    Start-Sleep -Milliseconds 450
    $process.Refresh()
    if($process.HasExited){throw 'QA_SETUP_GUI_EXITED'}
    if($process.MainWindowHandle -eq [IntPtr]::Zero){continue}
    $window=[Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    $labels=$window.FindAll([Windows.Automation.TreeScope]::Descendants,
      [Windows.Automation.Condition]::TrueCondition)
    $hasStatus=$false
    $hasButton=$false
    foreach($node in $labels){
      try {
        $name=[string]$node.Current.Name
        if($name -ceq 'Ready to install'){$hasStatus=$true}
        if($name -ceq 'Install' -and $node.Current.IsEnabled -and
           $node.Current.ControlType -eq [Windows.Automation.ControlType]::Button){
          $hasButton=$true
        }
      }catch{}
    }
    if($hasStatus -and $hasButton){$ready=$true;break}
  }
  if(!$ready){throw 'QA_SETUP_NATIVE_READY_INSTALL_UI_NOT_VERIFIED'}
  $area=$window.Current.BoundingRectangle
  $screen=[Windows.Forms.Screen]::PrimaryScreen.Bounds
  $x=[int][Math]::Max($screen.Left,[Math]::Floor($area.Left))
  $y=[int][Math]::Max($screen.Top,[Math]::Floor($area.Top))
  $rx=[int][Math]::Min($screen.Right,[Math]::Ceiling($area.Right))
  $by=[int][Math]::Min($screen.Bottom,[Math]::Ceiling($area.Bottom))
  $width=$rx-$x;$height=$by-$y
  if($width -lt 700 -or $height -lt 450){throw 'QA_SETUP_NATIVE_FRAME_INVALID'}
  $png=Join-Path $folder 'qa-setup-core-current-verified-install.png'
  $bitmap=[Drawing.Bitmap]::new($width,$height)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  try{
    $graphics.CopyFromScreen([Drawing.Point]::new($x,$y),
      [Drawing.Point]::Empty,[Drawing.Size]::new($width,$height))
    $bitmap.Save($png,[Drawing.Imaging.ImageFormat]::Png)
  }finally{$graphics.Dispose();$bitmap.Dispose()}
  if((Get-Item -LiteralPath $png).Length -lt 10000){throw 'QA_SETUP_NATIVE_SCREEN_EMPTY'}
  $proof=[ordered]@{
    originalSourceCommit='0ef7544e2a6fd5fab5994f7f25abbb960063908c'
    currentBundleCommit=$ExpectedBundleCommit
    captureWorkflowCommit=$env:GITHUB_SHA
    installedBundleStatus='VERIFIED'
    screenState='READY_FOR_FIRST_INSTALL'
    product='iwxa.admin-center'
    file='qa-setup-core-current-verified-install.png'
    nativeSha256=(Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
    screenshotSha256=(Get-FileHash -LiteralPath $png -Algorithm SHA256).Hash.ToLowerInvariant()
    manipulation='None; copied genuine window pixels'
  }
  $proof | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $folder 'qa-setup-core-current-verified-install.json') -Encoding utf8
  Write-Host ('QA_SETUP_VERIFIED_READY_SCREEN_PASS sha256='+$proof.screenshotSha256)
}finally{
  if($process){
    try{$process.Refresh();if(!$process.HasExited){$null=$process.CloseMainWindow();if(!$process.WaitForExit(5000)){$process.Kill()}}}catch{}
    $process.Dispose()
  }
}
