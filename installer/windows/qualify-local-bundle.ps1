# Local Windows acceptance for a caller-supplied native Setup Core bundle.
# This script never fetches or uploads the executable, product source or user data.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Setup,
    [Parameter(Mandatory=$true)][string]$ProductId,
    [Parameter(Mandatory=$true)][string]$SandboxRoot,
    [string]$SourceCommit='',
    [string]$WitnessScript=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'SETUP_LOCAL_WINDOWS_REQUIRED'}
if($ProductId -notmatch '^[a-z][a-z0-9.-]{2,63}$'){
    throw 'SETUP_LOCAL_PRODUCT_ID_INVALID'
}
if($SourceCommit -and $SourceCommit -cnotmatch '^[0-9a-f]{40}$'){
    throw 'SETUP_LOCAL_SOURCE_SHA_INVALID'
}
$setupPath=[IO.Path]::GetFullPath($Setup)
if(!(Test-Path -LiteralPath $setupPath -PathType Leaf)){
    throw 'SETUP_LOCAL_PACKAGE_MISSING'
}
$work=[IO.Path]::GetFullPath($SandboxRoot)
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if($work -eq $repo -or $work.StartsWith($repo+'\',[StringComparison]::OrdinalIgnoreCase)){
    throw 'SETUP_LOCAL_SANDBOX_CANNOT_BE_IN_SOURCE_TREE'
}
if($work -eq [IO.Path]::GetPathRoot($work)){
    throw 'SETUP_LOCAL_SANDBOX_CANNOT_BE_VOLUME_ROOT'
}
if(Test-Path -LiteralPath $work){
    throw 'SETUP_LOCAL_SANDBOX_MUST_NOT_EXIST'
}
$owner=('HKCU:\Software\IWXA\SetupCore\Products\'+$ProductId)
if(Test-Path -LiteralPath $owner){
    throw 'SETUP_LOCAL_EXISTING_PRODUCT_MUST_NOT_BE_REPLACED'
}
$application=Join-Path $work 'application'
$data=Join-Path $work 'data'
$software=Join-Path $work 'software'
$models=Join-Path $work 'models'
$cache=Join-Path $work 'cache'
$guard=Join-Path $data 'uninstall-preservation.fixture'
$sourceName=Join-Path $work 'locations.json'
$started=$false
$installed=$false
function InvokeNative([string]$mode,[string]$output,[string]$request=''){
    if($request){
        $arg=('{0} "{1}" "{2}"' -f $mode,$request,$output)
    }else{
        $arg=('{0} "{1}"' -f $mode,$output)
    }
    $process=Start-Process -FilePath $setupPath -ArgumentList $arg -PassThru -WindowStyle Hidden
    try{
        if(!$process.WaitForExit(180000)){
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            throw 'SETUP_LOCAL_OPERATION_TIMEOUT'
        }
        if($process.ExitCode -ne 0){
            $reason=''
            if(Test-Path -LiteralPath $output -PathType Leaf){
                try{$reason=[string](Get-Content -LiteralPath $output -Raw|ConvertFrom-Json).reason}catch{}
            }
            throw ('SETUP_LOCAL_NATIVE_FAILED_'+$mode+'_'+$reason)
        }
    }finally{$process.Dispose()}
    if(!(Test-Path -LiteralPath $output -PathType Leaf)){
        throw ('SETUP_LOCAL_NATIVE_RECEIPT_MISSING_'+$mode)
    }
    return Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
}
try{
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $identity=InvokeNative '--inspect-file' (Join-Path $work 'identity.json')
    if($identity.status -ne 'VERIFIED' -or $identity.product -cne $ProductId -or
       $identity.packageFormat -ne 'PE_RESOURCE_V2'){
        throw 'SETUP_LOCAL_PRODUCT_IDENTITY_INVALID'
    }
    if($SourceCommit -and $identity.sourceCommit -cne $SourceCommit){
        throw 'SETUP_LOCAL_SOURCE_IDENTITY_INVALID'
    }
    $pre=InvokeNative '--preflight-file' (Join-Path $work 'preflight.json')
    if($pre.status -ne 'READY_FOR_FIRST_INSTALL'){
        throw ('SETUP_LOCAL_HOST_NOT_READY_'+$pre.status)
    }
    [ordered]@{
        schema='IWXA_SETUP_LOCATIONS/1'
        programRoot=$application
        dataRoot=$data
        softwareRoot=$software
        modelsRoot=$models
        cacheRoot=$cache
        startWithWindows=$false
    }|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $sourceName -Encoding UTF8
    $started=$true
    $result=InvokeNative '--install-locations-file' (Join-Path $work 'installed.json') $sourceName
    if($result.status -ne 'INSTALLED_NOT_LAUNCHED' -or
       $result.product -ne $ProductId -or
       !(Test-Path -LiteralPath $application -PathType Container)){
        throw 'SETUP_LOCAL_ACTIVATION_INVALID'
    }
    $installed=$true
    $verified=InvokeNative '--verify-installed-file' (Join-Path $work 'verified.json')
    if($verified.status -ne 'OWNED_FILES_VERIFIED' -or $verified.product -ne $ProductId){
        throw 'SETUP_LOCAL_ON_DISK_IDENTITY_INVALID'
    }
    $locations=InvokeNative '--locations-file' (Join-Path $work 'locations-readback.json')
    if($locations.status -ne 'LOCATIONS_VERIFIED' -or
       $locations.programRoot -cne $application -or
       $locations.dataRoot -cne $data -or
       $locations.softwareRoot -cne $software -or
       $locations.modelsRoot -cne $models -or
       $locations.cacheRoot -cne $cache){
        throw 'SETUP_LOCAL_LOCATION_READBACK_INVALID'
    }
    if($WitnessScript){
        $scriptPath=[IO.Path]::GetFullPath($WitnessScript)
        if(!(Test-Path -LiteralPath $scriptPath -PathType Leaf)){
            throw 'SETUP_LOCAL_WITNESS_FILE_MISSING'
        }
        $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $witnessReceipt=Join-Path $work 'installed-witness.json'
        $arguments=('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -ProgramRoot "{1}" -DataRoot "{2}" -SandboxRoot "{3}" -ResultPath "{4}"' -f
            $scriptPath,$application,$data,$work,$witnessReceipt)
        $witness=Start-Process -FilePath $powershell -ArgumentList $arguments -PassThru -WindowStyle Hidden
        try{
            if(!$witness.WaitForExit(180000)){
                Stop-Process -Id $witness.Id -Force -ErrorAction SilentlyContinue
                throw 'SETUP_LOCAL_WITNESS_TIMEOUT'
            }
            if($witness.ExitCode -ne 0){
                throw 'SETUP_LOCAL_WITNESS_EXIT_FAILED'
            }
        }finally{$witness.Dispose()}
        if(!(Test-Path -LiteralPath $witnessReceipt -PathType Leaf)){
            throw 'SETUP_LOCAL_WITNESS_RECEIPT_MISSING'
        }
        $witnessResult=Get-Content -LiteralPath $witnessReceipt -Raw|ConvertFrom-Json
        if($witnessResult.status -ne 'PASS'){
            throw 'SETUP_LOCAL_WITNESS_READBACK_INVALID'
        }
        Write-Host 'IWXA_SETUP_LOCAL_RUNTIME_WITNESS_PASS'
    }
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $marker='fixture-'+[Guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($guard,$marker)
    $repair=InvokeNative '--repair-file' (Join-Path $work 'repair.json')
    if($repair.status -ne 'REPAIRED_BACKUP_RETAINED' -or
       $repair.product -cne $ProductId){
        throw 'SETUP_LOCAL_REPAIR_NOT_ACTIVATED'
    }
    $verifiedRepair=InvokeNative '--verify-installed-file' (Join-Path $work 'verified-after-repair.json')
    if($verifiedRepair.status -ne 'OWNED_FILES_VERIFIED'){
        throw 'SETUP_LOCAL_REPAIR_READBACK_INVALID'
    }
    $confirmed=InvokeNative '--confirm-upgrade-file' (Join-Path $work 'confirmed.json')
    if($confirmed.status -ne 'UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED' -or
       !(Test-Path -LiteralPath $guard -PathType Leaf) -or
       [IO.File]::ReadAllText($guard) -ne $marker){
        throw 'SETUP_LOCAL_REPAIR_CONFIRM_OR_USER_DATA_LOST'
    }
    Write-Host 'IWXA_SETUP_LOCAL_REPAIR_AND_CONFIRM_PASS'
    $removed=InvokeNative '--uninstall-file' (Join-Path $work 'removed.json')
    if($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
       (Test-Path -LiteralPath $owner) -or
       !(Test-Path -LiteralPath $guard -PathType Leaf) -or
       [IO.File]::ReadAllText($guard) -ne $marker){
        throw 'SETUP_LOCAL_UNINSTALL_OR_DATA_LOSS'
    }
    $installed=$false
    Write-Host 'IWXA_SETUP_LOCAL_NATIVE_INSTALL_AND_PRESERVE_PASS'
} finally {
    # Do not erase arbitrary files after a failed or partial install.
    if($started -and $installed -and (Test-Path -LiteralPath $owner)){
        Write-Warning 'SETUP_LOCAL_OWNED_INSTALLATION_REQUIRES_INSPECTION'
    }
    # Keep this sandbox and all receipts local for inspection by the operator.
    # Nothing from this directory is committed or uploaded.
}
