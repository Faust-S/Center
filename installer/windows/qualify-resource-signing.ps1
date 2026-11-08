# Non-release PE resource feasibility test. Operates on a disposable
# unsigned EXE, embeds the unmodified package, signs with an ephemeral cert.
[CmdletBinding()]param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IwxaResourceProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="BeginUpdateResourceW", SetLastError=true)]
  public static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="UpdateResourceW", SetLastError=true)]
  public static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="EndUpdateResourceW", SetLastError=true)]
  public static extern bool EndUpdateResource(IntPtr handle, bool discard);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="LoadLibraryExW", SetLastError=true)]
  public static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="FindResourceW", SetLastError=true)]
  public static extern IntPtr FindResource(IntPtr handle, IntPtr name, IntPtr type);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern uint SizeofResource(IntPtr handle, IntPtr resource);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr LoadResource(IntPtr handle, IntPtr resource);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr LockResource(IntPtr resourceData);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool FreeLibrary(IntPtr module);
}
'@
$art=Join-Path $env:GITHUB_WORKSPACE 'artifacts'
New-Item -ItemType Directory -Force -Path $art|Out-Null
$stub=Join-Path $art 'resource-probe-stub.exe'
./installer/windows/build-stub.ps1 -Output $stub
$source=Join-Path $art 'resource-probe-signed.exe'
Copy-Item -LiteralPath $stub -Destination $source
$package='accepted/artifacts/iwxa-setup-core-center-0.3-preview.exe'
if(!(Test-Path -LiteralPath $package)){throw 'RESOURCE_PROBE_ACCEPTED_PACKAGE_MISSING'}
$original=[IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $package).Path)
$footerOffset=$original.Length-136
$stubSize=[BitConverter]::ToUInt64($original,$footerOffset+16)
if($stubSize -lt 40000 -or $stubSize -ge $footerOffset){throw 'RESOURCE_PROBE_INPUT_FOOTER_INVALID'}
$payloadLength=$original.Length-[int]$stubSize
$payload=[byte[]]::new($payloadLength)
[Array]::Copy($original,[int]$stubSize,$payload,0,$payloadLength)
$origHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($payload))
$update=[IwxaResourceProbe]::BeginUpdateResource($source,$false)
if($update -eq [IntPtr]::Zero){throw "RESOURCE_PROBE_BEGIN_FAILED $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"}
$success=$false
try{
  $success=[IwxaResourceProbe]::UpdateResource($update,
    [IntPtr]::new(10),[IntPtr]::new(101),0,$payload,[uint32]$payload.Length)
  if(!$success){throw "RESOURCE_PROBE_UPDATE_FAILED $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"}
}finally{
  $ended=[IwxaResourceProbe]::EndUpdateResource($update,!$success)
  if(!$ended){throw 'RESOURCE_PROBE_COMMIT_FAILED'}
}
function ReadResource([string]$exe){
  $module=[IwxaResourceProbe]::LoadLibraryEx($exe,[IntPtr]::Zero,0x00000002)
  if($module -eq [IntPtr]::Zero){throw 'RESOURCE_PROBE_LOAD_FAILED'}
  try {
    $handle=[IwxaResourceProbe]::FindResource($module,[IntPtr]::new(101),[IntPtr]::new(10))
    if($handle -eq [IntPtr]::Zero){throw 'RESOURCE_PROBE_RESOURCE_MISSING'}
    $size=[IwxaResourceProbe]::SizeofResource($module,$handle)
    if($size -ne $payloadLength){throw 'RESOURCE_PROBE_RESOURCE_SIZE_INVALID'}
    $loaded=[IwxaResourceProbe]::LoadResource($module,$handle)
    $pointer=[IwxaResourceProbe]::LockResource($loaded)
    if($pointer -eq [IntPtr]::Zero){throw 'RESOURCE_PROBE_LOCK_FAILED'}
    $bytes=[byte[]]::new([int]$size)
    [Runtime.InteropServices.Marshal]::Copy($pointer,$bytes,0,[int]$size)
    return $bytes
  } finally { [void][IwxaResourceProbe]::FreeLibrary($module) }
}
$embedded=ReadResource $source
$embeddedHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($embedded))
if($embeddedHash -ne $origHash){throw 'RESOURCE_PROBE_UNSIGNED_READBACK_MISMATCH'}
$tool=Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse -File |
  Where-Object {$_.FullName -match '\\x64\\signtool\.exe$'} |
  Sort-Object FullName -Descending|Select-Object -First 1
if(!$tool){throw 'RESOURCE_PROBE_SIGNTOOL_MISSING'}
$cert=New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=IWXA RESOURCE PROBE DEV ONLY' -CertStoreLocation 'Cert:\CurrentUser\My'
try {
  & $tool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $source
  if($LASTEXITCODE -ne 0){throw 'RESOURCE_PROBE_SIGN_FAILED'}
  $signedHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData((ReadResource $source)))
  if($signedHash -ne $origHash){throw 'RESOURCE_PROBE_SIGNED_READBACK_MISMATCH'}
  $signedStatus=Get-AuthenticodeSignature -LiteralPath $source
  [pscustomobject]@{
    schema='IWXA_PE_RESOURCE_SIGN_PROBE/1'
    releaseAccepted=$false
    ephemeralCert=$true
    resourceName='RT_RCDATA_101'
    resourceBytes=$payloadLength
    originalOverlaySha256=$origHash
    signedResourceSha256=$signedHash
    authenticodeStatus=[string]$signedStatus.Status
  }|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $art 'setup-resource-signing-probe.json')
  Write-Host "IWXA_PE_RESOURCE_SIGNED_READBACK_PASS bytes=$payloadLength"
  Write-Host "IWXA_PE_RESOURCE_AUTHENTICODE_STATUS=$($signedStatus.Status)"
}finally{
  Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
}
