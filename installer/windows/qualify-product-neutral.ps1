# Qualify two independent native products using only generated fixtures.
# No product source, binaries, credentials or user profile data are inputs.
[CmdletBinding()]
param([string]$Stub='artifacts/iwxa-setup-core-early.exe')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$stubPath=[IO.Path]::GetFullPath($Stub)
if(!(Test-Path -LiteralPath $stubPath -PathType Leaf)){throw 'SETUP_NEUTRAL_STUB_MISSING'}
$python=(Get-Command python.exe -ErrorAction Stop).Source
$csc=@(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Select-Object -First 1
if(!$csc){throw 'SETUP_NEUTRAL_CSC_MISSING'}
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$root=Join-Path $env:LOCALAPPDATA ('iwxa-neutral-fixtures-'+[Guid]::NewGuid().ToString('N'))
$version='1.0.0'
$commit=if($env:GITHUB_SHA -match '^[0-9a-f]{40}$'){$env:GITHUB_SHA}else{'a'*40}
$tree='b'*40
$created=New-Object 'System.Collections.Generic.List[object]'
$source=@'
using System;
using System.IO;
using System.Threading;
internal static class FixtureProgram {
    [STAThread]
    private static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--probe") return 0;
        if (args.Length == 1 && args[0] == "--hold") {
            Thread.Sleep(45000);
            return 0;
        }
        return 1;
    }
}
'@
function Invoke-Setup([string]$file,[string[]]$arguments,[int]$expected=0){
    $output=Join-Path $root ('receipt-'+[Guid]::NewGuid().ToString('N')+'.json')
    $values=@($arguments)+@($output)
    $process=Start-Process -FilePath $file -ArgumentList $values -PassThru -Wait -WindowStyle Hidden
    try{
        if($process.ExitCode -ne $expected){
            # Generated, synthetic products only. Print a bounded failure
            # class rather than the native receipt, full path or command line.
            $class='NATIVE_ERROR'
            if(Test-Path -LiteralPath $output -PathType Leaf){
                try{
                    $receipt=Get-Content -LiteralPath $output -Raw -Encoding UTF8 | ConvertFrom-Json
                    $reason=[string]$receipt.reason
                    if($reason -match '(?i)too long|PathTooLong|MAX_PATH'){
                        $class='PATH_TOO_LONG'
                    }elseif($reason -cmatch '^SETUP_[A-Z0-9_]{3,90}$'){
                        $class=$reason
                    }elseif($reason -match '(?i)access is denied|UnauthorizedAccess'){
                        $class='ACCESS_DENIED'
                    }
                }catch{}
            }
            $action=([string]$arguments[0]) -replace '[^a-z-]',''
            throw ('SETUP_NEUTRAL_NATIVE_EXIT_'+$class+'_ACTION_'+$action)
        }
    }finally{$process.Dispose()}
    if(!(Test-Path -LiteralPath $output -PathType Leaf)){
        throw 'SETUP_NEUTRAL_RECEIPT_MISSING'
    }
    return (Get-Content -LiteralPath $output -Raw | ConvertFrom-Json)
}
function Make-Product([string]$tag,[switch]$LongPaths,[string]$ProductId='',[string]$ProductVersion='',[switch]$NestedEntrypoint) {
    $id=if($ProductId){$ProductId}else{'iwxa.fixture.'+$tag}
    $buildVersion=if($ProductVersion){$ProductVersion}else{$version}
    $folder=Join-Path $root $tag
    $payload=Join-Path $folder 'payload'
    $exeRelative=if($NestedEntrypoint){'desktop\bin\Sample Window.exe'}else{'bin\fixture.exe'}
    $exe=Join-Path $payload $exeRelative
    New-Item -ItemType Directory -Path (Split-Path -Parent $exe) -Force | Out-Null
    $src=Join-Path $folder 'fixture.cs'
    [IO.File]::WriteAllText($src,$source,[Text.Encoding]::ASCII)
    & $csc /nologo /target:winexe /platform:anycpu /optimize+ ("/out:"+$exe) $src
    if($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $exe -PathType Leaf)){
        throw 'SETUP_NEUTRAL_FIXTURE_COMPILE_FAILED'
    }
    New-Item -ItemType Directory -Path (Join-Path $payload 'assets') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $payload 'tools') -Force | Out-Null
    Copy-Item -LiteralPath $exe -Destination (Join-Path $payload 'tools\worker.exe') -Force
    [IO.File]::WriteAllText((Join-Path $payload 'assets\fixture.txt'),('fixture-'+$tag))
    if($LongPaths){
        # Synthetic payload stays below legacy MAX_PATH before packaging,
        # but the real same-volume .iwxa-new-<GUID> stage crosses 260.
        $part='nested'+('x'*19)
        $rel='assets'
        for($n=0;$n -lt 4;$n++){$rel=Join-Path $rel $part}
        $rel=Join-Path $rel 'long-path.txt'
        $deepFile=Join-Path $payload $rel
        $staged=Join-Path $folder 'installed'
        $staged=$staged+'.iwxa-new-'+('a'*32)
        if($deepFile.Length -ge 248 -or (Join-Path $staged $rel).Length -lt 270){
            throw 'SETUP_NEUTRAL_DEEP_PATH_FIXTURE_NOT_DISCRIMINATING'
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $deepFile) -Force | Out-Null
        [IO.File]::WriteAllText($deepFile,'generated-public-long-path-fixture')
    }
    $manifest=Join-Path $folder 'product.json'
    $product=[ordered]@{
        schema='IWXA_SETUP_PRODUCT/1';id=$id;display_name=('IWXA Test '+$tag)
        publisher='IWXA';version=$buildVersion;architecture='windows-x64'
        install_dir=('IWXA Test '+$tag)
        entrypoint=($exeRelative.Replace('\','/'));data_namespace=$id
        requirements=@()
    }
    [IO.File]::WriteAllText($manifest,($product|ConvertTo-Json -Depth 5),
        [Text.UTF8Encoding]::new($false))
    $bundle=Join-Path $folder 'setup.exe'
    $args=@((Join-Path $repo 'installer\build_bundle.py'),'build-resource',
        '--product',$manifest,'--payload',$payload,'--stub',$stubPath,
        '--output',$bundle,'--source-commit',$commit,'--source-tree',$tree)
    & $python @args | Out-Null
    if($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $bundle -PathType Leaf)){
        throw 'SETUP_NEUTRAL_BUNDLE_BUILD_FAILED'
    }
    $program=Join-Path $folder 'installed'
    $data=Join-Path $folder 'data'
    $software=Join-Path $folder 'software'
    $models=Join-Path $folder 'models'
    $cache=Join-Path $folder 'cache'
    $request=Join-Path $folder 'locations.json'
    [ordered]@{
        schema='IWXA_SETUP_LOCATIONS/1';programRoot=$program
        dataRoot=$data;softwareRoot=$software;modelsRoot=$models
        cacheRoot=$cache;startWithWindows=$false
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $request -Encoding UTF8
    $p=[pscustomobject]@{id=$id;bundle=$bundle;program=$program;data=$data
        request=$request;exe=$exe;key=('HKCU:\Software\IWXA\SetupCore\Products\'+$id)}
    $created.Add($p)
    return $p
}
try{
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $tagA='a'+[Guid]::NewGuid().ToString('N').Substring(0,10)
    $tagB='b'+[Guid]::NewGuid().ToString('N').Substring(0,10)
    $a=Make-Product $tagA
    $b=Make-Product $tagB
    foreach($item in @($a,$b)){
        $inspect=Invoke-Setup $item.bundle @('--inspect-file')
        if($inspect.status -ne 'VERIFIED' -or $inspect.product -ne $item.id -or
            $inspect.packageFormat -ne 'PE_RESOURCE_V2' -or
            $inspect.entrypoint -ne 'bin/fixture.exe' ){
            throw 'SETUP_NEUTRAL_BUNDLE_IDENTITY_FAILED'
        }
        $install=Invoke-Setup $item.bundle @('--install-locations-file',('"' + $item.request + '"'))
        if($install.status -ne 'INSTALLED_NOT_LAUNCHED' -or
            !(Test-Path -LiteralPath (Join-Path $item.program 'bin\fixture.exe'))){
            throw 'SETUP_NEUTRAL_INSTALL_FAILED'
        }
        $verify=Invoke-Setup $item.bundle @('--verify-installed-file')
        if($verify.status -ne 'OWNED_FILES_VERIFIED' -or $verify.product -ne $item.id){
            throw 'SETUP_NEUTRAL_INSTALLED_IDENTITY_FAILED'
        }
        $readback=Invoke-Setup $item.bundle @('--locations-file')
        if($readback.status -ne 'LOCATIONS_VERIFIED' -or
            $readback.programRoot -ne $item.program -or
            $readback.dataRoot -ne $item.data){
            throw 'SETUP_NEUTRAL_CUSTOM_LOCATION_FAILED'
        }
        $probe=Start-Process -FilePath (Join-Path $item.program 'bin\fixture.exe') -ArgumentList '--probe' -Wait -PassThru
        try{if($probe.ExitCode -ne 0){throw 'SETUP_NEUTRAL_ENTRYPOINT_FAILED'}}finally{$probe.Dispose()}
        New-Item -ItemType Directory -Path $item.data -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $item.data 'userdata.txt'),$item.id)
    }
    Write-Host 'IWXA_SETUP_TWO_ISOLATED_NATIVE_PRODUCTS_INSTALLED_PASS'
    # A background executable is product-owned even when it is not the
    # primary entrypoint. Repair must refuse rather than rename the tree.
    $worker=Start-Process -FilePath (Join-Path $a.program 'tools\worker.exe') `
        -ArgumentList '--hold' -PassThru -WindowStyle Hidden
    try {
        Start-Sleep -Milliseconds 350
        $worker.Refresh()
        if($worker.HasExited){throw 'SETUP_NEUTRAL_CHILD_PROCESS_NOT_RUNNING'}
        $blocked=Invoke-Setup $a.bundle @('--repair-file') 2
        if($blocked.status -ne 'ERROR' -or
           $blocked.reason -notmatch 'SETUP_APP_STILL_RUNNING'){
            throw 'SETUP_NEUTRAL_ACTIVE_HELPER_REPAIR_NOT_BLOCKED'
        }
        $still=Invoke-Setup $a.bundle @('--verify-installed-file')
        if($still.status -ne 'OWNED_FILES_VERIFIED'){
            throw 'SETUP_NEUTRAL_REPAIR_REFUSAL_CHANGED_INSTALLATION'
        }
    }finally{
        $worker.Refresh()
        if(!$worker.HasExited){
            Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
        }
        $worker.Dispose()
    }
    Write-Host 'IWXA_SETUP_OWNED_CHILD_PROCESS_REPAIR_BLOCKED_PASS'
    $removed=Invoke-Setup $a.bundle @('--uninstall-file')
    if($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
        (Test-Path -LiteralPath (Join-Path $a.program 'bin\fixture.exe')) -or
        !(Test-Path -LiteralPath (Join-Path $a.data 'userdata.txt'))){
        throw 'SETUP_NEUTRAL_UNINSTALL_REMOVED_USER_DATA'
    }
    $bVerify=Invoke-Setup $b.bundle @('--verify-installed-file')
    if($bVerify.status -ne 'OWNED_FILES_VERIFIED' -or !(Test-Path -LiteralPath $b.key)){
        throw 'SETUP_NEUTRAL_CROSS_PRODUCT_OWNERSHIP_BROKEN'
    }
    $removedB=Invoke-Setup $b.bundle @('--uninstall-file')
    if($removedB.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
        !(Test-Path -LiteralPath (Join-Path $b.data 'userdata.txt'))){
        throw 'SETUP_NEUTRAL_SECOND_UNINSTALL_INVALID'
    }
    Write-Host 'IWXA_SETUP_CROSS_PRODUCT_UNINSTALL_AND_DATA_PRESERVATION_PASS'
    # Synthetic nested desktop executable with spaces in its file name.
    $nested=Make-Product ('n'+[Guid]::NewGuid().ToString('N').Substring(0,10)) -NestedEntrypoint
    $nestedIdentity=Invoke-Setup $nested.bundle @('--inspect-file')
    if($nestedIdentity.entrypoint -ne 'desktop/bin/Sample Window.exe'){
        throw 'SETUP_NEUTRAL_SPACED_ENTRYPOINT_IDENTITY_FAILED'
    }
    $nestedInstalled=Invoke-Setup $nested.bundle @('--install-locations-file',('"' + $nested.request + '"'))
    if($nestedInstalled.status -ne 'INSTALLED_NOT_LAUNCHED' -or
       !(Test-Path -LiteralPath (Join-Path $nested.program 'desktop\bin\Sample Window.exe') -PathType Leaf)){
        throw 'SETUP_NEUTRAL_SPACED_ENTRYPOINT_INSTALL_FAILED'
    }
    $nestedVerified=Invoke-Setup $nested.bundle @('--verify-installed-file')
    if($nestedVerified.status -ne 'OWNED_FILES_VERIFIED'){
        throw 'SETUP_NEUTRAL_SPACED_ENTRYPOINT_VERIFY_FAILED'
    }
    # A real GUI can produce a WebView2 cache. The native repair engine
    # must not modify or erase it, but must report its type safely.
    $cacheRoot=Join-Path $nested.program 'desktop\bin\Sample Window.exe.WebView2\EBWebView\Cache'
    New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
    [IO.File]::WriteAllText((Join-Path $cacheRoot 'synthetic-cache.bin'),'public-fixture')
    $unknown=Invoke-Setup $nested.bundle @('--repair-file') 2
    if($unknown.status -ne 'ERROR' -or $unknown.reason -ne 'SETUP_UNOWNED_FILE_PRESENT' -or
       $unknown.unownedCategory -ne 'WEBVIEW2_PROFILE'){
        throw 'SETUP_NEUTRAL_WEBVIEW2_UNOWNED_CLASS_INVALID'
    }
    Remove-Item -LiteralPath (Join-Path $nested.program 'desktop\bin\Sample Window.exe.WebView2') -Recurse -Force
    $nestedReverified=Invoke-Setup $nested.bundle @('--verify-installed-file')
    if($nestedReverified.status -ne 'OWNED_FILES_VERIFIED'){
        throw 'SETUP_NEUTRAL_WEBVIEW2_REFUSAL_MUTATED_INSTALL'
    }
    Write-Host 'IWXA_SETUP_UNOWNED_WEBVIEW2_FAIL_CLOSED_CLASS_PASS'
    $nestedRemoved=Invoke-Setup $nested.bundle @('--uninstall-file')
    if($nestedRemoved.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
       (Test-Path -LiteralPath $nested.program)){
        throw 'SETUP_NEUTRAL_SPACED_ENTRYPOINT_UNINSTALL_FAILED'
    }
    Write-Host 'IWXA_SETUP_SYNTHETIC_NESTED_SPACED_ENTRYPOINT_PASS'
    # Reproduce Agent qualification's redirected, not-yet-initialized user
    # profile. The same owner installer must install and remove a nested GUI.
    $isolated=Make-Product ('p'+[Guid]::NewGuid().ToString('N').Substring(0,10)) -NestedEntrypoint
    $isolatedHome=Join-Path $root 'qa-isolated-profile'
    $override=[ordered]@{
        USERPROFILE=(Join-Path $isolatedHome 'Home')
        APPDATA=(Join-Path $isolatedHome 'Home\AppData\Roaming')
        LOCALAPPDATA=(Join-Path $isolatedHome 'Home\AppData\Local')
        TEMP=(Join-Path $isolatedHome 'Temp')
        TMP=(Join-Path $isolatedHome 'Temp')
    }
    $oldEnv=@{}
    try {
        foreach($envKey in $override.Keys){
            $oldEnv[$envKey]=[Environment]::GetEnvironmentVariable($envKey,'Process')
            New-Item -ItemType Directory -Path $override[$envKey] -Force | Out-Null
            [Environment]::SetEnvironmentVariable($envKey,$override[$envKey],'Process')
        }
        $isolatedInstall=Invoke-Setup $isolated.bundle @('--install-locations-file',('"' + $isolated.request + '"'))
        if($isolatedInstall.status -ne 'INSTALLED_NOT_LAUNCHED' -or
           !(Test-Path -LiteralPath (Join-Path $isolated.program 'desktop\bin\Sample Window.exe') -PathType Leaf)){
            throw 'SETUP_NEUTRAL_ISOLATED_PROFILE_INSTALL_FAILED'
        }
        $isolatedVerified=Invoke-Setup $isolated.bundle @('--verify-installed-file')
        if($isolatedVerified.status -ne 'OWNED_FILES_VERIFIED'){
            throw 'SETUP_NEUTRAL_ISOLATED_PROFILE_VERIFY_FAILED'
        }
        $isolatedRemoved=Invoke-Setup $isolated.bundle @('--uninstall-file')
        if($isolatedRemoved.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
           (Test-Path -LiteralPath $isolated.program)){
            throw 'SETUP_NEUTRAL_ISOLATED_PROFILE_UNINSTALL_FAILED'
        }
    } finally {
        foreach($envKey in $override.Keys){
            [Environment]::SetEnvironmentVariable($envKey,$oldEnv[$envKey],'Process')
        }
    }
    Write-Host 'IWXA_SETUP_SYNTHETIC_ISOLATED_PROFILE_SHORTCUT_PASS'
    # A denied synthetic locations request must publish only bounded native
    # failure metadata, without disclosing the requested path or exception.
    $deniedLocations=Join-Path $root 'denied-locations.json'
    $deniedRequest=Get-Content -LiteralPath $a.request -Raw -Encoding UTF8 | ConvertFrom-Json
    $deniedRequest.programRoot=[IO.Path]::GetPathRoot($a.program)
    $deniedRequest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $deniedLocations -Encoding UTF8
    $failedInstall=Invoke-Setup $a.bundle @('--install-locations-file',('"' + $deniedLocations + '"')) 2
    if($failedInstall.status -ne 'ERROR' -or
       $failedInstall.exceptionClass -ne 'INVALID_OPERATION' -or
       $failedInstall.installPhase -ne 'REQUEST_OR_PREFLIGHT' -or
       (Test-Path -LiteralPath $a.key)){
        throw 'SETUP_NEUTRAL_INSTALL_DIAGNOSTIC_OR_NO_EFFECT_INVALID'
    }
    Write-Host 'IWXA_SETUP_NATIVE_INSTALL_DIAGNOSTIC_ALLOWLIST_PASS'
    # Large real products contain deep Python dependency paths. Test the
    # original Setup Core installer with synthetic data at the same depth.
    $long=Make-Product ('l'+[Guid]::NewGuid().ToString('N').Substring(0,10)) -LongPaths
    $longInspect=Invoke-Setup $long.bundle @('--inspect-file')
    if($longInspect.status -ne 'VERIFIED' -or $longInspect.product -ne $long.id){
        throw 'SETUP_NEUTRAL_LONG_PATH_BUNDLE_INSPECTION_FAILED'
    }
    $longInstall=Invoke-Setup $long.bundle @('--install-locations-file',('"' + $long.request + '"'))
    if($longInstall.status -ne 'INSTALLED_NOT_LAUNCHED'){
        throw 'SETUP_NEUTRAL_LONG_PATH_INSTALL_FAILED'
    }
    $longVerify=Invoke-Setup $long.bundle @('--verify-installed-file')
    if($longVerify.status -ne 'OWNED_FILES_VERIFIED'){
        throw 'SETUP_NEUTRAL_LONG_PATH_VERIFY_FAILED'
    }
    New-Item -ItemType Directory -Path $long.data -Force | Out-Null
    $longMarker=Join-Path $long.data 'preserved.txt'
    [IO.File]::WriteAllText($longMarker,'synthetic-user-owned')
    # Upgrade/Repair stages must handle the same deep paths as first install.
    $deepRepaired=Invoke-Setup $long.bundle @('--repair-file')
    if($deepRepaired.status -ne 'REPAIRED_BACKUP_RETAINED'){
        throw 'SETUP_NEUTRAL_LONG_PATH_REPAIR_FAILED'
    }
    $deepVerifyRepair=Invoke-Setup $long.bundle @('--verify-installed-file')
    if($deepVerifyRepair.status -ne 'OWNED_FILES_VERIFIED'){
        throw 'SETUP_NEUTRAL_LONG_PATH_REPAIRED_IDENTITY_FAILED'
    }
    $deepRolledBack=Invoke-Setup $long.bundle @('--rollback-upgrade-file')
    if($deepRolledBack.status -ne 'ROLLBACK_RESTORED_PREVIOUS' -or
       (Test-Path -LiteralPath ($long.program+'.iwxa-previous'))){
        throw 'SETUP_NEUTRAL_LONG_PATH_ROLLBACK_FAILED'
    }
    $deepVerifyRollback=Invoke-Setup $long.bundle @('--verify-installed-file')
    if($deepVerifyRollback.status -ne 'OWNED_FILES_VERIFIED' -or
       [IO.File]::ReadAllText($longMarker) -ne 'synthetic-user-owned'){
        throw 'SETUP_NEUTRAL_LONG_PATH_ROLLBACK_DATA_OR_IDENTITY_CHANGED'
    }
    # Different-version migration on the SAME native product identity.
    # Only synthetic bytes: version 1.0.0 -> 1.0.1 -> rollback to 1.0.0.
    $previousFixture=[IO.File]::ReadAllText((Join-Path $long.program 'assets\fixture.txt'))
    $versionTwo=Make-Product ('u'+[Guid]::NewGuid().ToString('N').Substring(0,10)) -LongPaths -ProductId $long.id -ProductVersion '1.0.1'
    if($versionTwo.id -cne $long.id){throw 'SETUP_NEUTRAL_VERSIONED_IDENTITY_INVALID'}
    $upgraded=Invoke-Setup $versionTwo.bundle @('--upgrade-file')
    if($upgraded.status -ne 'UPGRADED_BACKUP_RETAINED' -or
       $upgraded.version -ne '1.0.1'){
        throw 'SETUP_NEUTRAL_LONG_PATH_VERSION_UPGRADE_FAILED'
    }
    $v2Identity=Invoke-Setup $versionTwo.bundle @('--verify-installed-file')
    $newFixture=[IO.File]::ReadAllText((Join-Path $long.program 'assets\fixture.txt'))
    if($v2Identity.status -ne 'OWNED_FILES_VERIFIED' -or
       $newFixture -ceq $previousFixture -or
       [IO.File]::ReadAllText($longMarker) -ne 'synthetic-user-owned'){
        throw 'SETUP_NEUTRAL_LONG_PATH_VERSION_UPGRADE_IDENTITY_INVALID'
    }
    $returned=Invoke-Setup $versionTwo.bundle @('--rollback-upgrade-file')
    if($returned.status -ne 'ROLLBACK_RESTORED_PREVIOUS'){
        throw 'SETUP_NEUTRAL_LONG_PATH_VERSION_ROLLBACK_FAILED'
    }
    $v1Identity=Invoke-Setup $long.bundle @('--verify-installed-file')
    if($v1Identity.status -ne 'OWNED_FILES_VERIFIED' -or
       [IO.File]::ReadAllText((Join-Path $long.program 'assets\fixture.txt')) -cne $previousFixture -or
       [IO.File]::ReadAllText($longMarker) -ne 'synthetic-user-owned'){
        throw 'SETUP_NEUTRAL_LONG_PATH_VERSION_ROLLBACK_IDENTITY_INVALID'
    }
    Write-Host 'IWXA_SETUP_SYNTHETIC_LONG_PATH_VERSION_UPGRADE_ROLLBACK_PASS'
    $longRemoved=Invoke-Setup $long.bundle @('--uninstall-file')
    if($longRemoved.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
       (Test-Path -LiteralPath $long.program) -or
       [IO.File]::ReadAllText($longMarker) -ne 'synthetic-user-owned'){
        throw 'SETUP_NEUTRAL_LONG_PATH_UNINSTALL_OR_DATA_LOSS'
    }
    Write-Host 'IWXA_SETUP_SYNTHETIC_LONG_PATH_LIFECYCLE_PASS'
    # The external-bundle acceptance is exercised here with the same
    # disposable synthetic program, never with a confidential payload.
    $c=Make-Product ('c'+[Guid]::NewGuid().ToString('N').Substring(0,10))
    & (Join-Path $PSScriptRoot 'qualify-local-bundle.ps1') -Setup $c.bundle `
        -ProductId $c.id -SandboxRoot (Join-Path $root 'independent-acceptance') `
        -WitnessScript (Join-Path $PSScriptRoot 'qualify-fixture-runtime.ps1')
    if(!(Test-Path -LiteralPath (Join-Path $root 'independent-acceptance\installed-witness.json'))){
        throw 'SETUP_NEUTRAL_WITNESS_READBACK_NOT_WRITTEN'
    }
    Write-Host 'IWXA_SETUP_LOCAL_BUNDLE_HARNESS_PASS'
    $negative=Make-Product ('d'+[Guid]::NewGuid().ToString('N').Substring(0,10))
    $denied=$false
    try {
        & (Join-Path $PSScriptRoot 'qualify-local-bundle.ps1') `
            -Setup $negative.bundle `
            -ProductId 'iwxa.fixture.unrelated' `
            -SandboxRoot (Join-Path $root 'rejected-identity')
    } catch {
        $denied=$true
        if($_.Exception.Message -notmatch 'SETUP_LOCAL_PRODUCT_IDENTITY_INVALID'){
            throw
        }
    }
    if(!$denied -or (Test-Path -LiteralPath $negative.key) -or
        (Test-Path -LiteralPath $negative.program)){
        throw 'SETUP_NEUTRAL_REJECTED_IDENTITY_HAD_EFFECTS'
    }
    Write-Host 'IWXA_SETUP_LOCAL_PRODUCT_IDENTITY_FAIL_CLOSED_PASS'
} finally {
    foreach($item in $created){
        if(Test-Path -LiteralPath $item.key){
            try{$null=Invoke-Setup $item.bundle @('--uninstall-file')}catch{
                Write-Warning ('SETUP_NEUTRAL_CLEANUP '+$_.Exception.Message)
            }
        }
    }
    if(Test-Path -LiteralPath $root){
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}
