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
internal static class FixtureProgram {
    [STAThread]
    private static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--probe") return 0;
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
            throw ('SETUP_NEUTRAL_EXIT actual='+$process.ExitCode+
                ' expected='+$expected+' args='+($arguments -join ','))
        }
    }finally{$process.Dispose()}
    if(!(Test-Path -LiteralPath $output -PathType Leaf)){
        throw 'SETUP_NEUTRAL_RECEIPT_MISSING'
    }
    return (Get-Content -LiteralPath $output -Raw | ConvertFrom-Json)
}
function Make-Product([string]$tag) {
    $id='iwxa.fixture.'+$tag
    $folder=Join-Path $root $tag
    $payload=Join-Path $folder 'payload'
    $exe=Join-Path $payload 'bin\fixture.exe'
    New-Item -ItemType Directory -Path (Split-Path -Parent $exe) -Force | Out-Null
    $src=Join-Path $folder 'fixture.cs'
    [IO.File]::WriteAllText($src,$source,[Text.Encoding]::ASCII)
    & $csc /nologo /target:winexe /platform:anycpu /optimize+ ("/out:"+$exe) $src
    if($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $exe -PathType Leaf)){
        throw 'SETUP_NEUTRAL_FIXTURE_COMPILE_FAILED'
    }
    New-Item -ItemType Directory -Path (Join-Path $payload 'assets') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $payload 'assets\fixture.txt'),('fixture-'+$tag))
    $manifest=Join-Path $folder 'product.json'
    [ordered]@{
        schema='IWXA_SETUP_PRODUCT/1';id=$id;display_name=('IWXA Test '+$tag)
        publisher='IWXA';version=$version;architecture='windows-x64'
        install_dir=('IWXA Test '+$tag)
        entrypoint='bin/fixture.exe';data_namespace=('iwxa.fixture.'+$tag)
        requirements=@()
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding UTF8
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
