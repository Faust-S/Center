[CmdletBinding()]param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$art=Join-Path $env:GITHUB_WORKSPACE 'artifacts'
$stub=Join-Path $art 'v2-stub.exe'
$payload=Join-Path $art 'v2-payload'
$unsigned=Join-Path $art 'v2-unsigned.exe'
$signed=Join-Path $art 'v2-signed.exe'
$altered=Join-Path $art 'v2-tampered.exe'
New-Item -ItemType Directory -Force -Path $art,$payload|Out-Null
Copy-Item 'accepted/src-tauri/target/release/iwxa-admin-center.exe' (Join-Path $payload 'iwxa-admin-center.exe')
./installer/windows/build-stub.ps1 -Output $stub
$head=(& git rev-parse HEAD).Trim()
$tree=(& git rev-parse 'HEAD^{tree}').Trim()
$args=@('-m','installer.build_bundle','build-resource',
  '--product','installer/products/center.json','--payload',$payload,
  '--stub',$stub,'--output',$unsigned,'--source-commit',$head,'--source-tree',$tree)
$details=& python @args
if($LASTEXITCODE -ne 0){throw 'RESOURCE_V2_BUILD_FAILED'}
$build=($details|Out-String)|ConvertFrom-Json
if($build.status -ne 'VERIFIED' -or $build.format -ne 'PE_RESOURCE_V2'){
  throw 'RESOURCE_V2_BUILD_PROVENANCE_INVALID'
}
function Inspect([string]$file,[string]$tag,[int]$exitExpected){
  $report=Join-Path $art ('v2-inspect-'+$tag+'.json')
  $process=Start-Process -FilePath $file -ArgumentList ('--inspect-file "{0}"' -f $report) -PassThru
  try{
    if(!$process.WaitForExit(60000)){Stop-Process -Id $process.Id -Force;throw 'RESOURCE_V2_INSPECT_TIMEOUT'}
    $exitCode=$process.ExitCode
  }finally{$process.Dispose()}
  if($exitCode -ne $exitExpected){throw ('RESOURCE_V2_INSPECT_BAD_EXIT_'+$tag+'_'+$exitCode)}
  if(!(Test-Path -LiteralPath $report)){throw 'RESOURCE_V2_INSPECT_REPORT_MISSING'}
  return Get-Content -LiteralPath $report -Raw|ConvertFrom-Json
}
$before=Inspect $unsigned 'unsigned' 0
if($before.status -ne 'VERIFIED'){throw 'RESOURCE_V2_UNSIGNED_INSPECTION_FAILED'}
Copy-Item -LiteralPath $unsigned -Destination $signed
$tool=Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse -File |
  Where-Object {$_.FullName -match '\\x64\\signtool\.exe$'} |
  Sort-Object FullName -Descending|Select-Object -First 1
if(!$tool){throw 'RESOURCE_V2_SIGNTOOL_MISSING'}
$cert=New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=IWXA PE RESOURCE TEST ONLY' -CertStoreLocation 'Cert:\CurrentUser\My'
try{
  & $tool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $signed
  if($LASTEXITCODE -ne 0){throw 'RESOURCE_V2_DEV_SIGN_FAILED'}
  $after=Inspect $signed 'signed' 0
  if($after.status -ne 'VERIFIED' -or
     $after.packageSha256 -ne $before.packageSha256){
    throw 'RESOURCE_V2_SIGNING_CHANGED_PACKAGE'
  }
  $staged=Join-Path $art 'v2-stage.json'
  $worker=Start-Process -FilePath $signed -ArgumentList ('--stage-test-file "{0}"' -f $staged) -PassThru
  try{
    if(!$worker.WaitForExit(60000)){Stop-Process -Id $worker.Id -Force;throw 'RESOURCE_V2_STAGE_TIMEOUT'}
    if($worker.ExitCode -ne 0){throw 'RESOURCE_V2_STAGE_EXIT_FAILED'}
  }finally{$worker.Dispose()}
  $stage=Get-Content -LiteralPath $staged -Raw|ConvertFrom-Json
  if($stage.status -ne 'STAGED_VERIFIED' -or
     $stage.packageSha256 -ne $before.packageSha256){
    throw 'RESOURCE_V2_SIGNED_STAGING_INVALID'
  }
  Copy-Item -LiteralPath $signed -Destination $altered
  $bytes=[IO.File]::ReadAllBytes($altered)
  $magic=[Text.Encoding]::ASCII.GetBytes('IWXA_SETUP_RSRC2')
  $foundAt=-1
  for($i=0;$i -le $bytes.Length-$magic.Length;$i++){
    if($bytes[$i] -ne $magic[0]){continue}
    $matches=$true
    for($k=1;$k -lt $magic.Length;$k++){
      if($bytes[$i+$k] -ne $magic[$k]){$matches=$false;break}
    }
    if($matches){$foundAt=$i;break}
  }
  if($foundAt -lt 256){throw 'RESOURCE_V2_TAMPER_OFFSET_MISSING'}
  $bytes[$foundAt-256]=[byte]($bytes[$foundAt-256] -bxor 1)
  [IO.File]::WriteAllBytes($altered,$bytes)
  $bad=Inspect $altered 'tampered' 2
  if($bad.status -ne 'ERROR' -or $bad.reason -notmatch 'HASH_INVALID|LAYOUT_INVALID'){
    throw 'RESOURCE_V2_TAMPER_ACCEPTED'
  }
  $auth=Get-AuthenticodeSignature -LiteralPath $signed
  [pscustomobject]@{
    schema='IWXA_RESOURCE_V2_SIGNED_DIAGNOSTIC/1'
    releaseAccepted=$false
    sourceCommit=$head
    format=$build.format
    authenticodeStatus=[string]$auth.Status
    unsignedInspection=$before.status
    signedInspection=$after.status
    signedStaging=$stage.status
    payloadSha256=$after.packageSha256
    tamperRejected=$true
    tamperReason=$bad.reason
  }|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $art 'setup-resource-v2-qualification.json')
  Write-Host "IWXA_RESOURCE_V2_SIGNED_INSPECT_STAGE_PASS hash=$($after.packageSha256)"
  Write-Host "IWXA_RESOURCE_V2_TAMPER_REJECTED_PASS reason=$($bad.reason)"
  Write-Host "IWXA_RESOURCE_V2_AUTHENTICODE_TEST_CERT=$($auth.Status)"
}finally{
  Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
}
