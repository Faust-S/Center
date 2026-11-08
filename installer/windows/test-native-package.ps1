[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $root
try {
    $artifact = Join-Path $root 'artifacts'
    New-Item -ItemType Directory -Path $artifact -Force | Out-Null
    $stub = Join-Path $artifact 'iwxa-setup-core-stub.exe'
    $bundle = Join-Path $artifact 'iwxa-setup-core-center-0.3-preview.exe'
    $payload = Join-Path $artifact 'setup-core-test-payload'
    $report = Join-Path $artifact 'setup-core-native-inspection.json'
    $damaged = Join-Path $artifact 'setup-core-tampered.exe'
    $badReport = Join-Path $artifact 'setup-core-tampered-report.json'
    $exe = Join-Path $root 'src-tauri/target/release/iwxa-admin-center.exe'
    if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'SETUP_CENTER_EXE_MISSING' }

    & (Join-Path $PSScriptRoot 'build-stub.ps1') -Output $stub
    $profile = Join-Path $root 'installer/products/center.json'
    $product = Get-Content -LiteralPath $profile -Raw | ConvertFrom-Json
    if ($product.version -ne '0.3.0-dev.1') { throw 'SETUP_PRODUCT_VERSION_MISMATCH' }

    New-Item -ItemType Directory -Path $payload -Force | Out-Null
    Copy-Item -LiteralPath $exe -Destination (Join-Path $payload 'iwxa-admin-center.exe') -Force
    $sourceHead = [string]$env:GITHUB_SHA
    $sourceTree = [string](& git rev-parse 'HEAD^{tree}').Trim()
    if ($sourceHead -notmatch '^[0-9a-f]{40}$' -or $sourceTree -notmatch '^[0-9a-f]{40}$') {
        throw 'SETUP_SOURCE_IDENTITY_MISSING'
    }

    $arguments = @(
        '-m', 'installer.build_bundle', 'build',
        '--product', $profile, '--payload', $payload, '--stub', $stub,
        '--output', $bundle, '--source-commit', $sourceHead, '--source-tree', $sourceTree
    )
    $details = & python @arguments
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_BUNDLE_BUILD_FAILED' }
    $manifest = $details | ConvertFrom-Json
    if ($manifest.status -ne 'VERIFIED' -or $manifest.product -ne 'iwxa.admin-center') {
        throw 'SETUP_BUNDLE_MANIFEST_INVALID'
    }

    function Invoke-NativeInspection([string]$binary, [string]$jsonPath, [int]$expected) {
        $cmd = Start-Process -FilePath $binary -ArgumentList ('--inspect-file "{0}"' -f $jsonPath) -PassThru
        try {
            if (!$cmd.WaitForExit(90000)) {
                Stop-Process -Id $cmd.Id -Force -ErrorAction SilentlyContinue
                throw 'SETUP_NATIVE_INSPECTION_TIMEOUT'
            }
            if ($cmd.ExitCode -ne $expected) {
                throw ('SETUP_NATIVE_INSPECTION_EXIT actual={0} expected={1}' -f $cmd.ExitCode, $expected)
            }
        } finally { $cmd.Dispose() }
        if (!(Test-Path -LiteralPath $jsonPath -PathType Leaf)) {
            throw 'SETUP_NATIVE_INSPECTION_REPORT_MISSING'
        }
        return Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
    }

    $native = Invoke-NativeInspection $bundle $report 0
    if ($native.status -ne 'VERIFIED' -or $native.product -ne $manifest.product -or
        $native.version -ne '0.3.0-dev.1' -or $native.sourceCommit -ne $sourceHead -or
        $native.packageSha256 -ne $manifest.payload_sha256 -or $native.files -ne $manifest.file_count) {
        throw 'SETUP_NATIVE_PYTHON_DISAGREEMENT'
    }
    Write-Host "IWXA_SETUP_NATIVE_PACKAGE_PASS files=$($native.files) version=$($native.version)"

    # Mutate the authenticated ZIP overlay without touching the PE executable.
    $bytes = [IO.File]::ReadAllBytes($bundle)
    $start = [int][BitConverter]::ToUInt64($bytes, ($bytes.Length - 136 + 16))
    if ($start -le 1024 -or $start + 40 -ge $bytes.Length - 136) {
        throw 'SETUP_TAMPER_TEST_LAYOUT_INVALID'
    }
    $bytes[$start + 40] = [byte]($bytes[$start + 40] -bxor 1)
    [IO.File]::WriteAllBytes($damaged, $bytes)
    $rejected = Invoke-NativeInspection $damaged $badReport 2
    if ($rejected.status -ne 'ERROR' -or $rejected.reason -ne 'SETUP_PACKAGE_HASH_INVALID') {
        throw 'SETUP_NATIVE_TAMPER_ACCEPTED'
    }
    Write-Host 'IWXA_SETUP_NATIVE_TAMPER_REJECTED_PASS'

    # The native form is not an installer yet; check real Windows GUI / title.
    $gui = Start-Process -FilePath $bundle -PassThru
    try {
        $found = $false
        for ($i = 0; $i -lt 45; $i++) {
            Start-Sleep -Milliseconds 500
            $gui.Refresh()
            if ($gui.HasExited) { throw 'SETUP_GUI_EXITED_BEFORE_DISPLAY' }
            if ($gui.MainWindowHandle -ne [IntPtr]::Zero -and
                $gui.MainWindowTitle -like '*IWXA Admin Center*') {
                $found = $true
                break
            }
        }
        if (!$found) { throw 'SETUP_GUI_PRODUCT_NAME_NOT_VISIBLE' }
        Write-Host "IWXA_SETUP_NATIVE_GUI_PASS title=$($gui.MainWindowTitle)"
    } finally {
        if (!$gui.HasExited) {
            $null = $gui.CloseMainWindow()
            if (!$gui.WaitForExit(10000)) {
                Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue
            }
        }
        $gui.Dispose()
    }
    $hash = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash
    Write-Host "IWXA_SETUP_CORE_S1_PASS SHA256=$hash SIZE=$((Get-Item $bundle).Length)"
}
finally { Pop-Location }
