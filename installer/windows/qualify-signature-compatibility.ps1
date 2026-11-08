# Developer-only qualification; temporary test certificate is never a release key.
[CmdletBinding()]param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$art=Join-Path $env:GITHUB_WORKSPACE 'artifacts'
$originalExe='accepted/src-tauri/target/release/iwxa-admin-center.exe'
if(!(Test-Path -LiteralPath $originalExe)){throw 'SIGN_PROBE_SOURCE_BINARY_MISSING'}
$payload=Join-Path $art 'signature-payload'
New-Item -ItemType Directory -Force -Path $payload|Out-Null
Copy-Item $originalExe (Join-Path $payload 'iwxa-admin-center.exe')
$stub=Join-Path $art 'signature-stub.exe'
$unsigned=Join-Path $art 'signature-unsigned.exe'
$signed=Join-Path $art 'signature-signed-after-package.exe'
./installer/windows/build-stub.ps1 -Output $stub
$head=(& git rev-parse HEAD).Trim()
$tree=(& git rev-parse 'HEAD^{tree}').Trim()
$args=@('-m','installer.build_bundle','build','--product',
  'installer/products/center.json','--payload',$payload,'--stub',$stub,
  '--output',$unsigned,'--source-commit',$head,'--source-tree',$tree)
$null=& python @args
if($LASTEXITCODE -ne 0){throw 'SIGN_PROBE_UNTRUSTED_BUNDLE_BUILD_FAILURE'}
Copy-Item -LiteralPath $unsigned -Destination $signed
$tool=Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse -File |
  Where-Object {$_.FullName -match '\\x64\\signtool\.exe$'} |
  Sort-Object FullName -Descending|Select-Object -First 1
if(!$tool){throw 'SIGN_PROBE_SIGNTOOL_MISSING'}
$cert=New-SelfSignedCertificate -Type CodeSigningCert -HashAlgorithm SHA256 -Subject 'CN=IWXA DEV ONLY' -CertStoreLocation 'Cert:\CurrentUser\My'
try{
  & $tool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $signed
  if($LASTEXITCODE -ne 0){throw 'SIGN_PROBE_SIGN_FAILED'}
  # Trust only this ephemeral developer certificate on the disposable
  # runner, so the probe distinguishes hash/layout failure from UntrustedRoot.
  $certFile=Join-Path $art 'sign-probe-public-cert.cer'
  $null=Export-Certificate -Cert $cert -FilePath $certFile
  $null=Import-Certificate -FilePath $certFile -CertStoreLocation 'Cert:\CurrentUser\Root'
  $auth=Get-AuthenticodeSignature -LiteralPath $signed
  $data=[IO.File]::ReadAllBytes($signed)
  $peOffset=[BitConverter]::ToInt32($data,0x3c)
  $optOffset=$peOffset+24
  $magic=[BitConverter]::ToUInt16($data,$optOffset)
  $dirOffset=$optOffset + $(if($magic -eq 0x20b){112}else{96}) + 32
  $certOffset=[BitConverter]::ToUInt32($data,$dirOffset)
  $certLength=[BitConverter]::ToUInt32($data,$dirOffset+4)
  $checksum=[BitConverter]::ToUInt32($data,$optOffset+64)
  $unsignedSize=(Get-Item -LiteralPath $unsigned).Length
  $certificateLayout=[pscustomobject]@{
    peMagic=$magic
    checksum=$checksum
    securityDirectoryOffset=$dirOffset
    certificateStart=$certOffset
    certificateBytes=$certLength
    signedFileBytes=$data.Length
    originalUnsignedBytes=$unsignedSize
    bytesBetweenFooterAndCertificate=($certOffset-$unsignedSize)
    trailingBytesAfterCertificate=($data.Length-$certOffset-$certLength)
  }
  Write-Host "SIGN_CERT_LAYOUT certStart=$certOffset certBytes=$certLength unsignedSize=$unsignedSize trailing=$($certificateLayout.trailingBytesAfterCertificate)"
  $report=Join-Path $art 'signed-inspection-result.json'
  $proc=Start-Process -FilePath $signed -ArgumentList ('--inspect-file "{0}"' -f $report) -PassThru
  try{
    if(!$proc.WaitForExit(50000)){Stop-Process -Id $proc.Id -Force;throw 'SIGN_PROBE_INSPECT_TIMEOUT'}
    $exit=$proc.ExitCode
  }finally{$proc.Dispose()}
  if(!(Test-Path -LiteralPath $report)){throw 'SIGN_PROBE_INSPECTION_REPORT_MISSING'}
  $verified=Get-Content -LiteralPath $report -Raw|ConvertFrom-Json
  [pscustomobject]@{
    schema='IWXA_SETUP_SIGNATURE_DIAGNOSTIC/1'
    releaseAccepted=$false
    ephemeralTestCertificate=$true
    unsignedPackageSha256=(Get-FileHash -LiteralPath $unsigned -Algorithm SHA256).Hash
    signedPackageSha256=(Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash
    authenticodeStatus=[string]$auth.Status
    certificateLayout=$certificateLayout
    nativeInspectExit=$exit
    nativeInspectStatus=$verified.status
    nativeInspectError=$verified.reason
  }|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $art 'setup-sign-compatibility.json')
  Write-Host "IWXA_SETUP_SIGN_AFTER_PACKAGE_AUTHENTICODE=$($auth.Status)"
  Write-Host "IWXA_SETUP_SIGN_AFTER_PACKAGE_INSPECTION=$($verified.status) reason=$($verified.reason)"
  Write-Host 'IWXA_SETUP_SIGN_RELEASE_ACCEPTED=NO'
}finally{
  Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath ('Cert:\CurrentUser\Root\' + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
}
