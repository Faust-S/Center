# IWXA release signing gate for a PE-resource V2 Windows Setup candidate.
# Requires an existing, trusted code-signing certificate in the Windows store.
# No key material or certificate is generated, imported or stored by this script.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$UnsignedSetupExe,
    [Parameter(Mandatory=$true)][string]$SignedSetupExe,
    [Parameter(Mandatory=$true)][string]$CertificateThumbprint,
    [Parameter(Mandatory=$true)][string]$ExpectedCertificateSubject,
    [Parameter(Mandatory=$true)][string]$ExpectedUnsignedSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedSourceCommit,
    [string]$TimestampServer = 'http://timestamp.digicert.com'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($UnsignedSetupExe)
$target = [IO.Path]::GetFullPath($SignedSetupExe)
$thumbprint = $CertificateThumbprint.Replace(' ','').ToUpperInvariant()
if (![Environment]::Is64BitOperatingSystem) { throw 'SETUP_RELEASE_WINDOWS_X64_REQUIRED' }
if ($source -eq $target) { throw 'SETUP_RELEASE_OUTPUT_MUST_DIFFER' }
if ($thumbprint -notmatch '^[A-F0-9]{40}$' -or
    $ExpectedUnsignedSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
    $ExpectedSourceCommit -notmatch '^[a-f0-9]{40}$') {
    throw 'SETUP_RELEASE_INPUT_IDENTITY_INVALID'
}
if (!(Test-Path -LiteralPath $source -PathType Leaf) -or
    (Test-Path -LiteralPath $target)) {
    throw 'SETUP_RELEASE_SOURCE_MISSING_OR_TARGET_EXISTS'
}
$url = $null
if (![Uri]::TryCreate($TimestampServer, [UriKind]::Absolute, [ref]$url) -or
    $url.Scheme -notin @('http','https')) {
    throw 'SETUP_RELEASE_TIMESTAMP_URL_INVALID'
}
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne
    $ExpectedUnsignedSha256.ToUpperInvariant()) {
    throw 'SETUP_RELEASE_UNSIGNED_HASH_MISMATCH'
}
$cert = Get-ChildItem -Path 'Cert:\CurrentUser\My' |
    Where-Object { $_.Thumbprint -eq $thumbprint } |
    Select-Object -First 1
