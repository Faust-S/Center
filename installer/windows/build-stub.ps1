[CmdletBinding()]
param(
    [string]$Output = "artifacts/iwxa-setup-core-stub.exe",
    [string]$Icon = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$target = if ([IO.Path]::IsPathRooted($Output)) {
    [IO.Path]::GetFullPath($Output)
} else {
    [IO.Path]::GetFullPath((Join-Path $root $Output))
}
$compiler = @(
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) { throw "IWXA_SETUP_CSC_MISSING" }

$sources = @(Get-ChildItem -Path (Join-Path $PSScriptRoot 'SetupCore.*.cs') -File |
    Sort-Object Name | ForEach-Object { $_.FullName })
if ($sources.Count -ne 11) { throw "IWXA_SETUP_NATIVE_SOURCES_INCOMPLETE" }
$compilerArgs = @(
    '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
    "/out:$target",
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Web.Extensions.dll',
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll'
)
$manifestPath = Join-Path $PSScriptRoot 'SetupCore.manifest'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'IWXA_SETUP_NATIVE_MANIFEST_MISSING'
}
# System-aware DPI in one signed EXE; do not depend on a sibling .config.
$compilerArgs += "/win32manifest:$manifestPath"
# The default desktop installer uses the exact Personal Agent logo shape
# with Admin Center's red field. A product can pass its own native ICO via
# -Icon when the universal Setup Core is adopted beyond Center.
$iconPath = if ([string]::IsNullOrWhiteSpace($Icon)) {
    $generated = Join-Path $root 'artifacts/iwxa-setup-center-brand.ico'
    & (Join-Path $PSScriptRoot 'create-brand-icon.ps1') -Output $generated
    if (-not (Test-Path -LiteralPath $generated -PathType Leaf)) {
        throw 'IWXA_SETUP_BRAND_ICON_FAILED'
    }
    $generated
} elseif ([IO.Path]::IsPathRooted($Icon)) {
    [IO.Path]::GetFullPath($Icon)
} else {
    [IO.Path]::GetFullPath((Join-Path $root $Icon))
}
if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
    $compilerArgs += "/win32icon:$iconPath"
}
New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
& $compiler @compilerArgs @sources
if ($LASTEXITCODE -ne 0) { throw "IWXA_SETUP_CSC_FAILED exit=$LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "IWXA_SETUP_NATIVE_STUB_MISSING"
}
$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
Write-Host "IWXA_SETUP_NATIVE_GUI_STUB_PASS bytes=$((Get-Item $target).Length) SHA256=$hash"
