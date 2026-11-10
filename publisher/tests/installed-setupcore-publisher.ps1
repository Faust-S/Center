[CmdletBinding()]
param(
  [string]$OwnerComponentPath = '',
  [switch]$TransportOnly
)
# All product assembly and test orchestration belong to PUBLIC Center.
# A prebuilt component is passed as opaque bytes; NEVER check out private
# T3 source or provision TEST signing keys in GitHub Actions.
if($TransportOnly -and !$OwnerComponentPath) {
  throw 'PUBLISHER_TRANSPORT_ONLY_REQUIRES_EXTERNAL_COMPONENT'
}
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$pin='6603a11764ff86853e5abf4d209d55f79fddd8b1'
$vendor=(Resolve-Path -LiteralPath 'vendor/setupcore').Path
$actualPin=(& git -C $vendor rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $actualPin -ne $pin) {throw "PUBLISHER_SETUP_CORE_PIN_MISMATCH expected=$pin actual=$actualPin"}
$artifact=if($TransportOnly){
  [IO.Path]::GetFullPath('artifacts/publisher-setupcore-transport')
}else{
  [IO.Path]::GetFullPath('artifacts/publisher-setupcore')
}
$componentSource=$null
$componentHash=$null
$expectedFiles=1
if($OwnerComponentPath){
  $componentSource=[IO.Path]::GetFullPath($OwnerComponentPath)
  if(!(Test-Path -LiteralPath $componentSource -PathType Leaf)){
    throw 'PUBLISHER_EXTERNAL_COMPONENT_FILE_MISSING'
  }
  $external=Get-Item -LiteralPath $componentSource
  if($external.Length -le 0 -or $external.Length -gt 512MB){
    throw 'PUBLISHER_EXTERNAL_COMPONENT_SIZE_INVALID'
  }
  $expectedFiles=2
  $componentHash=(Get-FileHash -LiteralPath $componentSource -Algorithm SHA256).Hash
}
$payload=Join-Path $artifact 'payload'
New-Item -ItemType Directory -Path $payload -Force | Out-Null
$binary=[IO.Path]::GetFullPath('publisher/src-tauri/target/release/iwxa-publisher.exe')
if(!(Test-Path -LiteralPath $binary -PathType Leaf)){throw 'PUBLISHER_RELEASE_EXE_MISSING'}
Copy-Item -LiteralPath $binary -Destination (Join-Path $payload 'iwxa-publisher.exe')
if($componentSource){
  # The original IWXA Setup Core handles multi-file payloads. Do NOT
  # bundle credentials, issuer policy, TEST licenses or private source.
  $directory=Join-Path $payload 't3'
  [void][IO.Directory]::CreateDirectory($directory)
  Copy-Item -LiteralPath $componentSource -Destination (Join-Path $directory 'iwxa-t3-product-owner.exe')
  if((Get-FileHash -LiteralPath (Join-Path $directory 'iwxa-t3-product-owner.exe') -Algorithm SHA256).Hash -ne $componentHash){
    throw 'PUBLISHER_EXTERNAL_COMPONENT_STAGE_READBACK_INVALID'
  }
}
$stub=Join-Path $artifact 'setup-core-stub.exe'
$bundleName=if($TransportOnly){
  'IWXA-Publisher-Transport-0.3.0.exe'
}else{
  'IWXA-Publisher-SetupCore-0.3.0.exe'
}
$bundle=Join-Path $artifact $bundleName
$icon=[IO.Path]::GetFullPath('publisher/src-tauri/icons/icon.ico')
& ./vendor/setupcore/installer/windows/build-stub.ps1 -Output $stub -Icon $icon
if(!(Test-Path -LiteralPath $stub -PathType Leaf)){throw 'PUBLISHER_SETUP_STUB_BUILD_FAILED'}