if ($null -eq $cert) { throw 'SETUP_RELEASE_CERTIFICATE_NOT_IN_USER_STORE' }
if ($cert.Subject -cne $ExpectedCertificateSubject) {
    throw 'SETUP_RELEASE_SIGNER_SUBJECT_MISMATCH'
}
if ($cert.Subject -eq $cert.Issuer) {
    throw 'SETUP_RELEASE_SELF_SIGNED_CERTIFICATE_FORBIDDEN'
}
if (!$cert.HasPrivateKey -or $cert.NotBefore -gt [DateTime]::UtcNow -or
    $cert.NotAfter -lt [DateTime]::UtcNow) {
    throw 'SETUP_RELEASE_SIGNING_KEY_UNAVAILABLE'
}
$codeSigning = $false
foreach ($extension in $cert.Extensions) {
    if ($extension.Oid.Value -ne '2.5.29.37') { continue }
    $eku = [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$extension
    foreach ($oid in $eku.EnhancedKeyUsages) {
        if ($oid.Value -eq '1.3.6.1.5.5.7.3.3') { $codeSigning = $true }
    }
}
if (!$codeSigning) { throw 'SETUP_RELEASE_CERTIFICATE_NOT_CODE_SIGNING' }
$chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
try {
    $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
    if (!$chain.Build($cert)) { throw 'SETUP_RELEASE_SIGNER_CHAIN_NOT_TRUSTED' }
} finally { $chain.Dispose() }

$signTool = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse -File |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending | Select-Object -First 1
if (!$signTool) { throw 'SETUP_RELEASE_SIGNTOOL_MISSING' }

function Inspect([string]$binary,[string]$phase,[string]$mode) {
    $report = Join-Path (Split-Path -Parent $target) ('setup-release-' + $phase + '.json')
    if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force }
    $process = Start-Process -FilePath $binary -ArgumentList ('{0} "{1}"' -f $mode, $report) -PassThru
    try {
        if (!$process.WaitForExit(120000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            throw ('SETUP_RELEASE_NATIVE_TIMEOUT_' + $phase)
        }
        if ($process.ExitCode -ne 0) {
            throw ('SETUP_RELEASE_NATIVE_REJECTED_' + $phase)
        }
    } finally { $process.Dispose() }
    if (!(Test-Path -LiteralPath $report -PathType Leaf)) {
        throw ('SETUP_RELEASE_NATIVE_REPORT_MISSING_' + $phase)
    }
    $result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    if ($result.status -notin @('VERIFIED','STAGED_VERIFIED')) {
        throw ('SETUP_RELEASE_NATIVE_INSPECTION_INVALID_' + $phase)
    }
    return $result
}
New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
$before = Inspect $source 'before-sign' '--inspect-file'
if ($before.packageFormat -ne 'PE_RESOURCE_V2') {
    throw 'SETUP_RELEASE_PE_RESOURCE_V2_REQUIRED'
}
if ($before.sourceCommit -ne $ExpectedSourceCommit) {
    throw 'SETUP_RELEASE_SOURCE_COMMIT_MISMATCH'
}
New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $target
$validated = $false
try {
    & $signTool.FullName sign /fd SHA256 /sha1 $thumbprint /tr $TimestampServer /td SHA256 $target
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_RELEASE_SIGNTOOL_SIGN_FAILED' }
    & $signTool.FullName verify /pa /tw /v $target
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_RELEASE_SIGNTOOL_VERIFY_FAILED' }
    $signature = Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.Status -ne 'Valid' -or
        $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Thumbprint -ne $thumbprint) {
        throw 'SETUP_RELEASE_AUTHENTICODE_NOT_TRUSTED'
    }
    if ($null -eq $signature.TimeStamperCertificate) {
        throw 'SETUP_RELEASE_RFC3161_TIMESTAMP_MISSING'
    }
    $after = Inspect $target 'after-sign' '--inspect-file'
    $staged = Inspect $target 'after-sign-stage' '--stage-test-file'
    if ($after.packageFormat -ne 'PE_RESOURCE_V2' -or
        $after.packageSha256 -ne $before.packageSha256 -or
        $after.sourceCommit -ne $before.sourceCommit -or
        $after.version -ne $before.version -or
        $staged.packageSha256 -ne $before.packageSha256) {
        throw 'SETUP_RELEASE_SIGNED_PACKAGE_CHANGED'
    }
    [pscustomobject]@{
        schema='IWXA_SETUP_TRUSTED_SIGNING_GATE/1'
        status='SIGNATURE_AND_PACKAGE_VERIFIED'
        sourceCommit=$before.sourceCommit
        product=$before.product
        productVersion=$before.version
        packageSha256=$before.packageSha256
        signedSetupSha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        signedSetupBytes=(Get-Item -LiteralPath $target).Length
        signerSubject=$signature.SignerCertificate.Subject
        signerThumbprint=$signature.SignerCertificate.Thumbprint
        timestampSigner=$signature.TimeStamperCertificate.Subject
        authenticodeStatus=[string]$signature.Status
        releaseReady=$false
        humanAccepted=$false
        crossProductRolloutAllowed=$false
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (
        Join-Path (Split-Path -Parent $target) 'setup-release-signing.json')
    $validated = $true
    Write-Host 'IWXA_SETUP_TRUSTED_SIGNING_PACKAGE_GATE_PASS'
    Write-Host 'IWXA_SETUP_RELEASE_READY=NO (separate product and human gates required)'
} finally {
    if (!$validated -and (Test-Path -LiteralPath $target)) {
        Remove-Item -LiteralPath $target -Force
    }
}
