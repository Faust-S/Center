# Reproducible native PE_RESOURCE_V2 packaging profile (no product data).
# Default 25 MiB on perf commits; 250/750/1500 MiB are explicitly opt-in.
[CmdletBinding()]
param(
    [string]$Stub = 'artifacts/iwxa-setup-core-early.exe',
    [int[]]$SizesMiB = @(25),
    [string]$OutputDir = 'artifacts'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $repo
try {
    $stubPath=[IO.Path]::GetFullPath($Stub)
    if(!(Test-Path -LiteralPath $stubPath -PathType Leaf)){
        throw 'SETUP_BENCHMARK_STUB_MISSING'
    }
    $out=[IO.Path]::GetFullPath($OutputDir)
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    $head=[string]$env:GITHUB_SHA
    $tree=[string](& git rev-parse 'HEAD^{tree}').Trim()
    if($head -notmatch '^[a-f0-9]{40}$' -or $tree -notmatch '^[a-f0-9]{40}$'){
        throw 'SETUP_BENCHMARK_SOURCE_REVISION_REQUIRED'
    }
    foreach($mib in $SizesMiB){
        if($mib -notin @(25,250,750,1500)){
            throw 'SETUP_BENCHMARK_SIZE_UNSUPPORTED'
        }
        $root=Join-Path $env:RUNNER_TEMP ('iwxa-benchmark-'+$mib+'-'+$head.Substring(0,8))
        if(Test-Path -LiteralPath $root){throw 'SETUP_BENCHMARK_DIRECTORY_NOT_CLEAN'}
        New-Item -ItemType Directory -Path $root | Out-Null
        $payload=Join-Path $root 'payload'
        New-Item -ItemType Directory -Path $payload | Out-Null
        # Keep each member under the real 1 GiB per-file limit; 1.5 GiB
        # stress is a supported three-file product, not an unsafe exception.
        $buffer=New-Object 'System.Byte[]' (1024*1024)
        $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
        try{
            [int]$remaining=$mib
            [int]$part=0
            while($remaining -gt 0){
                [int]$size=[Math]::Min(500,$remaining)
                $data=Join-Path $payload ('synthetic-{0:d2}.dat' -f $part)
                $stream=[IO.File]::Open($data,[IO.FileMode]::CreateNew,
                    [IO.FileAccess]::Write,[IO.FileShare]::None)
                try{
                    for($k=0;$k -lt $size;$k++){
                        $rng.GetBytes($buffer)
                        $stream.Write($buffer,0,$buffer.Length)
                    }
                } finally {$stream.Dispose()}
                $remaining-=$size
                $part++
            }
        }finally{$rng.Dispose()}
        $profile=@{
            schema='IWXA_SETUP_PRODUCT/1'
            id='iwxa.setup.benchmark'
            display_name='IWXA Setup Benchmark'
            publisher='IWXA'
            version='1.0.0-dev.1'
            architecture='windows-x64'
            install_dir='IWXA Setup Benchmark'
            entrypoint='benchmark.exe'
            data_namespace='iwxa.setup.benchmark'
            requirements=@()
        }
        $profilePath=Join-Path $root 'profile.json'
        [IO.File]::WriteAllText($profilePath,($profile|ConvertTo-Json -Depth 5),
            ([Text.UTF8Encoding]::new($false)))
        Copy-Item -LiteralPath $stubPath -Destination (Join-Path $payload 'benchmark.exe')
        $target=Join-Path $root 'setup-v2.exe'
        $stdout=Join-Path $root 'builder-out.log'
        $stderr=Join-Path $root 'builder-err.log'
        $arguments='-m installer.build_bundle build-resource --product "{0}" --payload "{1}" --stub "{2}" --output "{3}" --source-commit {4} --source-tree {5}' -f
            $profilePath,$payload,$stubPath,$target,$head,$tree
        $clock=[Diagnostics.Stopwatch]::StartNew()
        $env:IWXA_SETUP_BENCHMARK='1'
        try {
            $process=Start-Process -FilePath 'python' -ArgumentList $arguments -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        } finally {
            Remove-Item Env:IWXA_SETUP_BENCHMARK -ErrorAction SilentlyContinue
        }
        [long]$peakResident=0
        [long]$peakTemp=0
        try {
            do {
                Start-Sleep -Milliseconds 200
                $process.Refresh()
                try { $peakResident=[Math]::Max($peakResident,[long]$process.PeakWorkingSet64) }
                catch [InvalidOperationException] {}
                $temporary=@(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
                    Measure-Object -Property Length -Sum)
                $peakTemp=[Math]::Max($peakTemp,[long]$temporary[0].Sum)
            } while(!$process.HasExited)
            $clock.Stop()
            if($process.ExitCode -ne 0){
                throw ('SETUP_BENCHMARK_BUILD_FAILED '+(Get-Content -LiteralPath $stderr -Raw))
            }
        } finally {$process.Dispose()}
        if(!(Test-Path -LiteralPath $target -PathType Leaf)){
            throw 'SETUP_BENCHMARK_PACKAGE_MISSING'
        }
        $build=Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json
        if($build.format -ne 'PE_RESOURCE_V2'){
            throw 'SETUP_BENCHMARK_EXPECTED_V2'
        }
        $bytes=(Get-Item -LiteralPath $target).Length
        $metrics=[ordered]@{
            schema='IWXA_SETUP_PACKAGING_BENCHMARK/1'
            sourceHead=$head
            sourceTree=$tree
            hostOS=[Environment]::OSVersion.VersionString
            sizeMiB=$mib
            format='PE_RESOURCE_V2'
            wallMs=$clock.ElapsedMilliseconds
            launcherPeakWorkingSetBytes=$peakResident
            builderPeakWorkingSetBytes=[long]$build.builderPeakWorkingSetBytes
            peakWorkspaceBytes=$peakTemp
            syntheticPayloadBytes=($mib*1MB)
            temporaryWorkspaceAbovePayloadBytes=[Math]::Max(0,$peakTemp-($mib*1MB))
            finalSetupBytes=$bytes
            installedUninstallerBytes=$bytes
            finalSetupSha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        }
        $report=Join-Path $out ('setup-core-benchmark-'+$mib+'.json')
        [IO.File]::WriteAllText($report,($metrics|ConvertTo-Json -Depth 5),
            ([Text.UTF8Encoding]::new($false)))
        Write-Host ('IWXA_SETUP_BENCHMARK_PASS sizeMiB={0} wallMs={1} peakRSS={2} workspacePeak={3} finalBytes={4}' -f
            $mib,$clock.ElapsedMilliseconds,[long]$build.builderPeakWorkingSetBytes,$peakTemp,$bytes)
    }
} finally { Pop-Location }
