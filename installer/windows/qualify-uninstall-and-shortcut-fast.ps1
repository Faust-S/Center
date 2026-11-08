# Fast Windows native test: uses the real Setup Core with a tiny fixture.
[CmdletBinding()]
param([string]$Stub = 'artifacts/iwxa-setup-core-early.exe')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $repo
try {
    $stubPath=[IO.Path]::GetFullPath($Stub)
    if(!(Test-Path -LiteralPath $stubPath -PathType Leaf)){throw 'SETUP_FAST_STUB_MISSING'}
    $work=Join-Path $env:RUNNER_TEMP 'iwxa-setup-fast-native'
    if(Test-Path -LiteralPath $work){throw 'SETUP_FAST_WORKDIR_NOT_CLEAN'}
    New-Item -Path $work -ItemType Directory -Force|Out-Null
    $profilePath=Join-Path $work 'product.json'
    $payload=Join-Path $work 'payload'
    $bundle=Join-Path $work 'setup.exe'
    $appName='iwxa-fixture.exe'
    $id='iwxa.setup.fastfixture'
    $dirName='IWXA Setup Fast Fixture'
    $root=Join-Path $env:LOCALAPPDATA ('Programs/' + $dirName)
    $link=Join-Path ([Environment]::GetFolderPath('Programs')) ($dirName+'.lnk')
    $userData=Join-Path $env:LOCALAPPDATA 'iwxa.setup.fastfixture/keep.txt'
    $owner='HKCU:\Software\IWXA\SetupCore\Products\'+$id
    $uninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\IWXA.SetupCore.'+$id
    $foreign=Join-Path $env:WINDIR 'System32/notepad.exe'
    if((Test-Path -LiteralPath $root) -or (Test-Path -LiteralPath $link) -or
       (Test-Path -LiteralPath $owner) -or (Test-Path -LiteralPath $userData)){
        throw 'SETUP_FAST_FIXTURE_NOT_CLEAN'
    }
    $profile=@{
        schema='IWXA_SETUP_PRODUCT/1';id=$id
        display_name='IWXA Setup Fast Fixture';publisher='IWXA'
        version='0.3.0-dev.1';architecture='windows-x64'
        install_dir=$dirName;entrypoint=$appName
        data_namespace='iwxa.setup.fastfixture';requirements=@()
    }
    $profile|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $profilePath -Encoding UTF8
    New-Item -Path $payload -ItemType Directory|Out-Null
    Copy-Item -LiteralPath $stubPath -Destination (Join-Path $payload $appName)
    New-Item -Path (Join-Path $payload 'assets') -ItemType Directory|Out-Null
    [IO.File]::WriteAllText((Join-Path $payload 'assets/owned.txt'),'fixture')
    $head=[string]$env:GITHUB_SHA
    $tree=[string](& git rev-parse 'HEAD^{tree}').Trim()
    if($head -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$'){
        throw 'SETUP_FAST_SOURCE_IDENTITY_INVALID'
    }
    $argsBuild=@('-m','installer.build_bundle','build-resource',
        '--product',$profilePath,'--payload',$payload,'--stub',$stubPath,
        '--output',$bundle,'--source-commit',$head,'--source-tree',$tree)
    $built=& python @argsBuild
    if($LASTEXITCODE -ne 0){throw 'SETUP_FAST_BUILD_FAILED'}
    if((($built|Out-String)|ConvertFrom-Json).format -ne 'PE_RESOURCE_V2'){
        throw 'SETUP_FAST_NOT_V2'
    }
    function Invoke-Setup([string]$mode,[string]$tag,[int]$expected=0){
        $report=Join-Path $work ($tag+'.json')
        if(Test-Path -LiteralPath $report){Remove-Item -LiteralPath $report -Force}
        $p=Start-Process -FilePath $bundle -ArgumentList ('{0} "{1}"' -f $mode,$report) -PassThru
        try{
            if(!$p.WaitForExit(60000)){
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                throw ('SETUP_FAST_TIMEOUT_'+$tag)
            }
            if($p.ExitCode -ne $expected){throw ('SETUP_FAST_EXIT_'+$tag+'_'+$p.ExitCode)}
        }finally{$p.Dispose()}
        if(!(Test-Path -LiteralPath $report)){throw ('SETUP_FAST_REPORT_MISSING_'+$tag)}
        return Get-Content -LiteralPath $report -Raw|ConvertFrom-Json
    }
    $verified=Invoke-Setup '--inspect-file' 'identity'
    if($verified.status -ne 'VERIFIED' -or $verified.product -ne $id -or
       $verified.packageFormat -ne 'PE_RESOURCE_V2' -or $verified.requiresWebView2){
        throw 'SETUP_FAST_IDENTITY_INVALID'
    }
    $shell=New-Object -ComObject WScript.Shell
    try{
        $foreignLink=$shell.CreateShortcut($link)
        $foreignLink.TargetPath=$foreign
        $foreignLink.Description='Foreign test shortcut'
        $foreignLink.Save()
        $hash=(Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
        $pre=Invoke-Setup '--preflight-file' 'preflight-foreign'
        $blocked=Invoke-Setup '--install-file' 'install-foreign' 2
        if($pre.status -ne 'START_MENU_SHORTCUT_CONFLICT' -or
           $blocked.status -ne 'ERROR' -or
           $blocked.reason -ne 'SETUP_BLOCKED_START_MENU_SHORTCUT_CONFLICT' -or
           (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash -ne $hash -or
           (Test-Path -LiteralPath $root) -or (Test-Path -LiteralPath $owner)){
            throw 'SETUP_FAST_FOREIGN_SHORTCUT_NOT_PRESERVED'
        }
        Write-Host 'IWXA_SETUP_FAST_FOREIGN_SHORTCUT_PASS'
        Remove-Item -LiteralPath $link -Force
        $installed=Invoke-Setup '--install-file' 'first-install'
        if($installed.status -ne 'INSTALLED_NOT_LAUNCHED' -or
           !(Test-Path -LiteralPath $root) -or
           !(Test-Path -LiteralPath $owner) -or
           !(Test-Path -LiteralPath $uninstallKey) -or
           !(Test-Path -LiteralPath $link)){
            throw 'SETUP_FAST_FIRST_INSTALL_INVALID'
        }
        New-Item -Path (Split-Path -Parent $userData) -ItemType Directory -Force|Out-Null
        [IO.File]::WriteAllText($userData,'outside-user-data')
        $app=Join-Path $root $appName
        $receipt=Join-Path $root '.iwxa-setup-ownership.json'
        $uninstaller=Join-Path $root 'IWXA.SetupCore.Uninstall.exe'
        $appHash=(Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash
        $uninstallerHash=(Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash
        $originalFlags=[IO.File]::GetAttributes($uninstaller)
        try{
            [IO.File]::SetAttributes($uninstaller,
                ($originalFlags -bor [IO.FileAttributes]::ReadOnly))
            $denied=Invoke-Setup '--uninstall-file' 'readonly-refusal' 2
            if($denied.status -ne 'ERROR' -or
               $denied.reason -ne 'SETUP_UNINSTALL_READONLY_FILE' -or
               !(Test-Path -LiteralPath $receipt) -or
               !(Test-Path -LiteralPath $owner) -or
               (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne $appHash -or
               (Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash -ne $uninstallerHash){
                throw 'SETUP_FAST_PARTIAL_UNINSTALL'
            }
        }finally{
            if(Test-Path -LiteralPath $uninstaller){
                [IO.File]::SetAttributes($uninstaller,$originalFlags)
            }
        }
        Write-Host 'IWXA_SETUP_FAST_READONLY_UNINSTALL_REFUSED_PASS'
        $modified=$shell.CreateShortcut($link)
        $modified.TargetPath=$foreign
        $modified.Description='User-modified shortcut'
        $modified.Save()
        $modifiedHash=(Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
        $removed=Invoke-Setup '--uninstall-file' 'normal-uninstall'
        if($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
           (Test-Path -LiteralPath $root) -or
           (Test-Path -LiteralPath $owner) -or
           (Test-Path -LiteralPath $uninstallKey) -or
           !(Test-Path -LiteralPath $link) -or
           (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash -ne $modifiedHash -or
           [IO.File]::ReadAllText($userData) -ne 'outside-user-data'){
            throw 'SETUP_FAST_USER_FILES_OR_SHORTCUT_NOT_PRESERVED'
        }
        Write-Host 'IWXA_SETUP_FAST_UNINSTALL_PRESERVED_USER_SHORTCUT_PASS'
    }finally{
        if(Test-Path -LiteralPath $link){Remove-Item -LiteralPath $link -Force}
        if(Test-Path -LiteralPath $userData){Remove-Item -LiteralPath $userData -Force}
    }
}finally{Pop-Location}