# Reuse the original Setup Core DPI/native-layout qualification. Publisher
# previously pinned a WinForms build where DockStyle.Left and DockStyle.Fill
# were siblings: under DPI scaling the sidebar painted over the main card.
# Never accept a Publisher installer without the original two-column layout.
& ./vendor/setupcore/installer/windows/qualify-gui-layout-fast.ps1 -Stub $stub
if($LASTEXITCODE -ne 0){throw 'PUBLISHER_SETUP_ORIGINAL_DPI_LAYOUT_FAILED'}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$stubAssembly=[Reflection.Assembly]::LoadFrom([IO.Path]::GetFullPath($stub))
$formType=$stubAssembly.GetType('IwxaSetup.SetupForm',$true)
foreach($scale in @(1.0,1.25,1.5,2.0,2.5)){
  $form=[Activator]::CreateInstance($formType,$true)
  try{
    $null=$form.Handle
    if($scale -ne 1.0){
      $form.Scale([Drawing.SizeF]::new([single]$scale,[single]$scale))
    }
    $form.ClientSize=[Drawing.Size]::new(
      [int][Math]::Round(900*$scale),
      [int][Math]::Round(560*$scale))
    $form.PerformLayout()
    # Setup Core 1.0 uses one outer column with header, two-column
    # work area and footer. Qualify the actual two content cards, not the
    # obsolete pre-unified root layout.
    $shell=$form.Controls[0]
    if($shell -isnot [System.Windows.Forms.TableLayoutPanel] -or
       $shell.ColumnCount -ne 1 -or $shell.RowCount -ne 3){
      throw "PUBLISHER_SETUP_UNIFIED_SHELL_INVALID scale=$scale"
    }
    $shell.PerformLayout()
    $work=$shell.GetControlFromPosition(0,1)
    if($work -isnot [System.Windows.Forms.TableLayoutPanel] -or $work.ColumnCount -ne 2){
      throw "PUBLISHER_SETUP_UNIFIED_TWO_COLUMN_LAYOUT_MISSING scale=$scale"
    }
    $work.PerformLayout()
    $left=$work.GetControlFromPosition(0,0)
    $right=$work.GetControlFromPosition(1,0)
    if(!$left -or !$right -or $left.Width -le 0 -or $right.Width -le 0){
      throw "PUBLISHER_SETUP_UNIFIED_CARDS_MISSING scale=$scale"
    }
    if($left.Left -lt $work.Padding.Left -or $right.Left -lt $left.Right -or
       $right.Right -gt ($work.ClientSize.Width - $work.Padding.Right)){
      throw "PUBLISHER_SETUP_UNIFIED_CARDS_OVERLAP scale=$scale left=$($left.Bounds) right=$($right.Bounds)"
    }
    Write-Host "PUBLISHER_SETUP_UNIFIED_CARDS_SEPARATED_PASS scale=$scale"
  } finally { $form.Dispose() }
}

