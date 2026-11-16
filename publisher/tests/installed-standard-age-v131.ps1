# Run only with the publisher ORIGINAL Setup Core installation already present.
# age 1.3.1 is the official upstream binary; native T3 owner/DPAPI is not used.
# Keys are ephemeral, not production credentials, and are NEVER reported.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$age=Join-Path $InstallRoot 't3\age.exe'
$keygen=Join-Path $InstallRoot 't3\age-keygen.exe'
foreach($file in @($age,$keygen)){
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)){
    throw 'PUBLISHER_UPSTREAM_AGE_INSTALLED_BINARY_MISSING'
  }
}
$version=(& $age --version | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $version -notmatch '\bv1\.3\.1\b'){
  throw 'PUBLISHER_UPSTREAM_AGE_1_3_1_VERSION_REQUIRED'
}
$temporary=Join-Path ([IO.Path]::GetTempPath()) (
  'iwxa-publisher-age-standard-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporary)|Out-Null
try{
  $secret=Join-Path $temporary 'ephemeral-key.txt'
  $plain=Join-Path $temporary 'synthetic-source.bin'
  $sealed=Join-Path $temporary 'synthetic-ciphertext.age'
  $opened=Join-Path $temporary 'synthetic-restored.bin'
  $bytes=New-Object byte[] 32789
  for($i=0;$i -lt $bytes.Length;$i++){$bytes[$i]=[byte](($i*29+17)%256)}
  [IO.File]::WriteAllBytes($plain,$bytes)
  & $keygen -o $secret *> $null
  if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $secret -PathType Leaf)){
    throw 'PUBLISHER_UPSTREAM_AGE_X25519_KEYGEN_FAILED'
  }
  $recipient=(& $keygen -y $secret | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or
     $recipient -notmatch '^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$'){
    throw 'PUBLISHER_UPSTREAM_AGE_X25519_RECIPIENT_INVALID'
  }
  & $age -r $recipient -o $sealed $plain
  if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sealed -PathType Leaf)){
    throw 'PUBLISHER_UPSTREAM_AGE_ENCRYPT_FAILED'
  }
  & $age -d -i $secret -o $opened $sealed
  if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $opened -PathType Leaf)){
    throw 'PUBLISHER_UPSTREAM_AGE_DECRYPT_FAILED'
  }
  $plainHash=(Get-FileHash -LiteralPath $plain -Algorithm SHA256).Hash
  $openedHash=(Get-FileHash -LiteralPath $opened -Algorithm SHA256).Hash
  $sealedHash=(Get-FileHash -LiteralPath $sealed -Algorithm SHA256).Hash
  if($plainHash -ne $openedHash -or $plainHash -eq $sealedHash -or
     (Get-Item -LiteralPath $opened).Length -ne $bytes.Length){
    throw 'PUBLISHER_UPSTREAM_AGE_X25519_BYTES_MISMATCH'
  }
  Write-Host 'PUBLISHER_INSTALLED_UPSTREAM_AGE_1_3_1_X25519_ROUNDTRIP_PASS'
}finally{
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
