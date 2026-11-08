# Windows-native acceptance of signed PE-resource V2. The temporary
# self-signed certificate is deliberately NOT trusted for an IWXA release.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $root
try {
    $artifact = Join-Path $root 'artifacts'
    $unsigned = Join-Path $artifact 'iwxa-setup-core-resource-v2.exe'
    $signed = Join-Path $artifact 'setup-core-v2-diagnostic-signed.exe'
    $upgrade = Join-Path $artifact 'setup-core-v2-diagnostic-upgrade.exe'
    $profile = Join-Path $root 'installer/products/center.json'
    $profileNext = Join-Path $artifact 'setup-core-v2-diagnostic-profile.json'
    $stub = Join-Path $artifact 'iwxa-setup-core-stub.exe'
    $payload = Join-Path $artifact 'setup-core-test-payload'
    $head = [string]$env:GITHUB_SHA
    $tree = [string](& git rev-parse 'HEAD^{tree}').Trim()
    $product = Get-Content -LiteralPath $profile -Raw | ConvertFrom-Json
    $installRoot = Join-Path $env:LOCALAPPDATA ('Programs/' + $product.install_dir)
    $previous = $installRoot + '.iwxa-previous'
    $data = Join-Path $env:LOCALAPPDATA ($product.data_namespace + '/setup-core-v2-preserved.txt')
    if ($head -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$') {
        throw 'SETUP_V2_SOURCE_IDENTITY_MISSING'
    }
    if (!(Test-Path -LiteralPath $unsigned -PathType Leaf) -or
        !(Test-Path -LiteralPath $stub -PathType Leaf) -or
        !(Test-Path -LiteralPath $payload -PathType Container)) {
        throw 'SETUP_V2_NATIVE_PREREQUISITES_MISSING'
    }
    if (Test-Path -LiteralPath $installRoot) {
        throw 'SETUP_V2_INSTALL_ROOT_NOT_CLEAN'
    }
    function Invoke-Setup([string]$binary, [string]$action, [string]$tag) {
        $report = Join-Path $artifact ('setup-core-v2-diagnostic-' + $tag + '.json')
        if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force }
        $proc = Start-Process -FilePath $binary -ArgumentList ('{0} "{1}"' -f $action, $report) -PassThru
        try {
            if (!$proc.WaitForExit(120000)) {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                throw ('SETUP_V2_TIMEOUT_' + $tag)
            }
            if ($proc.ExitCode -ne 0) {
                throw ('SETUP_V2_EXIT_{0}_{1}' -f $tag, $proc.ExitCode)
            }
        } finally { $proc.Dispose() }
        if (!(Test-Path -LiteralPath $report -PathType Leaf)) {
            throw ('SETUP_V2_REPORT_MISSING_' + $tag)
        }
        return Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    }
    function Expect([object]$result, [string]$status, [string]$tag) {
        if ($result.status -ne $status) {
            throw ('SETUP_V2_{0}_EXPECTED_{1}_GOT_{2}' -f $tag, $status, $result.status)
        }
    }
    $signerTool = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse -File |
        Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (!$signerTool) { throw 'SETUP_V2_SIGNTOOL_MISSING' }
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -HashAlgorithm SHA256 -Subject 'CN=IWXA Setup V2 TEST ONLY' -CertStoreLocation 'Cert:\CurrentUser\My'
    try {
        Copy-Item -LiteralPath $unsigned -Destination $signed -Force
        & $signerTool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $signed
        if ($LASTEXITCODE -ne 0) { throw 'SETUP_V2_SIGN_FAILED' }
        $auth = Get-AuthenticodeSignature -LiteralPath $signed
        if ($null -eq $auth.SignerCertificate -or
            $auth.SignerCertificate.Thumbprint -ne $cert.Thumbprint) {
            throw 'SETUP_V2_TEST_CERTIFICATE_MISMATCH'
        }
        $identity = Invoke-Setup $signed '--inspect-file' 'signed-inspect'
        Expect $identity 'VERIFIED' 'SIGNED_INSPECT'
        if ($identity.product -ne $product.id -or $identity.version -ne $product.version -or
            $identity.sourceCommit -ne $head) {
            throw 'SETUP_V2_SIGNED_IDENTITY_INVALID'
        }
        $staged = Invoke-Setup $signed '--stage-test-file' 'signed-stage'
        Expect $staged 'STAGED_VERIFIED' 'SIGNED_STAGE'
        if ($staged.packageSha256 -ne $identity.packageSha256) {
            throw 'SETUP_V2_SIGNED_STAGE_HASH_CHANGED'
        }
        $next = Get-Content -LiteralPath $profile -Raw | ConvertFrom-Json
        $next.version = '0.3.0-dev.2'
        $next | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $profileNext -Encoding utf8
        $argsNext = @('-m','installer.build_bundle','build-resource','--product',$profileNext,
            '--payload',$payload,'--stub',$stub,'--output',$upgrade,
            '--source-commit',$head,'--source-tree',$tree)
        $details = & python @argsNext
        if ($LASTEXITCODE -ne 0) { throw 'SETUP_V2_UPGRADE_BUILD_FAILED' }
        if ((($details | Out-String) | ConvertFrom-Json).format -ne 'PE_RESOURCE_V2') {
            throw 'SETUP_V2_UPGRADE_NOT_PE_RESOURCE'
        }
        & $signerTool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $upgrade
        if ($LASTEXITCODE -ne 0) { throw 'SETUP_V2_UPGRADE_SIGN_FAILED' }
        $newIdentity = Invoke-Setup $upgrade '--inspect-file' 'upgrade-inspect'
        Expect $newIdentity 'VERIFIED' 'UPGRADE_INSPECT'
        if ($newIdentity.version -ne '0.3.0-dev.2' -or
            $newIdentity.packageSha256 -ne $identity.packageSha256) {
            throw 'SETUP_V2_UPGRADE_IDENTITY_CHANGED'
        }
        if (Test-Path -LiteralPath $data) {
            throw 'SETUP_V2_USER_DATA_FIXTURE_CONFLICT'
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $data) | Out-Null
        [IO.File]::WriteAllText($data, 'signed-v2-user-data-unchanged')
        $installed = $false
        try {
            $check = Invoke-Setup $signed '--preflight-file' 'first-preflight'
            Expect $check 'READY_FOR_FIRST_INSTALL' 'PREFLIGHT'
            $fresh = Invoke-Setup $signed '--install-file' 'first-install'
            Expect $fresh 'INSTALLED_NOT_LAUNCHED' 'FIRST_INSTALL'
            $installed = $true
            $installRoot = $fresh.installRoot
            $app = Join-Path $installRoot ($product.entrypoint -replace '/', '\')
            $uninstaller = Join-Path $installRoot 'IWXA.SetupCore.Uninstall.exe'
            if (!(Test-Path -LiteralPath $app -PathType Leaf) -or
                (Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash) {
                throw 'SETUP_V2_INSTALLED_BINARY_OR_SIGNATURE_COPY_INVALID'
            }
            $clean = (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash
            $plan = Invoke-Setup $upgrade '--upgrade-plan-file' 'upgrade-plan'
            Expect $plan 'UPGRADE_CANDIDATE_NOT_ACTIVATED' 'UPGRADE_PLAN'
            $changed = Invoke-Setup $upgrade '--upgrade-file' 'upgrade'
            Expect $changed 'UPGRADED_BACKUP_RETAINED' 'UPGRADE'
            if (!(Test-Path -LiteralPath $previous -PathType Container) -or
                (Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $upgrade -Algorithm SHA256).Hash) {
                throw 'SETUP_V2_UPGRADE_NOT_PERSISTED'
            }
            $pending = Invoke-Setup $upgrade '--upgrade-plan-file' 'pending-plan'
            Expect $pending 'UPGRADE_PENDING_CONFIRMATION' 'PENDING'
            $rolled = Invoke-Setup $upgrade '--rollback-upgrade-file' 'rollback'
            Expect $rolled 'ROLLBACK_RESTORED_PREVIOUS' 'ROLLBACK'
            if ((Test-Path -LiteralPath $previous) -or
                (Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash) {
                throw 'SETUP_V2_ROLLBACK_NOT_ORIGINAL'
            }
            $handle = [IO.File]::Open($app, [IO.FileMode]::Open,
                [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            try {
                [void]$handle.Seek(4096, [IO.SeekOrigin]::Begin)
                $value = $handle.ReadByte()
                if ($value -lt 0) { throw 'SETUP_V2_APP_TOO_SMALL' }
                [void]$handle.Seek(4096, [IO.SeekOrigin]::Begin)
                $handle.WriteByte([byte]($value -bxor 1))
            } finally { $handle.Dispose() }
            if ((Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -eq $clean) {
                throw 'SETUP_V2_REPAIR_INPUT_NOT_CORRUPTED'
            }
            $repaired = Invoke-Setup $signed '--repair-file' 'repair'
            Expect $repaired 'REPAIRED_BACKUP_RETAINED' 'REPAIR'
            if ((Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne $clean) {
                throw 'SETUP_V2_REPAIR_DID_NOT_RESTORE_APP'
            }
            $confirmed = Invoke-Setup $signed '--confirm-upgrade-file' 'repair-confirm'
            Expect $confirmed 'UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED' 'REPAIR_CONFIRM'
            if (Test-Path -LiteralPath $previous) {
                throw 'SETUP_V2_REPAIR_BACKUP_NOT_REMOVED'
            }
            if ([IO.File]::ReadAllText($data) -ne 'signed-v2-user-data-unchanged') {
                throw 'SETUP_V2_USER_DATA_MODIFIED'
            }
            $removed = Invoke-Setup $signed '--uninstall-file' 'uninstall'
            Expect $removed 'UNINSTALLED_USER_DATA_PRESERVED' 'UNINSTALL'
            $installed = $false
            if (Test-Path -LiteralPath $installRoot) {
                throw 'SETUP_V2_UNINSTALL_ROOT_REMAINS'
            }
            if ([IO.File]::ReadAllText($data) -ne 'signed-v2-user-data-unchanged') {
                throw 'SETUP_V2_UNINSTALL_USER_DATA_CHANGED'
            }
        } finally {
            if ($installed) { Write-Warning 'V2 did not complete cleanup; keep failure evidence' }
            if (Test-Path -LiteralPath $data) {
                Remove-Item -LiteralPath $data -Force
            }
        }
        [pscustomobject]@{
            schema = 'IWXA_SIGNED_V2_NATIVE_LIFECYCLE/1'
            sourceCommit = $head
            setupFormat = 'PE_RESOURCE_V2'
            ephemeralSelfSignedCertificate = $true
            authenticodeStatus = [string]$auth.Status
            packageSha256 = $identity.packageSha256
            signedSetupSha256 = (Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash
            signedUpgradeSha256 = (Get-FileHash -LiteralPath $upgrade -Algorithm SHA256).Hash
            firstInstall = 'PASS'
            upgrade = 'PASS'
            rollback = 'PASS'
            sameVersionRepair = 'PASS'
            repairConfirm = 'PASS'
            uninstall = 'PASS'
            userDataPreserved = $true
            trustedIwxaPublisher = $false
            releaseAccepted = $false
            humanAccepted = $false
        } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (
            Join-Path $artifact 'setup-core-v2-diagnostic-lifecycle.json')
        Write-Host 'IWXA_SETUP_SIGNED_V2_NATIVE_LIFECYCLE_PASS'
        Write-Host 'IWXA_SETUP_SIGNED_V2_RELEASE_ACCEPTED=NO (test certificate only)'
    } finally {
        Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
    }
} finally { Pop-Location }
