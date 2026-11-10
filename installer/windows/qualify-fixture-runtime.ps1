# Disposable native test-only witness. No external product inputs.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ProgramRoot,
    [Parameter(Mandatory=$true)][string]$DataRoot,
    [Parameter(Mandatory=$true)][string]$SandboxRoot,
    [Parameter(Mandatory=$true)][string]$ResultPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$exe=Join-Path ([IO.Path]::GetFullPath($ProgramRoot)) 'bin\fixture.exe'
if(!(Test-Path -LiteralPath $exe -PathType Leaf)){
    throw 'SETUP_FIXTURE_WITNESS_PROGRAM_MISSING'
}
$process=Start-Process -FilePath $exe -ArgumentList '--probe' -Wait -PassThru -WindowStyle Hidden
try {
    if($process.ExitCode -ne 0){
        throw 'SETUP_FIXTURE_WITNESS_PROGRAM_FAILED'
    }
} finally {
    $process.Dispose()
}
$payload=[ordered]@{status='PASS';entrypoint='NATIVE_PROCESS_EXIT_ZERO';fixture=$true}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($ResultPath),
    ($payload|ConvertTo-Json -Depth 3),[Text.UTF8Encoding]::new($false))
