[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ConsumerComponentPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# PUBLIC CENTER test. Supplied EXE is opaque; never check out private source.
# Verifies original Setup Core packaging, installation, hashes and removal.
# No real signature, issuer, license or commercial entitlement is tested.
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $root
try {
  $external=Get-Item -LiteralPath $ConsumerComponentPath -ErrorAction Stop
  if($external.PSIsContainer -or $external.Length -lt 1 -or $external.Length -gt 512MB){
    throw 'CENTER_EXTERNAL_COMPONENT_FILE_INVALID'
  }
  $componentHash=(Get-FileHash -LiteralPath $external.FullName -Algorithm SHA256).Hash
  $exe=Join-Path $root 'src-tauri/target/release/iwxa-admin-center.exe'
  if(!(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'CENTER_PUBLIC_RELEASE_EXE_MISSING'}
  $artifact=Join-Path $root 'artifacts/center-component-transport'
  $payload=Join-Path $artifact 'payload'
  $nested=Join-Path $payload 't3/iwxa-t3-product-consumer.exe'
  [void][IO.Directory]::CreateDirectory((Split-Path $nested -Parent))
  Copy-Item -LiteralPath $exe -Destination (Join-Path $payload 'iwxa-admin-center.exe') -Force
  Copy-Item -LiteralPath $external.FullName -Destination $nested -Force
  if((Get-FileHash -LiteralPath $nested -Algorithm SHA256).Hash -ne $componentHash){
    throw 'CENTER_EXTERNAL_COMPONENT_STAGED_SHA_MISMATCH'
  }
  $profile=Join-Path $root 'installer/products/center.json'
  $stub=Join-Path $artifact 'setup-core-stub.exe'
  $bundle=Join-Path $artifact 'Center-External-Component-Transport-TEST.exe'
  & (Join-Path $root 'installer/windows/build-stub.ps1') -Output $stub
  if($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $stub)){
    throw 'CENTER_ORIGINAL_SETUP_CORE_STUB_MISSING'
  }
  $head=(& git rev-parse HEAD).Trim()
  $tree=(& git rev-parse 'HEAD^{tree}').Trim()
  if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$' -or
     $tree -notmatch '^[0-9a-f]{40}$'){
    throw 'CENTER_SETUP_SOURCE_NOT_PINNED'
  }
  $args=@('-m','installer.build_bundle','build',
    '--product',$profile,'--payload',$payload,'--stub',$stub,
    '--output',$bundle,'--source-commit',$head,'--source-tree',$tree)
  $generated=& python @args
  if($LASTEXITCODE -ne 0){throw 'CENTER_ORIGINAL_SETUP_CORE_PACKAGE_FAILED'}
  $manifest=($generated|Out-String)|ConvertFrom-Json -Depth 50
  if($manifest.status -ne 'VERIFIED' -or $manifest.file_count -ne 2 -or
     $manifest.product -ne 'iwxa.admin-center' -or $manifest.source.commit -ne $head){
    throw 'CENTER_TWO_FILE_MANIFEST_INVALID'
  }
  function Invoke-Transport([string]$operation,[string]$name,[int]$expected=0){
    $receiptFile=Join-Path $artifact "$name.json"
    $cmd=Start-Process -FilePath $bundle -ArgumentList ('{0} "{1}"' -f $operation,$receiptFile) -PassThru
    try{
      if(!$cmd.WaitForExit(90000)){
        Stop-Process -Id $cmd.Id -Force -ErrorAction SilentlyContinue
        throw "CENTER_TWO_FILE_SETUP_TIMEOUT $operation"
      }
      if($cmd.ExitCode -ne $expected){
        throw "CENTER_TWO_FILE_SETUP_EXIT $operation $($cmd.ExitCode)"
      }
    }finally {$cmd.Dispose()}
    if(!(Test-Path -LiteralPath $receiptFile -PathType Leaf)){
      throw "CENTER_TWO_FILE_SETUP_RECEIPT_MISSING $operation"
    }
    return Get-Content -LiteralPath $receiptFile -Raw|ConvertFrom-Json -Depth 50
  }
  $inspection=Invoke-Transport '--inspect-file' 'inspect'
  if($inspection.status -ne 'VERIFIED' -or $inspection.files -ne 2 -or
     $inspection.product -ne $manifest.product -or
     $inspection.packageSha256 -ne $manifest.payload_sha256){
    throw 'CENTER_TWO_FILE_NATIVE_INSPECTION_INVALID'
  }
  $stage=Invoke-Transport '--stage-test-file' 'stage'
  if($stage.status -ne 'STAGED_VERIFIED' -or $stage.files -ne 2 -or
     $stage.packageSha256 -ne $manifest.payload_sha256){
    throw 'CENTER_TWO_FILE_NATIVE_STAGE_INVALID'
  }
  $preflight=Invoke-Transport '--preflight-file' 'preflight'
  if($preflight.status -ne 'READY_FOR_FIRST_INSTALL'){
    throw "CENTER_TWO_FILE_PROFILE_NOT_CLEAN $($preflight.status)"
  }
  $installed=$null
  try{
    $installed=Invoke-Transport '--install-file' 'install'
    if($installed.status -ne 'INSTALLED_NOT_LAUNCHED' -or
       $installed.product -ne 'iwxa.admin-center'){
      throw 'CENTER_TWO_FILE_NATIVE_INSTALL_INVALID'
    }
    $installedComponent=Join-Path $installed.installRoot 't3/iwxa-t3-product-consumer.exe'
    $installedApp=Join-Path $installed.installRoot 'iwxa-admin-center.exe'
    if(!(Test-Path -LiteralPath $installedComponent -PathType Leaf) -or
       !(Test-Path -LiteralPath $installedApp -PathType Leaf)){
      throw 'CENTER_TWO_FILE_INSTALLED_PAYLOAD_MISSING'
    }
    if((Get-FileHash -LiteralPath $installedComponent -Algorithm SHA256).Hash -ne $componentHash -or
       (Get-FileHash -LiteralPath $installedApp -Algorithm SHA256).Hash -ne
       (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash){
      throw 'CENTER_TWO_FILE_INSTALLED_BYTES_MISMATCH'
    }
    Write-Host 'CENTER_TWO_FILE_NATIVE_COMPONENT_BYTES_PASS_NO_LICENSE'
  }finally{
    if($installed){
      $uninstalled=Invoke-Transport '--uninstall-file' 'uninstall'
      if($uninstalled.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
         (Test-Path -LiteralPath $installed.installRoot)){
        throw 'CENTER_TWO_FILE_NATIVE_UNINSTALL_INVALID'
      }
    }
  }
  $report=[ordered]@{
    schema='IWXA_CENTER_NATIVE_EXTERNAL_COMPONENT_TRANSPORT/1'
    status='CENTER_TWO_FILE_TRANSPORT_ONLY_PASS'
    sourceHead=$head;sourceTree=$tree;product='iwxa.admin-center'
    fileCount=2;setupSha256=$manifest.setup_sha256
    appSha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    opaqueComponentSha256=$componentHash
    signedLicenseVerified=$false
    licensedSeats=0
    productionActivation=$false
    privateSourceCheckout=$false
  }
  $report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $artifact 'result.json') -Encoding UTF8
  Write-Host 'CENTER_TWO_FILE_SETUP_CORE_TRANSPORT_PASS_PUBLIC'
}finally{
  Pop-Location
}
