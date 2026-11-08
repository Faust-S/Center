[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$pin='806fd34d74ec4101a442f8550950e8c8047ba68b'
$vendor=(Resolve-Path -LiteralPath 'vendor/setupcore').Path
$actualPin=(& git -C $vendor rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $actualPin -ne $pin) {throw "PUBLISHER_SETUP_CORE_PIN_MISMATCH expected=$pin actual=$actualPin"}
$artifact=[IO.Path]::GetFullPath('artifacts/publisher-setupcore')
$payload=Join-Path $artifact 'payload'
New-Item -ItemType Directory -Path $payload -Force | Out-Null
$binary=[IO.Path]::GetFullPath('publisher/src-tauri/target/release/iwxa-publisher.exe')
if(!(Test-Path -LiteralPath $binary -PathType Leaf)){throw 'PUBLISHER_RELEASE_EXE_MISSING'}
Copy-Item -LiteralPath $binary -Destination (Join-Path $payload 'iwxa-publisher.exe')
$stub=Join-Path $artifact 'setup-core-stub.exe'
$bundle=Join-Path $artifact 'IWXA-Publisher-SetupCore-0.2.0-dev.2.exe'
$icon=[IO.Path]::GetFullPath('publisher/src-tauri/icons/icon.ico')
& ./vendor/setupcore/installer/windows/build-stub.ps1 -Output $stub -Icon $icon
if(!(Test-Path -LiteralPath $stub -PathType Leaf)){throw 'PUBLISHER_SETUP_STUB_BUILD_FAILED'}
$head=(& git rev-parse HEAD).Trim()
$tree=(& git rev-parse 'HEAD^{tree}').Trim()
if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$'){throw 'PUBLISHER_SOURCE_PIN_MISSING'}
$manifestFile=Join-Path $artifact 'build-manifest.json'
& python vendor/setupcore/installer/build_bundle.py build --product publisher/setup/product.json --payload $payload --stub $stub --output $bundle --source-commit $head --source-tree $tree | Set-Content -LiteralPath $manifestFile
if($LASTEXITCODE -ne 0){throw 'PUBLISHER_SETUP_BUILD_FAILED'}
$manifest=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json -Depth 50
if($manifest.status -ne 'VERIFIED' -or $manifest.product -ne 'iwxa.publisher' -or $manifest.version -ne '0.2.0-dev.2' -or $manifest.file_count -ne 1 -or $manifest.source.commit -ne $head -or $manifest.source.tree -ne $tree){throw 'PUBLISHER_SETUP_BUILD_READBACK_INVALID'}
Write-Host "PUBLISHER_SETUP_BUNDLE_BUILT_PASS SHA256=$($manifest.setup_sha256) source=$head tree=$tree"
$inspectionFile=Join-Path $artifact 'inspect.json'
$preflightFile=Join-Path $artifact 'preflight.json'
$stagedFile=Join-Path $artifact 'stage.json'
$installFile=Join-Path $artifact 'install.json'
$duplicateFile=Join-Path $artifact 'duplicate.json'
$uninstallFile=Join-Path $artifact 'uninstall.json'
function Invoke-Setup([string]$verb,[string]$file,[int]$expected) {
  if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}
  # Original Setup Core is a Windows GUI executable: native "& exe" does not
  # wait for the report. Use the original owning test's process-wait contract.
  $cmd=Start-Process -FilePath $bundle -ArgumentList ('{0} "{1}"' -f $verb,$file) -PassThru
  try{
    if(!$cmd.WaitForExit(90000)){
      Stop-Process -Id $cmd.Id -Force -ErrorAction SilentlyContinue
      throw "PUBLISHER_SETUP_OPERATION_TIMEOUT verb=$verb"
    }
    if($cmd.ExitCode -ne $expected){
      throw "PUBLISHER_SETUP_OPERATION_FAILED verb=$verb code=$($cmd.ExitCode) expected=$expected"
    }
  } finally {$cmd.Dispose()}
  if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw "PUBLISHER_SETUP_REPORT_MISSING verb=$verb"}
  return (Get-Content -LiteralPath $file -Raw | ConvertFrom-Json -Depth 50)
}
$inspection=Invoke-Setup '--inspect-file' $inspectionFile 0
if($inspection.status -ne 'VERIFIED' -or $inspection.product -ne 'iwxa.publisher' -or $inspection.version -ne '0.2.0-dev.2' -or $inspection.files -ne 1 -or $inspection.sourceCommit -ne $head -or $inspection.packageSha256 -ne $manifest.payload_sha256){throw 'PUBLISHER_SETUP_NATIVE_INSPECT_INVALID'}
Write-Host 'PUBLISHER_SETUP_NATIVE_INSPECT_PASS'
$preflight=Invoke-Setup '--preflight-file' $preflightFile 0
if($preflight.status -ne 'READY_FOR_FIRST_INSTALL'){throw "PUBLISHER_SETUP_PREFLIGHT_BLOCKED_$($preflight.status)"}
$stage=Invoke-Setup '--stage-test-file' $stagedFile 0
if($stage.status -ne 'STAGED_VERIFIED' -or $stage.product -ne 'iwxa.publisher' -or $stage.files -ne 1 -or $stage.packageSha256 -ne $manifest.payload_sha256){throw 'PUBLISHER_SETUP_NATIVE_STAGE_INVALID'}
Write-Host 'PUBLISHER_SETUP_STAGE_READBACK_PASS'
$dataRoot=Join-Path $env:LOCALAPPDATA 'ru.iwxa.publisher'
$dataSentinel=Join-Path $dataRoot 'publisher-setup-preserved.txt'
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
Set-Content -LiteralPath $dataSentinel -NoNewline -Value 'publisher-user-data-untouched'
$installed=$false
$root=''
try {
  $result=Invoke-Setup '--install-file' $installFile 0
  if($result.status -ne 'INSTALLED_NOT_LAUNCHED' -or $result.product -ne 'iwxa.publisher' -or $result.version -ne '0.2.0-dev.2'){throw 'PUBLISHER_SETUP_INSTALL_RESULT_INVALID'}
  $root=[string]$result.installRoot
  $expectedRoot=Join-Path $env:LOCALAPPDATA 'Programs/IWXA Publisher'
  if($root -ne $expectedRoot){throw "PUBLISHER_SETUP_INSTALL_ROOT_MISMATCH $root"}
  $installed=$true
  $app=Join-Path $root 'iwxa-publisher.exe'
  if(!(Test-Path -LiteralPath $app -PathType Leaf)){throw 'PUBLISHER_SETUP_INSTALLED_BINARY_MISSING'}
  if((Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash){throw 'PUBLISHER_SETUP_INSTALLED_BYTES_MISMATCH'}
  $registered=Get-ItemProperty -Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.publisher'
  if($registered.InstallLocation -ne $root){throw 'PUBLISHER_SETUP_REGISTRY_BINDING_INVALID'}
  Write-Host "PUBLISHER_SETUP_INSTALLED_EXACT_BINARY_PASS sha256=$((Get-FileHash $app -Algorithm SHA256).Hash)"
  $duplicate=Invoke-Setup '--install-file' $duplicateFile 2
  if($duplicate.status -ne 'ERROR' -or $duplicate.reason -notlike 'SETUP_BLOCKED_EXISTING_INSTALLATION*'){throw 'PUBLISHER_SETUP_DUPLICATE_INSTALL_NOT_REJECTED'}
  Write-Host 'PUBLISHER_SETUP_DUPLICATE_REJECT_PASS'
  $env:IWXA_PUBLISHER_ALREADY_INSTALLED='1'
  $env:IWXA_PUBLISHER_INSTALLED_EXE=$app
  try {& ./publisher/tests/installed-windows-publisher.ps1}
  finally {
    Remove-Item Env:IWXA_PUBLISHER_ALREADY_INSTALLED -ErrorAction SilentlyContinue
    Remove-Item Env:IWXA_PUBLISHER_INSTALLED_EXE -ErrorAction SilentlyContinue
  }
  Write-Host 'PUBLISHER_SETUP_REAL_GUI_AND_RESTART_PASS'
} finally {
  if($installed) {
    $removed=Invoke-Setup '--uninstall-file' $uninstallFile 0
    if($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or (Test-Path -LiteralPath $root) -or (Test-Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.publisher')){throw 'PUBLISHER_SETUP_UNINSTALL_INVALID'}
    if(!(Test-Path -LiteralPath $dataSentinel) -or (Get-Content -LiteralPath $dataSentinel -Raw) -ne 'publisher-user-data-untouched'){throw 'PUBLISHER_SETUP_USER_DATA_WAS_CHANGED'}
    if(!(Test-Path -LiteralPath (Join-Path $dataRoot 'publisher-preparation-v1.json'))){throw 'PUBLISHER_SETUP_USER_DRAFT_LOST'}
    Write-Host 'PUBLISHER_SETUP_UNINSTALL_PRESERVES_USER_DATA_PASS'
  }
}
$report=[ordered]@{status='PUBLISHER_SETUP_CORE_INSTALLED_GUI_PASS';sourceHead=$head;sourceTree=$tree;setupCorePin=$pin;product='iwxa.publisher';version='0.2.0-dev.2';setupSha256=$manifest.setup_sha256;appSha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash;userDataPreserved=$true;realPublisherIssue='NOT_CONNECTED'}
$report|ConvertTo-Json -Depth 50|Set-Content -LiteralPath (Join-Path $artifact 'result.json') -Encoding utf8
Write-Host 'PUBLISHER_SETUP_CORE_INSTALLED_GUI_PASS'
