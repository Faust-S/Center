# Native Windows x64 WebView2 first-use acceptance.
# Run ONLY in a disposable interactive VM with a genuinely absent Runtime.
# In Offline mode disconnect the VM in the hypervisor BEFORE running.
# A networked VM is NOT valid evidence for an offline first install.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SetupExe,
    [ValidateSet('Online','Offline')][string]$Mode = 'Offline',
    [string]$StandaloneInstaller = '',
    [string]$ExpectedProductId = '',
    [Parameter(Mandatory=$true)][string]$ExpectedGuiAccessibleName,
    [string]$ReportDirectory = 'artifacts/webview2-clean-windows'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$reports = [IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Path $reports -Force | Out-Null
$reportPath = Join-Path $reports 'qualification.json'
$phase = 'PRECONDITION'
$setupHash = ''
$offlineVerified = $false
$sourceCommit = ''
$product = ''
$runtimeVersion = ''
$guiElementFound = $false
$cleanupPassed = $false
$offlineProof = $null

function Write-Qualification([string]$status, [string]$reason) {
    [pscustomobject]@{
        schema = 'IWXA_WEBVIEW2_CLEAN_WINDOWS/2'
        status = $status
        reason = $reason
        phase = $phase
        mode = $Mode
        product = $product
        setupSha256 = $setupHash
        sourceCommit = $sourceCommit
        runtimeVersion = $runtimeVersion
        runtimeAbsentBefore = $status -eq 'PASS'
        installedBySetup = $status -eq 'PASS'
        runtimeVerifiedAfter = $status -eq 'PASS'
        installedProductGuiOpened = $guiElementFound
        guiWitness = $ExpectedGuiAccessibleName
        productUninstallQualified = $cleanupPassed
        offlineNetworkIsolationVerified = $offlineVerified
        offlineEvidence = $offlineProof
        trustedIwxaPublisherVerified = $false
        humanAccepted = $false
        windowsVersion = [Environment]::OSVersion.VersionString
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
}

function Assert-OfflineNetworkIsolation {
    # Check both address families and fail closed. Do not disable adapters
    # remotely: an external hypervisor controls isolation of the disposable VM.
    $ipv4 = @(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction Stop |
        Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' })
    $ipv6 = @(Get-NetRoute -AddressFamily IPv6 -PolicyStore ActiveStore -ErrorAction Stop |
        Where-Object { $_.DestinationPrefix -eq '::/0' })
    if ($ipv4.Count -gt 0 -or $ipv6.Count -gt 0) {
        throw 'WEBVIEW2_CLEAN_VM_OFFLINE_DEFAULT_ROUTE_PRESENT'
    }
    # A proxy reachable via a non-default route would also invalidate offline
    # evidence; ask the Windows networking stack to try an actual HTTPS URL.
    $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create(
        'https://go.microsoft.com/fwlink/p/?LinkId=2124703')
    $request.Timeout = 4000
    $request.ReadWriteTimeout = 4000
    $request.AllowAutoRedirect = $false
    $request.CachePolicy = [System.Net.Cache.RequestCachePolicy]::new(
        [System.Net.Cache.RequestCacheLevel]::NoCacheNoStore)
    $blocked = $false
    try {
        $response = $request.GetResponse()
        try { throw 'WEBVIEW2_CLEAN_VM_OFFLINE_HTTPS_REACHABLE' }
        finally { $response.Dispose() }
    }
    catch [System.Net.WebException] {
        $allowed = @(
            [System.Net.WebExceptionStatus]::ConnectFailure,
            [System.Net.WebExceptionStatus]::NameResolutionFailure,
            [System.Net.WebExceptionStatus]::ProxyNameResolutionFailure,
            [System.Net.WebExceptionStatus]::Timeout,
            [System.Net.WebExceptionStatus]::NetworkFailure
        )
        if ($_.Exception.Status -notin $allowed) {
            throw 'WEBVIEW2_CLEAN_VM_OFFLINE_NETWORK_UNCERTAIN'
        }
        $blocked = $true
    }
    if (!$blocked) { throw 'WEBVIEW2_CLEAN_VM_OFFLINE_NETWORK_NOT_PROVEN' }
    return [pscustomobject]@{
        networkDefaultRoutesIPv4 = 0
        networkDefaultRoutesIPv6 = 0
        microsoftHttpsProbe = 'UNREACHABLE'
        isolationMethod = 'OPERATOR_DISCONNECTED_VM'
    }
}

function Invoke-SetupJson([string]$action,[string]$tag,[string]$parameter='') {
    $target = Join-Path $reports ($tag + '.json')
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    $arguments = if ($parameter) {
        '{0} "{1}" "{2}"' -f $action, $parameter, $target
    } else { '{0} "{1}"' -f $action, $target }
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

function Capture-GuiEvidence([IntPtr]$handle) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $bounds = [System.Windows.Forms.Screen]::FromHandle($handle).Bounds
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $drawing = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $drawing.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty,
            $bitmap.Size)
        $bitmap.Save((Join-Path $reports 'first-launch-windows.png'),
            [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $drawing.Dispose()
        $bitmap.Dispose()
    }
}

try {
    $setup = [IO.Path]::GetFullPath($SetupExe)
    if (!(Test-Path -LiteralPath $setup -PathType Leaf)) {
        throw 'WEBVIEW2_CLEAN_VM_SETUP_MISSING'
    }
    if ($Mode -eq 'Offline' -and
        !(Test-Path -LiteralPath $StandaloneInstaller -PathType Leaf)) {
        throw 'WEBVIEW2_CLEAN_VM_STANDALONE_INSTALLER_MISSING'
    }
    if (![Environment]::Is64BitOperatingSystem) {
        throw 'WEBVIEW2_CLEAN_VM_REQUIRES_X64'
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedGuiAccessibleName)) {
        throw 'WEBVIEW2_CLEAN_VM_GUI_WITNESS_REQUIRED'
    }
    $setupHash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
    $phase = 'PACKAGE_IDENTITY'
    $identity = Invoke-SetupJson '--inspect-file' 'package-identity'
    $product = [string]$identity.product
    $sourceCommit = [string]$identity.sourceCommit
    if ($identity.status -ne 'VERIFIED' -or
        $identity.architecture -ne 'windows-x64' -or
        $identity.packageFormat -ne 'PE_RESOURCE_V2' -or
        !$identity.requiresWebView2 -or
        !$identity.entrypoint -or
        ($ExpectedProductId -and $product -ne $ExpectedProductId)) {
        throw 'WEBVIEW2_CLEAN_VM_UNEXPECTED_PRODUCT_PACKAGE'
    }
    $phase = 'RUNTIME_ABSENCE'
    $before = Invoke-SetupJson '--preflight-file' 'before-dependency'
    if ($before.status -ne 'WEBVIEW2_MISSING' -or $before.webview2Version) {
        throw 'WEBVIEW2_CLEAN_VM_REQUIRED_RUNTIME_ALREADY_PRESENT_OR_UNEXPECTED_STATE'
    }
    if ($Mode -eq 'Offline') {
        $phase = 'OFFLINE_EGRESS_CHECK_BEFORE'
        $offlineProof = Assert-OfflineNetworkIsolation
        $offlineVerified = $true
        $phase = 'OFFLINE_INSTALLER_SIGNATURE'
        $verified = Invoke-SetupJson '--verify-webview2-standalone-file' 'standalone-signature' $StandaloneInstaller
        if ($verified.status -ne 'WEBVIEW2_MICROSOFT_OFFLINE_CANDIDATE_VERIFIED') {
            throw 'WEBVIEW2_CLEAN_VM_STANDALONE_NOT_AUTHENTICATED'
        }
        $phase = 'OFFLINE_INSTALL_RUNTIME'
        $installedRuntime = Invoke-SetupJson '--ensure-webview2-offline-file' 'install-runtime-offline' $StandaloneInstaller
    } else {
        $phase = 'ONLINE_INSTALL_RUNTIME'
        $installedRuntime = Invoke-SetupJson '--ensure-webview2-file' 'install-runtime-online'
    }
    $runtimeVersion = [string]$installedRuntime.webview2Version
    if ($installedRuntime.status -ne 'WEBVIEW2_INSTALLED_VERIFIED' -or
        !$runtimeVersion) {
        throw 'WEBVIEW2_CLEAN_VM_RUNTIME_NOT_INSTALLED_BY_SETUP'
    }
    $phase = 'DEPENDENCY_RECHECK'
    $after = Invoke-SetupJson '--preflight-file' 'after-dependency'
    if ($after.status -ne 'READY_FOR_FIRST_INSTALL' -or
        !$after.webview2Version -or $after.webview2Version -ne $runtimeVersion) {
        throw 'WEBVIEW2_CLEAN_VM_RUNTIME_NOT_READY'
    }
    if ($Mode -eq 'Offline') {
        $phase = 'OFFLINE_EGRESS_CHECK_AFTER'
        $offlineProof = Assert-OfflineNetworkIsolation
        $offlineVerified = $true
    }
    $installed = $false
    try {
        $phase = 'PRODUCT_FIRST_INSTALL'
        $first = Invoke-SetupJson '--install-file' 'install-product'
        if ($first.status -ne 'INSTALLED_NOT_LAUNCHED') {
            throw 'WEBVIEW2_CLEAN_VM_PRODUCT_INSTALL_FAILED'
        }
        $installed = $true
        $application = Join-Path $first.installRoot (
            ([string]$identity.entrypoint).Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (!(Test-Path -LiteralPath $application -PathType Leaf)) {
            throw 'WEBVIEW2_CLEAN_VM_INSTALLED_APP_MISSING'
        }
        $phase = 'REAL_GUI_CONTENT'
        Add-Type -AssemblyName UIAutomationClient
        $app = Start-Process -FilePath $application -WorkingDirectory $first.installRoot -PassThru
        try {
            $opened = $false
            for ($i=0; $i -lt 90; $i++) {
                Start-Sleep -Milliseconds 750
                $app.Refresh()
                if ($app.HasExited) { break }
                if ($app.MainWindowHandle -eq [IntPtr]::Zero) { continue }
                $opened = $true
                $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
                $condition = [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::NameProperty,
                    $ExpectedGuiAccessibleName)
                $found = $root.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants, $condition)
                foreach ($control in $found) {
                    if (!$control.Current.IsOffscreen) {
                        $guiElementFound = $true
                        break
                    }
                }
                if ($guiElementFound) { break }
            }
            if (!$opened) { throw 'WEBVIEW2_CLEAN_VM_APP_GUI_NOT_OPENED' }
            Capture-GuiEvidence $app.MainWindowHandle
            if (!$guiElementFound) {
                throw 'WEBVIEW2_CLEAN_VM_APP_CONTENT_NOT_FOUND'
            }
        } finally {
            if (!$app.HasExited) {
                [void]$app.CloseMainWindow()
                if (!$app.WaitForExit(15000)) {
                    Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
                }
            }
            $app.Dispose()
        }
    } finally {
        if ($installed) {
            $phase = 'PRODUCT_UNINSTALL'
            $removed = Invoke-SetupJson '--uninstall-file' 'remove-qualification-product'
            if ($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED') {
                throw 'WEBVIEW2_CLEAN_VM_PRODUCT_CLEANUP_FAILED'
            }
            $cleanupPassed = $true
        }
        # The Microsoft shared Runtime remains installed after testing.
    }
    $phase = 'COMPLETED'
    Write-Qualification 'PASS' ''
    Write-Host "IWXA_WEBVIEW2_CLEAN_WINDOWS_FIRST_INSTALL_PASS mode=$Mode runtime=$runtimeVersion product=$product"
} catch {
    $errorMessage = $_.Exception.Message
    try { Write-Qualification 'NOT_QUALIFIED' $errorMessage }
    catch { Write-Warning "WEBVIEW2_QUALIFICATION_REPORT_WRITE_FAILED $($_.Exception.Message)" }
    throw
}