$head=(& git rev-parse HEAD).Trim()
$tree=(& git rev-parse 'HEAD^{tree}').Trim()
if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$'){throw 'PUBLISHER_SOURCE_PIN_MISSING'}
$manifestFile=Join-Path $artifact 'build-manifest.json'
& python vendor/setupcore/installer/build_bundle.py build --product publisher/setup/product.json --payload $payload --stub $stub --output $bundle --source-commit $head --source-tree $tree | Set-Content -LiteralPath $manifestFile
if($LASTEXITCODE -ne 0){throw 'PUBLISHER_SETUP_BUILD_FAILED'}
$manifest=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json -Depth 50
if($manifest.status -ne 'VERIFIED' -or $manifest.product -ne 'iwxa.publisher' -or $manifest.version -ne '0.3.0' -or $manifest.file_count -ne $expectedFiles -or $manifest.source.commit -ne $head -or $manifest.source.tree -ne $tree){throw 'PUBLISHER_SETUP_BUILD_READBACK_INVALID'}
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
if($inspection.status -ne 'VERIFIED' -or $inspection.product -ne 'iwxa.publisher' -or $inspection.version -ne '0.3.0' -or $inspection.files -ne $expectedFiles -or $inspection.sourceCommit -ne $head -or $inspection.packageSha256 -ne $manifest.payload_sha256){throw 'PUBLISHER_SETUP_NATIVE_INSPECT_INVALID'}
Write-Host 'PUBLISHER_SETUP_NATIVE_INSPECT_PASS'
$preflight=Invoke-Setup '--preflight-file' $preflightFile 0
if($preflight.status -ne 'READY_FOR_FIRST_INSTALL'){throw "PUBLISHER_SETUP_PREFLIGHT_BLOCKED_$($preflight.status)"}
$stage=Invoke-Setup '--stage-test-file' $stagedFile 0
if($stage.status -ne 'STAGED_VERIFIED' -or $stage.product -ne 'iwxa.publisher' -or $stage.files -ne $expectedFiles -or $stage.packageSha256 -ne $manifest.payload_sha256){throw 'PUBLISHER_SETUP_NATIVE_STAGE_INVALID'}
Write-Host 'PUBLISHER_SETUP_STAGE_READBACK_PASS'
$dataRoot=Join-Path $env:LOCALAPPDATA 'ru.iwxa.publisher'
$dataSentinel=Join-Path $dataRoot 'publisher-setup-preserved.txt'
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
Set-Content -LiteralPath $dataSentinel -NoNewline -Value 'publisher-user-data-untouched'
$installed=$false
$root=''
$guiFailure=$null
try {
  $result=Invoke-Setup '--install-file' $installFile 0
  if($result.status -ne 'INSTALLED_NOT_LAUNCHED' -or $result.product -ne 'iwxa.publisher' -or $result.version -ne '0.3.0'){throw 'PUBLISHER_SETUP_INSTALL_RESULT_INVALID'}
  $root=[string]$result.installRoot
  $expectedRoot=Join-Path $env:LOCALAPPDATA 'Programs/IWXA Publisher'
  if($root -ne $expectedRoot){throw "PUBLISHER_SETUP_INSTALL_ROOT_MISMATCH $root"}
  $installed=$true
  $app=Join-Path $root 'iwxa-publisher.exe'
  if(!(Test-Path -LiteralPath $app -PathType Leaf)){throw 'PUBLISHER_SETUP_INSTALLED_BINARY_MISSING'}
  if((Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash){throw 'PUBLISHER_SETUP_INSTALLED_BYTES_MISMATCH'}
  if($componentSource){
    $native=Join-Path $root 't3/iwxa-t3-product-owner.exe'
    if(!(Test-Path -LiteralPath $native -PathType Leaf)){
      throw 'PUBLISHER_EXTERNAL_COMPONENT_NOT_INSTALLED'
    }
    if((Get-FileHash -LiteralPath $native -Algorithm SHA256).Hash -ne $componentHash){
      throw 'PUBLISHER_EXTERNAL_COMPONENT_INSTALLED_BYTES_MISMATCH'
    }
    Write-Host 'PUBLISHER_EXTERNAL_COMPONENT_PACKAGED_BYTES_PASS (signature NOT validated)'
  }
  $registered=Get-ItemProperty -Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.publisher'
  if($registered.InstallLocation -ne $root){throw 'PUBLISHER_SETUP_REGISTRY_BINDING_INVALID'}
  Write-Host "PUBLISHER_SETUP_INSTALLED_EXACT_BINARY_PASS sha256=$((Get-FileHash $app -Algorithm SHA256).Hash)"
  $duplicate=Invoke-Setup '--install-file' $duplicateFile 2
  if($duplicate.status -ne 'ERROR' -or $duplicate.reason -notlike 'SETUP_BLOCKED_EXISTING_INSTALLATION*'){throw 'PUBLISHER_SETUP_DUPLICATE_INSTALL_NOT_REJECTED'}
  Write-Host 'PUBLISHER_SETUP_DUPLICATE_REJECT_PASS'
  if(!$TransportOnly){
  $env:IWXA_PUBLISHER_ALREADY_INSTALLED='1'
  $env:IWXA_PUBLISHER_INSTALLED_EXE=$app
  try {& ./publisher/tests/installed-windows-publisher.ps1}
  catch {
    $guiFailure=$_.Exception.Message
    Write-Host "PUBLISHER_SETUP_GUI_PRIMARY_FAILURE $guiFailure"
    throw
  }
  finally {
    Remove-Item Env:IWXA_PUBLISHER_ALREADY_INSTALLED -ErrorAction SilentlyContinue
    Remove-Item Env:IWXA_PUBLISHER_INSTALLED_EXE -ErrorAction SilentlyContinue
  }
  Write-Host 'PUBLISHER_SETUP_REAL_GUI_AND_RESTART_PASS'
  }else{
    Write-Host 'PUBLISHER_NATIVE_EXTERNAL_COMPONENT_TRANSPORT_ONLY_PASS'
  }
} finally {
  if($installed) {
    $removed=Invoke-Setup '--uninstall-file' $uninstallFile 0
    # The Setup Core receipt can succeed before post-uninstall resources
    # disappear. Preserve the exact Windows witness instead of conflating
    # an existing folder, registry entry and a still-running app process.
    $rootPresent=[bool](Test-Path -LiteralPath $root)
    $registryPresent=[bool](Test-Path 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.publisher')
    $leftoverNames=if($rootPresent){@(Get-ChildItem -LiteralPath $root -Force -Recurse -ErrorAction SilentlyContinue|Select-Object -First 24 -ExpandProperty Name)}else{@()}
    $publisherProcesses=@(Get-Process -Name 'iwxa-publisher' -ErrorAction SilentlyContinue).Count
    $webViewProcesses=@(Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue).Count
    $uninstallWitness=[ordered]@{
      status=$removed.status
      rootPresent=$rootPresent
      registryPresent=$registryPresent
      leftoverNames=@($leftoverNames)
      publisherProcesses=$publisherProcesses
      webViewProcesses=$webViewProcesses
    }
    $uninstallWitness|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $artifact 'uninstall-witness.json') -Encoding utf8
    Write-Host ("PUBLISHER_SETUP_UNINSTALL_WITNESS status={0} root={1} registry={2} publisherProcesses={3} webViewProcesses={4}" -f $removed.status,$rootPresent,$registryPresent,$publisherProcesses,$webViewProcesses)
    if($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or $rootPresent -or $registryPresent){
      throw ("PUBLISHER_SETUP_UNINSTALL_INVALID root={0} registry={1} remaining={2}" -f $rootPresent,$registryPresent,($leftoverNames -join ','))
    }
    if(!(Test-Path -LiteralPath $dataSentinel) -or (Get-Content -LiteralPath $dataSentinel -Raw) -ne 'publisher-user-data-untouched'){throw 'PUBLISHER_SETUP_USER_DATA_WAS_CHANGED'}
    if(!$TransportOnly -and !(Test-Path -LiteralPath (Join-Path $dataRoot 'publisher-preparation-v1.json'))){
      if($null -eq $guiFailure){throw 'PUBLISHER_SETUP_USER_DRAFT_LOST'}
      Write-Host 'PUBLISHER_SETUP_DRAFT_NOT_WRITTEN_BEFORE_GUI_FAILURE'
    }
    Write-Host 'PUBLISHER_SETUP_UNINSTALL_PRESERVES_USER_DATA_PASS'
  }
}
$reportStatus=if($TransportOnly){'PUBLISHER_TWO_FILE_TRANSPORT_ONLY_PASS'}else{'PUBLISHER_SETUP_CORE_INSTALLED_GUI_PASS'}
$report=[ordered]@{
  status=$reportStatus
  sourceHead=$head;sourceTree=$tree;setupCorePin=$pin
  product='iwxa.publisher';version='0.3.0'
  setupSha256=$manifest.setup_sha256
  appSha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
  fileCount=$expectedFiles
  externalComponentSha256=$componentHash
  externalComponentFromPrivateSource=$false
  privateSignerVerified=$false
  signedLicenseIssued=$false
  productionActivation=$false
  activeSeats=0
  userDataPreserved=$true
  realPublisherIssue='NOT_CONNECTED'
}
$report|ConvertTo-Json -Depth 50|Set-Content -LiteralPath (Join-Path $artifact 'result.json') -Encoding utf8
Write-Host $report.status
