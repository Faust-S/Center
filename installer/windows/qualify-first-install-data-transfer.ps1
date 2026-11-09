# Exercise the real Windows Setup engine for first-install storage choices.
# This uses the packaged native EXE; no mock installer or copied runtime.
[CmdletBinding()]
param([string]$Bundle='artifacts/iwxa-setup-core-center-0.3-preview.exe')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$bundlePath=[IO.Path]::GetFullPath($Bundle)
if(!(Test-Path -LiteralPath $bundlePath -PathType Leaf)){
    throw 'FIRST_INSTALL_PACKAGE_MISSING'
}
$assembly=[Reflection.Assembly]::LoadFrom($bundlePath)
$flags=[Reflection.BindingFlags]'Static,NonPublic,Public'
$instanceFlags=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$engine=$assembly.GetType('IwxaSetup.SetupInstallation',$true)
$reader=$assembly.GetType('IwxaSetup.BundleReader',$true)
$locationType=$assembly.GetType('IwxaSetup.SetupLocations',$true)
$readiness=$assembly.GetType('IwxaSetup.SetupReadiness',$true)
$inspect=$reader.GetMethod('Inspect',$flags)
$bundleInfo=$inspect.Invoke($null,[object[]]@($bundlePath))
$defaultMethod=$engine.GetMethod('DefaultLocations',$flags)
$default=$defaultMethod.Invoke($null,[object[]]@($bundleInfo))
$source=[string]$locationType.GetField('DataRoot',$instanceFlags).GetValue($default)
$preflight=$readiness.GetMethod('Check',$flags)
$importMethod=$engine.GetMethod('InstallFreshWithExistingData',$flags)
$ownerKey='HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center'
$fixtureBase=Join-Path $env:LOCALAPPDATA ('IWXA First Install Route '+[Guid]::NewGuid().ToString('N'))
$programRoot=Join-Path $fixtureBase 'Application'
$dataRoot=Join-Path $fixtureBase 'Personal Data'
$otherRoot=Join-Path $fixtureBase 'Software'
$modelRoot=Join-Path $fixtureBase 'Models'
$cacheRoot=Join-Path $fixtureBase 'Cache'
$otherProgram=Join-Path $fixtureBase 'Application Second'
$otherData=Join-Path $fixtureBase 'Personal Data Second'
$sourceFile=Join-Path $source ('iwxa-first-import-'+[Guid]::NewGuid().ToString('N')+'.txt')
$sourceBytes=[Text.Encoding]::UTF8.GetBytes('IWXA SOURCE PRESERVED '+[Guid]::NewGuid().ToString('N'))
$ownerCreated=$false
function SetField([object]$object,[string]$field,[object]$value){
    $locationType.GetField($field,$instanceFlags).SetValue($object,$value)
}
function GetField([object]$object,[string]$field){
    return $object.GetType().GetField($field,$instanceFlags).GetValue($object)
}
function MakeChoice([string]$application,[string]$data){
    $chosen=[Activator]::CreateInstance($locationType,$true)
    SetField $chosen 'ProgramRoot' $application
    SetField $chosen 'DataRoot' $data
    SetField $chosen 'SoftwareRoot' $otherRoot
    SetField $chosen 'ModelsRoot' $modelRoot
    SetField $chosen 'CacheRoot' $cacheRoot
    SetField $chosen 'StartWithWindows' $false
    return $chosen
}
function InspectRoot([string]$root){
    return [string](GetField ($preflight.Invoke($null,[object[]]@($bundleInfo,$root))) 'Status')
}
function InvokeInstallWithImport([object]$locations,[Threading.CancellationToken]$token){
    $a=New-Object 'System.Object[]' 4
    $a[0]=$bundlePath
    $a[1]=$locations
    $a[2]=$token
    $a[3]=$null
    try{return $importMethod.Invoke($null,$a)}
    catch [Reflection.TargetInvocationException]{
        throw $_.Exception.InnerException
    }
}
function InvokeNative([string]$mode,[string]$request,[string]$output,[int]$expected){
    $args=if($mode -eq '--install-locations-file'){
        ('{0} "{1}" "{2}"' -f $mode,$request,$output)
    }else{('{0} "{1}"' -f $mode,$output)}
    $p=Start-Process -FilePath $bundlePath -ArgumentList $args -PassThru
    try{
        if(!$p.WaitForExit(120000)){Stop-Process -Id $p.Id -Force;throw 'FIRST_INSTALL_NATIVE_TIMEOUT'}
        if($p.ExitCode -ne $expected){
            throw ('FIRST_INSTALL_NATIVE_EXIT actual={0} expected={1} mode={2}' -f $p.ExitCode,$expected,$mode)
        }
    }finally{$p.Dispose()}
    if(!(Test-Path -LiteralPath $output -PathType Leaf)){
        throw 'FIRST_INSTALL_RECEIPT_MISSING'
    }
    return (Get-Content -LiteralPath $output -Raw | ConvertFrom-Json)
}
function UninstallIfOwned(){
    if(!(Test-Path $ownerKey)){return}
    $result=InvokeNative '--uninstall-file' '' (Join-Path $fixtureBase 'removed.json') 0
    if($result.status -ne 'UNINSTALLED_USER_DATA_PRESERVED'){
        throw ('FIRST_INSTALL_UNINSTALL_FAILED_'+$result.status)
    }
}
if(Test-Path $ownerKey){throw 'FIRST_INSTALL_UNEXPECTED_EXISTING_PRODUCT'}
try{
    New-Item -ItemType Directory -Force -Path $source | Out-Null
    [IO.File]::WriteAllBytes($sourceFile,$sourceBytes)
    $sourceHash=(Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
    New-Item -ItemType Directory -Force -Path $programRoot,$dataRoot | Out-Null
    if((InspectRoot $programRoot) -ne 'READY_FOR_FIRST_INSTALL'){
        throw 'FIRST_INSTALL_EMPTY_FOLDER_REJECTED'
    }
    $foreign=Join-Path $programRoot 'foreign-file.fixture'
    [IO.File]::WriteAllText($foreign,'not owned by IWXA')
    if((InspectRoot $programRoot) -ne 'INSTALL_ROOT_NOT_EMPTY'){
        throw 'FIRST_INSTALL_FOREIGN_FOLDER_NOT_REJECTED'
    }
    if([IO.File]::ReadAllText($foreign) -ne 'not owned by IWXA'){
        throw 'FIRST_INSTALL_FOREIGN_FILES_CHANGED'
    }
    Remove-Item -LiteralPath $foreign -Force
    if((InspectRoot $programRoot) -ne 'READY_FOR_FIRST_INSTALL'){
        throw 'FIRST_INSTALL_EMPTY_FOLDER_RECHECK_FAILED'
    }
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_EMPTY_AND_OCCUPIED_FOLDER_PASS'

    $locations=MakeChoice $programRoot $dataRoot
    $cancel=[Threading.CancellationTokenSource]::new()
    try{
        $cancel.Cancel()
        $stopped=$false
        try{$null=InvokeInstallWithImport $locations $cancel.Token}
        catch [OperationCanceledException]{$stopped=$true}
        if(!$stopped -or (Test-Path $ownerKey) -or
            (Test-Path (Join-Path $programRoot 'iwxa-admin-center.exe'))){
            throw 'FIRST_INSTALL_PRE_CANCEL_MUTATED_APP'
        }
    }finally{$cancel.Dispose()}
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_PRE_CANCEL_PRESERVES_APP_PASS'

    $occupied=Join-Path $dataRoot 'existing.fixture'
    [IO.File]::WriteAllText($occupied,'keep me')
    $blocked=$false
    try{$null=InvokeInstallWithImport $locations ([Threading.CancellationToken]::None)}
    catch{
        $reason=$_.Exception.Message
        $inner=$_.Exception.InnerException
        while($null -ne $inner){
            $reason += ' ' + $inner.Message
            $inner=$inner.InnerException
        }
        if($reason -notmatch 'SETUP_STORAGE_TARGET_NOT_EMPTY_OR_EXISTS'){throw}
        $blocked=$true
    }
    if(!$blocked -or (Test-Path $ownerKey) -or
        [IO.File]::ReadAllText($occupied) -ne 'keep me'){
        throw 'FIRST_INSTALL_OCCUPIED_TRANSFER_TARGET_NOT_PROTECTED'
    }
    Remove-Item -LiteralPath $occupied -Force
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_OCCUPIED_DATA_DENIED_PASS'

    $result=InvokeInstallWithImport $locations ([Threading.CancellationToken]::None)
    if((GetField $result 'Status') -ne 'INSTALLED_WITH_VERIFIED_DATA'){
        throw 'FIRST_INSTALL_IMPORT_UNEXPECTED_RESULT'
    }
    $ownerCreated=$true
    $newFile=Join-Path $dataRoot (Split-Path -Leaf $sourceFile)
    if(!(Test-Path -LiteralPath $newFile -PathType Leaf) -or
        (Get-FileHash $newFile -Algorithm SHA256).Hash -ne $sourceHash -or
        (Get-FileHash $sourceFile -Algorithm SHA256).Hash -ne $sourceHash){
        throw 'FIRST_INSTALL_IMPORT_HASH_OR_ORIGINAL_MISMATCH'
    }
    $registry=Get-ItemProperty $ownerKey
    if($registry.InstallLocation -ne $programRoot -or
        $registry.DataLocation -ne $dataRoot -or
        !(Test-Path (Join-Path $programRoot 'iwxa-admin-center.exe'))){
        throw 'FIRST_INSTALL_IMPORTED_PATH_NOT_REGISTERED'
    }
    $readback=InvokeNative '--locations-file' '' (Join-Path $fixtureBase 'readback.json') 0
    if($readback.status -ne 'LOCATIONS_VERIFIED' -or
        $readback.dataRoot -ne $dataRoot -or
        $readback.programRoot -ne $programRoot){
        throw 'FIRST_INSTALL_NEW_PROCESS_READBACK_FAILED'
    }
    $verified=InvokeNative '--verify-installed-file' '' (Join-Path $fixtureBase 'verified.json') 0
    if($verified.status -ne 'OWNED_FILES_VERIFIED'){
        throw 'FIRST_INSTALL_INSTALLED_BINARY_INVALID'
    }
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_VERIFIED_DATA_IMPORT_AND_RESTART_PASS'
    UninstallIfOwned
    if((Get-FileHash $sourceFile -Algorithm SHA256).Hash -ne $sourceHash -or
        (Get-FileHash $newFile -Algorithm SHA256).Hash -ne $sourceHash){
        throw 'FIRST_INSTALL_UNINSTALL_ERASED_USER_DATA'
    }
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_IMPORT_UNINSTALL_PRESERVES_BOTH_PASS'

    # The other explicit user choice is no import: leave old data in place.
    New-Item -ItemType Directory -Force -Path $otherProgram,$otherData | Out-Null
    $chosen=MakeChoice $otherProgram $otherData
    $request=Join-Path $fixtureBase 'locations-request.json'
    [pscustomobject]@{
        schema='IWXA_SETUP_LOCATIONS/1'
        programRoot=$otherProgram;dataRoot=$otherData
        softwareRoot=$otherRoot;modelsRoot=$modelRoot;cacheRoot=$cacheRoot
        startWithWindows=$false
    } | ConvertTo-Json | Set-Content -LiteralPath $request -Encoding UTF8
    $plain=InvokeNative '--install-locations-file' $request (Join-Path $fixtureBase 'plain.json') 0
    if($plain.status -ne 'INSTALLED_NOT_LAUNCHED' -or
        !(Test-Path (Join-Path $otherProgram 'iwxa-admin-center.exe'))){
        throw 'FIRST_INSTALL_EMPTY_EXISTING_FOLDER_PLAIN_INSTALL_FAILED'
    }
    $ownerCreated=$true
    $readback2=InvokeNative '--locations-file' '' (Join-Path $fixtureBase 'plain-readback.json') 0
    if($readback2.dataRoot -ne $otherData -or
        (Test-Path (Join-Path $otherData (Split-Path -Leaf $sourceFile))) -or
        (Get-FileHash $sourceFile -Algorithm SHA256).Hash -ne $sourceHash){
        throw 'FIRST_INSTALL_WITHOUT_IMPORT_CHANGED_OLD_FILES'
    }
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_NO_IMPORT_EMPTY_APP_ROOT_PASS'
    UninstallIfOwned
    Write-Host 'IWXA_SETUP_FIRST_INSTALL_TWO_CHOICE_JOURNEYS_PASS'
}finally{
    try{UninstallIfOwned}catch{Write-Warning ('TEST_CLEANUP_UNINSTALL '+$_.Exception.Message)}
    if(Test-Path -LiteralPath $sourceFile){Remove-Item -LiteralPath $sourceFile -Force}
    if(Test-Path -LiteralPath $fixtureBase){
        Remove-Item -LiteralPath $fixtureBase -Recurse -Force -ErrorAction SilentlyContinue
    }
}
