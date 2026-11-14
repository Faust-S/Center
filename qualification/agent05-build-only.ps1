# Build-only route for the previously qualified private IWXA Agent 0.5.0 source.
# No pytest, node --test, cargo test, installed GUI, model inference, upgrade,
# rollback, uninstall, GitHub Actions, release publication or user-data access.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$AgentRoot,
    [Parameter(Mandatory=$true)][string]$OutputRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$agentSha='47ba22bdb0e4dbeeb91d3a56199395db3472145e'
if($env:OS -ne 'Windows_NT'){throw 'agent05_build_windows_required'}
$center=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$agent=[IO.Path]::GetFullPath($AgentRoot)
$out=[IO.Path]::GetFullPath($OutputRoot)
function IsInside([string]$child,[string]$root){
    $base=[IO.Path]::GetFullPath($root).TrimEnd('\')
    $candidate=[IO.Path]::GetFullPath($child).TrimEnd('\')
    return $candidate.Equals($base,[StringComparison]::OrdinalIgnoreCase) -or
        $candidate.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)
}
if((IsInside $out $center) -or (IsInside $out $agent)){
    throw 'agent05_build_output_inside_checkout_forbidden'
}
if(Test-Path -LiteralPath $out){throw 'agent05_build_output_must_not_exist'}
$git=(Get-Command git.exe -ErrorAction Stop).Source
function GitText([string]$directory,[string[]]$arguments){
    $text=@(& $git -C $directory @arguments)
    if($LASTEXITCODE -ne 0){throw 'agent05_build_git_identity_failed'}
    return ([string]::Join([Environment]::NewLine,$text)).Trim()
}
$sourceCommit=GitText $agent @('rev-parse','HEAD')
$sourceTree=GitText $agent @('rev-parse','HEAD^{tree}')
$centerCommit=GitText $center @('rev-parse','HEAD')
if($sourceCommit -cne $agentSha){throw 'agent05_build_private_source_changed'}
if((GitText $agent @('status','--porcelain','--untracked-files=all')) -or
   (GitText $center @('status','--porcelain','--untracked-files=all'))){
    throw 'agent05_build_checkout_not_clean'
}
$version=Get-Content -LiteralPath (Join-Path $agent 'desktop/src-tauri/tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($version.version -cne '0.5.0'){throw 'agent05_build_product_version_changed'}
$ps=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
if(!(Test-Path -LiteralPath $ps -PathType Leaf)){throw 'agent05_build_windows_powershell_missing'}
$node=(Get-Command node.exe -ErrorAction Stop).Source
$npm=(Get-Command npm.cmd -ErrorAction Stop).Source
$null=(Get-Command cargo.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $out | Out-Null
$work=Join-Path $out 'work'
$logs=Join-Path $out 'private-build-logs'
$cache=Join-Path $out 'download-cache'
$stage=Join-Path $work 'native-desktop'
foreach($p in @($work,$logs,$cache,$stage)){New-Item -ItemType Directory -Force -Path $p | Out-Null}
# The already-qualified Windows packaging path is reused. Only build steps
# execute; no acceptance script or installed application is launched.
$managed=Join-Path $work 'managed-python'
& $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $agent 'tools/ensure_windows_python_runtime.ps1') -RuntimeRoot $managed -ManifestPath (Join-Path $agent 'config/runtime-bootstrap/windows-python.json') -CacheRoot $cache -RuntimeWheelManifest (Join-Path $agent 'config/runtime-bootstrap/windows-runtime-wheels.json') *> (Join-Path $logs 'managed-python.log')
if($LASTEXITCODE -ne 0){throw 'agent05_build_managed_python_failed'}
$pointer=Join-Path $managed 'current-python.txt'
if(!(Test-Path -LiteralPath $pointer -PathType Leaf)){throw 'agent05_build_python_pointer_missing'}
$python=(Get-Content -LiteralPath $pointer -Raw).Trim()
if(!(Test-Path -LiteralPath $python -PathType Leaf)){throw 'agent05_build_python_missing'}
foreach($name in @('package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','src','public','src-tauri')){
    Copy-Item -LiteralPath (Join-Path $agent ('desktop/'+$name)) -Destination (Join-Path $stage $name) -Recurse -Force
}
$iconDir=Join-Path $stage 'src-tauri/icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
& $python -I (Join-Path $agent 'tools/iwxa_ico_for_rc.py') --source (Join-Path $agent 'webui/iwxa-personal.ico') --output (Join-Path $iconDir 'icon.ico') *> (Join-Path $logs 'icon.log')
if($LASTEXITCODE -ne 0){throw 'agent05_build_icon_failed'}
& $node (Join-Path $agent 'scripts/prepare-public-modules.mjs') --only-u04 --fetch *> (Join-Path $logs 'u04-pin.log')
if($LASTEXITCODE -ne 0){throw 'agent05_build_u04_owner_unavailable'}
& $node (Join-Path $agent 'scripts/stage-u04-desktop.mjs') (Join-Path $agent 'build/u04-owner-sources') (Join-Path $stage 'public/u04') *> (Join-Path $logs 'u04-stage.log')
if($LASTEXITCODE -ne 0){throw 'agent05_build_u04_stage_failed'}
function NpmBuild([string[]]$args,[string]$code,[string]$logname){
    $stdout=Join-Path $logs ($logname+'.stdout')
    $stderr=Join-Path $logs ($logname+'.stderr')
    $process=Start-Process -FilePath $npm -ArgumentList $args -WorkingDirectory $stage -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    try{
        $null=$process.Handle
        $process.WaitForExit()
        $process.Refresh()
        if($null -eq $process.ExitCode -or $process.ExitCode -ne 0){throw $code}
    }finally{$process.Dispose()}
}
NpmBuild @('ci','--no-audit','--no-fund') 'agent05_build_npm_dependencies_failed' 'npm-ci'
# Production build necessarily compiles TypeScript, Vite and Rust. It does
# NOT run tests, inspect a GUI, invoke a model, or execute an installed Setup.
NpmBuild @('run','tauri:build','--','--no-bundle') 'agent05_build_tauri_failed' 'tauri-build'
$nativeExe=Join-Path $stage 'src-tauri/target/release/iwxa-personal.exe'
$nativeDist=Join-Path $stage 'dist'
if(!(Test-Path -LiteralPath $nativeExe -PathType Leaf) -or
   !(Test-Path -LiteralPath (Join-Path $nativeDist 'index.html') -PathType Leaf)){
    throw 'agent05_build_native_outputs_missing'
}
$packageRoot=Join-Path $work 'package'
$packageLogs=Join-Path $logs 'package'
New-Item -ItemType Directory -Force -Path $packageRoot,$packageLogs | Out-Null
$packageBuildLog=Join-Path $logs 'package-build-only.json'
& $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $agent 'tools/qualify_explorer_windows_phase1_package.ps1') -BuildDir $packageRoot -LogsDir $packageLogs -CacheRoot $cache -NativeDesktopDist $nativeDist -NativeDesktopExe $nativeExe -BuildOnly *> $packageBuildLog
if($LASTEXITCODE -ne 0){throw 'agent05_build_private_package_failed'}
$packageReceipt=Get-Content -LiteralPath $packageBuildLog -Raw -Encoding UTF8 | ConvertFrom-Json
$package=Join-Path $packageRoot 'IWXA-Personal-Agent-Windows-Explorer-Prototype.zip'
if($packageReceipt.status -cne 'BUILT_ONLY' -or
   $packageReceipt.source_commit -cne $sourceCommit -or
   $packageReceipt.source_tree -cne $sourceTree -or
   !(Test-Path -LiteralPath $package -PathType Leaf)){
    throw 'agent05_build_package_identity_failed'
}
$setup=Join-Path $out 'IWXA-Personal-Agent-0.5.0-Setup.exe'
$builderLog=Join-Path $logs 'setup-core-build.json'
& $python -B (Join-Path $agent 'tools/build_setup_core_release.py') --product-package $package --center-root $center --center-commit $centerCommit --output $setup --python $python *> $builderLog
if($LASTEXITCODE -ne 0){throw 'agent05_build_setup_core_failed'}
$record=Get-Content -LiteralPath $builderLog -Raw -Encoding UTF8 | ConvertFrom-Json
$sha=(Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
if($record.status -cne 'BUILT_UNQUALIFIED' -or $record.version -cne '0.5.0' -or
   $record.private_source_commit -cne $sourceCommit -or
   $record.private_source_tree -cne $sourceTree -or
   $record.public_setup_core_commit -cne $centerCommit -or $record.setup_sha256 -cne $sha){
    throw 'agent05_build_setup_core_identity_failed'
}
($sha+'  IWXA-Personal-Agent-0.5.0-Setup.exe') | Set-Content -LiteralPath (Join-Path $out 'SHA256SUMS.txt') -Encoding ascii
[ordered]@{
    schema='IWXA_AGENT_0_5_BUILD_ONLY/1'
    status='BUILT_ONLY'
    version='0.5.0'
    source_commit=$sourceCommit
    source_tree=$sourceTree
    setup_core_commit=$centerCommit
    setup_sha256=$sha
    setup_bytes=(Get-Item -LiteralPath $setup).Length
    exe=$setup
    tests_reexecuted=$false
    installer_launched=$false
    private_artifacts_published=$false
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out 'build-receipt.json') -Encoding UTF8
Write-Host 'AGENT05_BUILD_ONLY_COMPLETE'
Write-Host ('AGENT05_SETUP_050_SHA256='+$sha)
