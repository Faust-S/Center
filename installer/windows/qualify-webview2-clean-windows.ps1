# Windows-native qualification: execute only in a disposable interactive
# Windows x64 environment that has NEVER installed WebView2 Runtime.
# A machine where Runtime is already present fails closed, never counts as PASS.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SetupExe,
    [ValidateSet('Online','Offline')][string]$Mode = 'Offline',
    [string]$StandaloneInstaller = '',
    [string]$ReportDirectory = 'artifacts/webview2-clean-windows'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$setup = [IO.Path]::GetFullPath($SetupExe)
$reports = [IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Path $reports -Force | Out-Null
if (!(Test-Path -LiteralPath $setup -PathType Leaf)) { throw 'WEBVIEW2_CLEAN_VM_SETUP_MISSING' }
if ($Mode -eq 'Offline' -and !(Test-Path -LiteralPath $StandaloneInstaller -PathType Leaf)) {
    throw 'WEBVIEW2_CLEAN_VM_STANDALONE_INSTALLER_MISSING'
}
if (![Environment]::Is64BitOperatingSystem) { throw 'WEBVIEW2_CLEAN_VM_REQUIRES_X64' }

function Invoke-SetupJson([string]$action,[string]$tag,[string]$parameter='') {
    $target = Join-Path $reports ($tag + '.json')
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    $arguments = if ($parameter) {
        '{0} "{1}" "{2}"' -f $action, $parameter, $target
    } else {
        '{0} "{1}"' -f $action, $target
    }
    $process = Start-Process -FilePath $setup -ArgumentList $arguments -PassThru
    try {
        if (!$process.WaitForExit(240000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            throw ('WEBVIEW2_CLEAN_VM_TIMEOUT_' + $tag)
        }
        $exit = $process.ExitCode
    } finally { $process.Dispose() }
    if (!(Test-Path -LiteralPath $target -PathType Leaf)) {
        throw ('WEBVIEW2_CLEAN_VM_REPORT_MISSING_' + $tag)
    }
    $result = Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
    if ($exit -ne 0) {
        throw ('WEBVIEW2_CLEAN_VM_ACTION_FAILED_{0}: {1}' -f $tag, $result.reason)
    }
    return $result
}
$setupHash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
$identity = Invoke-SetupJson '--inspect-file' 'package-identity'
if ($identity.status -ne 'VERIFIED' -or $identity.architecture -ne 'windows-x64' -or
    $identity.product -ne 'iwxa.admin-center') {
    throw 'WEBVIEW2_CLEAN_VM_UNEXPECTED_PRODUCT_PACKAGE'
}
$before = Invoke-SetupJson '--preflight-file' 'before-dependency'
if ($before.status -ne 'WEBVIEW2_MISSING' -or $before.webview2Version) {
    [pscustomobject]@{
        schema='IWXA_WEBVIEW2_CLEAN_WINDOWS/1'; status='NOT_QUALIFIED'
        reason='WEBVIEW2_WAS_PRESENT_BEFORE_TEST'; detectedStatus=$before.status
        detectedVersion=$before.webview2Version; setupSha256=$setupHash
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reports 'qualification.json')
    throw 'WEBVIEW2_CLEAN_VM_REQUIRED_RUNTIME_ALREADY_PRESENT'
}
if ($Mode -eq 'Offline') {
    $verified = Invoke-SetupJson '--verify-webview2-installer-file' 'standalone-signature' $StandaloneInstaller
    if ($verified.status -ne 'WEBVIEW2_MICROSOFT_INSTALLER_VERIFIED') {
        throw 'WEBVIEW2_CLEAN_VM_STANDALONE_NOT_AUTHENTICATED'
    }
    $installedRuntime = Invoke-SetupJson '--ensure-webview2-offline-file' 'install-runtime-offline' $StandaloneInstaller
} else {
    $installedRuntime = Invoke-SetupJson '--ensure-webview2-file' 'install-runtime-online'
}
if ($installedRuntime.status -ne 'WEBVIEW2_INSTALLED_VERIFIED' -or !$installedRuntime.webview2Version) {
    throw 'WEBVIEW2_CLEAN_VM_RUNTIME_NOT_INSTALLED_BY_SETUP'
}
$after = Invoke-SetupJson '--preflight-file' 'after-dependency'
if ($after.status -ne 'READY_FOR_FIRST_INSTALL' -or !$after.webview2Version) {
    throw 'WEBVIEW2_CLEAN_VM_RUNTIME_NOT_READY'
}
$installed = $false
try {
    $first = Invoke-SetupJson '--install-file' 'install-product'
    if ($first.status -ne 'INSTALLED_NOT_LAUNCHED') {
        throw 'WEBVIEW2_CLEAN_VM_PRODUCT_INSTALL_FAILED'
    }
    $installed = $true
    $application = Join-Path $first.installRoot 'iwxa-admin-center.exe'
    if (!(Test-Path -LiteralPath $application -PathType Leaf)) {
        throw 'WEBVIEW2_CLEAN_VM_INSTALLED_APP_MISSING'
    }
    $app = Start-Process -FilePath $application -WorkingDirectory $first.installRoot -PassThru
    try {
        $opened = $false
        for ($i=0; $i -lt 90; $i++) {
            Start-Sleep -Milliseconds 750
            $app.Refresh()
            if ($app.HasExited) { break }
            if ($app.MainWindowHandle -ne [IntPtr]::Zero) { $opened = $true; break }
        }
        if (!$opened) { throw 'WEBVIEW2_CLEAN_VM_APP_GUI_NOT_OPENED' }
    } finally {
        if (!$app.HasExited) {
            [void]$app.CloseMainWindow()
            if (!$app.WaitForExit(15000)) {
                Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
            }
        }
        $app.Dispose()
    }
    [pscustomobject]@{
        schema='IWXA_WEBVIEW2_CLEAN_WINDOWS/1'; status='PASS'
        mode=$Mode; runtimeAbsentBefore=$true; installedBySetup=$true
        runtimeVersion=$installedRuntime.webview2Version
        runtimeVerifiedAfter=$true; installedProductGuiOpened=$true
        setupSha256=$setupHash; sourceCommit=$identity.sourceCommit
        product=$identity.product; windowsVersion=[Environment]::OSVersion.VersionString
        offlineNetworkIsolationVerified=$false
        trustedIwxaPublisherVerified=$false; humanAccepted=$false
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reports 'qualification.json')
    Write-Host "IWXA_WEBVIEW2_CLEAN_WINDOWS_FIRST_INSTALL_PASS mode=$Mode runtime=$($installedRuntime.webview2Version)"
} finally {
    if ($installed) {
        $removed = Invoke-SetupJson '--uninstall-file' 'remove-qualification-product'
        if ($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED') {
            throw 'WEBVIEW2_CLEAN_VM_PRODUCT_CLEANUP_FAILED'
        }
    }
    # Shared Microsoft Runtime remains installed after testing.
}
