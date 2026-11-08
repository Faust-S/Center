# Reproducible Windows Setup Core V2 packaging comparison; synthetic data only.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Stub,
    [Parameter(Mandatory=$true)][string]$BaselineSource,
    [int[]]$SizesMiB = @(25, 250),
    [ValidateRange(1,5)][int]$Repeats = 2,
    [string]$Output = 'artifacts/iwxa-v2-benchmark.json'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Stub -PathType Leaf) -or -not (Test-Path -LiteralPath $BaselineSource -PathType Leaf)) {
    throw 'SETUP_BENCHMARK_INPUT_MISSING'
}
if (@($SizesMiB | Where-Object { $_ -lt 1 -or $_ -gt 1500 }).Count -gt 0 -or $SizesMiB.Count -eq 0) {
    throw 'SETUP_BENCHMARK_SIZE_UNSUPPORTED'
}
$python = (Get-Command python -ErrorAction Stop).Source
$stubFull = [IO.Path]::GetFullPath($Stub)
$baselineFull = [IO.Path]::GetFullPath($BaselineSource)
$candidateFull = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../build_bundle.py'))
$head = [string](& git rev-parse HEAD).Trim()
$tree = [string](& git rev-parse 'HEAD^{tree}').Trim()
if ($head -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$') {
    throw 'SETUP_BENCHMARK_SOURCE_REVISION_INVALID'
}
$work = Join-Path $env:RUNNER_TEMP ('iwxa-v2-benchmark-' + [Guid]::NewGuid().ToString('N'))
New-Item -Path $work -ItemType Directory -Force | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
$rows = New-Object 'System.Collections.Generic.List[object]'
function Quote-Argument([string]$value) {
    if ($value.Contains('"')) { throw 'SETUP_BENCHMARK_UNSAFE_QUOTE' }
    return '"' + $value + '"'
}
function Invoke-Variant(
    [string]$variant, [string]$source, [string]$profile, [string]$payload,
    [int]$size, [int]$iteration
) {
    $prefix = ('{0}-{1}-{2}' -f $variant,$size,$iteration)
    $out = Join-Path $work ($prefix + '.exe')
    $stdout = Join-Path $work ($prefix + '.stdout.txt')
    $stderr = Join-Path $work ($prefix + '.stderr.txt')
    $values = @($source,'build-resource','--product',$profile,'--payload',$payload,
        '--stub',$stubFull,'--output',$out,'--source-commit',$head,'--source-tree',$tree)
    $line = ($values | ForEach-Object { Quote-Argument ([string]$_) }) -join ' '
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $python -ArgumentList $line -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $peakWorkingSet = [long]0
    $peakPaged = [long]0
    $exit = -1
    try {
        while (-not $process.HasExited) {
            $process.Refresh()
            try {
                $peakWorkingSet = [Math]::Max($peakWorkingSet,[long]$process.PeakWorkingSet64)
                $peakPaged = [Math]::Max($peakPaged,[long]$process.PeakPagedMemorySize64)
            } catch [InvalidOperationException] { }
            Start-Sleep -Milliseconds 50
        }
        $process.WaitForExit()
        $exit = $process.ExitCode
    } finally {
        $clock.Stop()
        if (-not $process.HasExited) { $process.Kill() }
        $process.Dispose()
    }
    if ($exit -ne 0 -or -not (Test-Path -LiteralPath $out)) {
        $details = Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue
        throw ('SETUP_BENCHMARK_BUILD_FAILED_' + $prefix + ': ' + $details)
    }
    $result = Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json
    if ($result.format -ne 'PE_RESOURCE_V2') { throw ('SETUP_BENCHMARK_WRONG_FORMAT_' + $prefix) }
    $entry = [pscustomobject]@{
        sizeMiB=$size
        iteration=$iteration
        variant=$variant
        elapsedMs=[Math]::Round($clock.Elapsed.TotalMilliseconds,1)
        peakWorkingSetMiB=[Math]::Round($peakWorkingSet / 1MB,1)
        peakPagedMemoryMiB=[Math]::Round($peakPaged / 1MB,1)
        outputBytes=(Get-Item -LiteralPath $out).Length
        outputSha256=(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    Remove-Item -LiteralPath $out -Force
    Write-Host ('SETUP_BENCHMARK {0} {1}MiB run={2} ms={3} peakWS={4}MiB peakPaged={5}MiB' -f $variant,$size,$iteration,$entry.elapsedMs,$entry.peakWorkingSetMiB,$entry.peakPagedMemoryMiB)
    return $entry
}
try {
    foreach ($size in $SizesMiB) {
        $case = Join-Path $work ('case-' + $size)
        $payload = Join-Path $case 'payload'
        New-Item -Path $payload -ItemType Directory -Force | Out-Null
        Copy-Item -LiteralPath $stubFull -Destination (Join-Path $payload 'fixture.exe')
        $blobPath = Join-Path $payload 'synthetic-incompressible.bin'
        # Deflate's dictionary is 32 KiB, so repeating a random 1-MiB block
        # remains effectively incompressible without storing a giant buffer.
        $block = New-Object byte[] (1024 * 1024)
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($block) } finally { $rng.Dispose() }
        $stream = [IO.File]::Open($blobPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try {
            for ($i=0; $i -lt $size; $i++) { $stream.Write($block,0,$block.Length) }
        } finally { $stream.Dispose() }
        $profile = @{
            schema='IWXA_SETUP_PRODUCT/1'; id='iwxa.setup.benchmark'
            display_name='IWXA Setup Benchmark'; publisher='IWXA'
            version='1.0.0'; architecture='windows-x64'
            install_dir='IWXA Setup Benchmark'; entrypoint='fixture.exe'
            data_namespace='iwxa.setup.benchmark'; requirements=@()
        }
        $profilePath = Join-Path $case 'product.json'
        [IO.File]::WriteAllText($profilePath,($profile | ConvertTo-Json -Depth 5),$utf8)
        for ($repeat=1; $repeat -le $Repeats; $repeat++) {
            $order = if ($repeat % 2 -eq 1) { @('baseline','optimized') } else { @('optimized','baseline') }
            $pair = @{}
            foreach ($variant in $order) {
                $source = if ($variant -eq 'baseline') { $baselineFull } else { $candidateFull }
                $entry = Invoke-Variant $variant $source $profilePath $payload $size $repeat
                $rows.Add($entry)
                $pair[$variant] = $entry
            }
            if ($pair['baseline'].outputSha256 -ne $pair['optimized'].outputSha256 -or
                $pair['baseline'].outputBytes -ne $pair['optimized'].outputBytes) {
                throw ('SETUP_BENCHMARK_NATIVE_V2_OUTPUT_CHANGED_' + $size + '_' + $repeat)
            }
            Write-Host ('SETUP_BENCHMARK_V2_IDENTICAL_OUTPUT_PASS size=' + $size + 'MiB iteration=' + $repeat)
        }
        Remove-Item -LiteralPath $case -Recurse -Force
    }
    $report = [ordered]@{
        schema='IWXA_SETUP_PERFORMANCE_BENCHMARK/1'
        sourceHead=$head; sourceTree=$tree
        baselineCommit='7173fb54bad2ff67eb77f2603117f85e6e63cb73'
        status='PASS'; resourceFormat='PE_RESOURCE_V2'
        payload='synthetic-incompressible-file-plus-native-stub'
        sampleScope='Windows runner, single-process packaging; peak process counters'
        measurements=$rows.ToArray()
    }
    $fullOut=[IO.Path]::GetFullPath($Output)
    New-Item -ItemType Directory -Path (Split-Path -Parent $fullOut) -Force | Out-Null
    [IO.File]::WriteAllText($fullOut,($report | ConvertTo-Json -Depth 8),$utf8)
    Write-Host ('SETUP_V2_RESOURCE_BENCHMARK_PASS ' + $fullOut)
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
