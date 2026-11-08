# Fast Windows native test: uses the real Setup Core with a tiny fixture.
[CmdletBinding()]
param([string]$Stub = 'artifacts/iwxa-setup-core-early.exe')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $repo
try {
    $stubPath=[IO.Path]::GetFullPath($Stub)
    if(!(Test-Path -LiteralPath $stubPath -PathType Leaf)){throw 'SETUP_FAST_STUB_MISSING'}
    $work=Join-Path $env:RUNNER_TEMP 'iwxa-setup-fast-native'
    if(Test-Path -LiteralPath $work){throw 'SETUP_FAST_WORKDIR_NOT_CLEAN'}
    New-Item -Path $work -ItemType Directory -Force|Out-Null
    $profilePath=Join-Path $work 'product.json'
    $payload=Join-Path $work 'payload'
    $bundle=Join-Path $work 'setup.exe'
    $appName='iwxa-fixture.exe'
    $id='iwxa.setup.fastfixture'
    $dirName='IWXA Setup Fast Fixture'
    $root=Join-Path $env:LOCALAPPDATA ('Programs/' + $dirName)
    $link=Join-Path ([Environment]::GetFolderPath('Programs')) ($dirName+'.lnk')
    $userData=Join-Path $env:LOCALAPPDATA 'iwxa.setup.fastfixture/keep.txt'
    $owner='HKCU:\Software\IWXA\SetupCore\Products\'+$id
    $uninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\IWXA.SetupCore.'+$id
    $foreign=Join-Path $env:WINDIR 'System32/notepad.exe'
    if((Test-Path -LiteralPath $root) -or (Test-Path -LiteralPath $link) -or
       (Test-Path -LiteralPath $owner) -or (Test-Path -LiteralPath $userData)){
        throw 'SETUP_FAST_FIXTURE_NOT_CLEAN'
    }
    $profile=@{
        schema='IWXA_SETUP_PRODUCT/1';id=$id
        display_name='IWXA Setup Fast Fixture';publisher='IWXA'
        version='0.3.0-dev.1';architecture='windows-x64'
        install_dir=$dirName;entrypoint=$appName
        data_namespace='iwxa.setup.fastfixture';requirements=@()
    }
    [IO.File]::WriteAllText($profilePath,
        ($profile|ConvertTo-Json -Depth 5),
        ([System.Text.UTF8Encoding]::new($false)))
    New-Item -Path $payload -ItemType Directory|Out-Null
    Copy-Item -LiteralPath $stubPath -Destination (Join-Path $payload $appName)
    New-Item -Path (Join-Path $payload 'assets') -ItemType Directory|Out-Null
    [IO.File]::WriteAllText((Join-Path $payload 'assets/owned.txt'),'fixture')
    $head=[string]$env:GITHUB_SHA
    $tree=[string](& git rev-parse 'HEAD^{tree}').Trim()
    if($head -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$'){
        throw 'SETUP_FAST_SOURCE_IDENTITY_INVALID'
    }
    $argsBuild=@('-m','installer.build_bundle','build-resource',
        '--product',$profilePath,'--payload',$payload,'--stub',$stubPath,
        '--output',$bundle,'--source-commit',$head,'--source-tree',$tree)
    $built=& python @argsBuild
    if($LASTEXITCODE -ne 0){throw 'SETUP_FAST_BUILD_FAILED'}
    if((($built|Out-String)|ConvertFrom-Json).format -ne 'PE_RESOURCE_V2'){
        throw 'SETUP_FAST_NOT_V2'
    }
    function Invoke-Setup(
        [string]$mode,[string]$tag,[int]$expected=0,[string]$binary=''){
        if(!$binary){$binary=$bundle}
        $report=Join-Path $work ($tag+'.json')
        if(Test-Path -LiteralPath $report){Remove-Item -LiteralPath $report -Force}
        $p=Start-Process -FilePath $binary -ArgumentList ('{0} "{1}"' -f $mode,$report) -PassThru
        try{
            if(!$p.WaitForExit(60000)){
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                throw ('SETUP_FAST_TIMEOUT_'+$tag)
            }
            if($p.ExitCode -ne $expected){throw ('SETUP_FAST_EXIT_'+$tag+'_'+$p.ExitCode)}
        }finally{$p.Dispose()}
        if(!(Test-Path -LiteralPath $report)){throw ('SETUP_FAST_REPORT_MISSING_'+$tag)}
        return Get-Content -LiteralPath $report -Raw|ConvertFrom-Json
    }
    $verified=Invoke-Setup '--inspect-file' 'identity'
    if($verified.status -ne 'VERIFIED' -or $verified.product -ne $id -or
       $verified.packageFormat -ne 'PE_RESOURCE_V2' -or $verified.requiresWebView2){
        throw 'SETUP_FAST_IDENTITY_INVALID'
    }
    # Execute the real WinForms completion gate without launching a second UI.
    # Both the observed plan and the on-disk receipt check are independently
    # required: a successful native return code alone is never sufficient.
    $assembly=[Reflection.Assembly]::LoadFrom($stubPath)
    $formType=$assembly.GetType('IwxaSetup.SetupForm', $true)
    $flags=[Reflection.BindingFlags]'Static, Public, NonPublic'
    $gate=$formType.GetMethod('CompletionMatches', $flags)
    if($null -eq $gate){
        throw 'SETUP_FAST_UI_COMPLETION_GATE_NOT_EXPOSED'
    }
    function Assert-Completion([string]$operation,[string]$native,[string]$plan,[bool]$expected){
        $arguments=New-Object 'System.Object[]' 3
        $arguments[0]=[string]$operation
        $arguments[1]=[string]$native
        $arguments[2]=[string]$plan
        $answer=[bool]$gate.Invoke($null, $arguments)
        if($answer -ne $expected){
            throw ('SETUP_FAST_COMPLETION_MISMATCH_'+$operation+'_'+$native+'_'+$plan)
        }
    }
    Assert-Completion 'Install' 'INSTALLED_NOT_LAUNCHED' 'REPAIR_CANDIDATE_NOT_ACTIVATED' $true
    Assert-Completion 'Install' 'INSTALLED_NOT_LAUNCHED' 'OWNERSHIP_MISMATCH' $false
    Assert-Completion 'Install' 'INSTALLED_NOT_LAUNCHED' '' $false
    Assert-Completion 'Upgrade' 'UPGRADED_BACKUP_RETAINED' 'UPGRADE_RECOVERY_REQUIRED' $false
    Assert-Completion 'Repair' 'REPAIRED_BACKUP_RETAINED' 'REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK' $true
    Assert-Completion 'CancelLegacyPreview' 'UNINSTALLED_USER_DATA_PRESERVED' 'LEGACY_MIGRATION_HOLD' $true
    Assert-Completion 'InstallWebView2' 'WEBVIEW2_INSTALLED_VERIFIED' 'WEBVIEW2_MISSING' $false
    $ownedStateTag=0
    function Assert-OwnedState([bool]$expected){
        $script:ownedStateTag++
        $tag='post-owner-state-'+$script:ownedStateTag
        $result=Invoke-Setup '--verify-installed-file' $tag $(if($expected){0}else{2})
        if ($expected -and $result.status -ne 'OWNED_FILES_VERIFIED'){
            throw 'SETUP_FAST_VALID_OWNER_REJECTED'
        }
        if (!$expected -and $result.status -ne 'ERROR'){
            throw 'SETUP_FAST_BAD_OWNER_ACCEPTED'
        }
    }
    Write-Host 'IWXA_SETUP_UI_COMPLETION_GATE_STATUS_MATRIX_PASS'
    $shell=New-Object -ComObject WScript.Shell
    try{
        $foreignLink=$shell.CreateShortcut($link)
        $foreignLink.TargetPath=$foreign
        $foreignLink.Description='Foreign test shortcut'
        $foreignLink.Save()
        $hash=(Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
        $pre=Invoke-Setup '--preflight-file' 'preflight-foreign'
        $blocked=Invoke-Setup '--install-file' 'install-foreign' 2
        if($pre.status -ne 'START_MENU_SHORTCUT_CONFLICT' -or
           $blocked.status -ne 'ERROR' -or
           $blocked.reason -ne 'SETUP_BLOCKED_START_MENU_SHORTCUT_CONFLICT' -or
           (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash -ne $hash -or
           (Test-Path -LiteralPath $root) -or (Test-Path -LiteralPath $owner)){
            throw 'SETUP_FAST_FOREIGN_SHORTCUT_NOT_PRESERVED'
        }
        Write-Host 'IWXA_SETUP_FAST_FOREIGN_SHORTCUT_PASS'
        Remove-Item -LiteralPath $link -Force
        $installed=Invoke-Setup '--install-file' 'first-install'
        if($installed.status -ne 'INSTALLED_NOT_LAUNCHED' -or
           !(Test-Path -LiteralPath $root) -or
           !(Test-Path -LiteralPath $owner) -or
           !(Test-Path -LiteralPath $uninstallKey) -or
           !(Test-Path -LiteralPath $link)){
            throw 'SETUP_FAST_FIRST_INSTALL_INVALID'
        }
        New-Item -Path (Split-Path -Parent $userData) -ItemType Directory -Force|Out-Null
        [IO.File]::WriteAllText($userData,'outside-user-data')
        $app=Join-Path $root $appName
        $receipt=Join-Path $root '.iwxa-setup-ownership.json'
        $uninstaller=Join-Path $root 'IWXA.SetupCore.Uninstall.exe'
        $appHash=(Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash
        $uninstallerHash=(Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash
        Assert-OwnedState $true
        $receiptBytes=[IO.File]::ReadAllBytes($receipt)
        try {
            $editedReceipt=[IO.File]::ReadAllText($receipt) | ConvertFrom-Json
            $editedReceipt.packageSha256=('0' * 64)
            $editedReceipt | ConvertTo-Json -Depth 16 |
                Set-Content -LiteralPath $receipt -Encoding UTF8
            $badPlan=Invoke-Setup '--upgrade-plan-file' 'post-operation-bad-receipt'
            if($badPlan.status -ne 'OWNERSHIP_MISMATCH'){
                throw 'SETUP_FAST_RECEIPT_CORRUPTION_PLAN_ACCEPTED'
            }
            Assert-Completion 'Install' 'INSTALLED_NOT_LAUNCHED' $badPlan.status $false
            Assert-OwnedState $false
        } finally {
            [IO.File]::WriteAllBytes($receipt,$receiptBytes)
        }
        Assert-OwnedState $true
        $assetFile=Join-Path $root 'assets/owned.txt'
        $assetContent=[IO.File]::ReadAllBytes($assetFile)
        try {
            Remove-Item -LiteralPath $assetFile -Force
            Assert-OwnedState $false
        } finally {
            [IO.File]::WriteAllBytes($assetFile,$assetContent)
        }
        Assert-OwnedState $true
        Write-Host 'IWXA_SETUP_POST_OPERATION_TAMPERED_RECEIPT_AND_MISSING_ASSET_REJECTED_PASS'

        # Repair, Upgrade and Rollback must never reset a user's customized
        # Start Menu description when the entrypoint remains at the same path.
        $ownedShortcut=$shell.CreateShortcut($link)
        $ownedShortcut.Description='CUSTOMIZED_START_MENU_DESCRIPTION_PRESERVE_ME'
        $ownedShortcut.Save()
        $ownedShortcutHash=(Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
        $repair=Invoke-Setup '--repair-file' 'repair'
        if($repair.status -ne 'REPAIRED_BACKUP_RETAINED' -or
           (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash -ne $ownedShortcutHash){
            throw 'SETUP_FAST_REPAIR_OVERWROTE_USER_SHORTCUT'
        }
        $confirm=Invoke-Setup '--confirm-upgrade-file' 'repair-confirm'
        if($confirm.status -ne 'UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED' -or
           (Test-Path -LiteralPath ($root+'.iwxa-previous'))){
            throw 'SETUP_FAST_REPAIR_CONFIRM_FAILED'
        }
        $nextProfile=$profile.Clone()
        $nextProfile.version='0.3.0-dev.2'
        $nextPath=Join-Path $work 'upgrade-profile.json'
        [IO.File]::WriteAllText($nextPath,
            ($nextProfile|ConvertTo-Json -Depth 5),
            ([System.Text.UTF8Encoding]::new($false)))
        $upgradeBundle=Join-Path $work 'upgrade.exe'
        $upgradeArgs=@('-m','installer.build_bundle','build-resource',
            '--product',$nextPath,'--payload',$payload,'--stub',$stubPath,
            '--output',$upgradeBundle,'--source-commit',$head,'--source-tree',$tree)
        $builtUpgrade=& python @upgradeArgs
        if($LASTEXITCODE -ne 0 -or
           (($builtUpgrade|Out-String)|ConvertFrom-Json).format -ne 'PE_RESOURCE_V2'){
            throw 'SETUP_FAST_UPGRADE_PACKAGE_BUILD_FAILED'
        }
        $upgraded=Invoke-Setup '--upgrade-file' 'upgrade' 0 $upgradeBundle
        if($upgraded.status -ne 'UPGRADED_BACKUP_RETAINED' -or
           (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash -ne $ownedShortcutHash){
            throw 'SETUP_FAST_UPGRADE_OVERWROTE_USER_SHORTCUT'
        }
        $rolled=Invoke-Setup '--rollback-upgrade-file' 'rollback' 0 $upgradeBundle
        if($rolled.status -ne 'ROLLBACK_RESTORED_PREVIOUS' -or
           (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash -ne $ownedShortcutHash -or
           (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne $appHash -or
           (Test-Path -LiteralPath ($root+'.iwxa-previous'))){
            throw 'SETUP_FAST_ROLLBACK_OVERWROTE_USER_SHORTCUT'
        }
        Write-Host 'IWXA_SETUP_FAST_REPAIR_UPGRADE_ROLLBACK_PRESERVE_SHORTCUT_PASS'

        # Do not adopt unexpected files, even when the app executable is
        # missing. Restoring the package is a repair, not a disk cleanup.
        $missingAsset=Join-Path $root 'assets/owned.txt'
        Remove-Item -LiteralPath $app -Force
        Remove-Item -LiteralPath $missingAsset -Force
        $unownedInRoot=Join-Path $root 'unrelated-user-file.txt'
        [IO.File]::WriteAllText($unownedInRoot,'DO_NOT_REMOVE')
        try {
            $blockedPlan=Invoke-Setup '--upgrade-plan-file' 'foreign-root-plan'
            $blockedRepair=Invoke-Setup '--repair-file' 'foreign-root-repair' 2
            if ($blockedPlan.status -ne 'OWNERSHIP_MISMATCH' -or
                $blockedRepair.status -ne 'ERROR' -or
                $blockedRepair.reason -ne 'SETUP_REPAIR_BLOCKED_OWNERSHIP_MISMATCH' -or
                [IO.File]::ReadAllText($unownedInRoot) -ne 'DO_NOT_REMOVE') {
                throw 'SETUP_FAST_MISSING_EXE_ADOPTED_UNOWNED_FILE'
            }
        } finally {
            Remove-Item -LiteralPath $unownedInRoot -Force
        }
        $missingPlan=Invoke-Setup '--upgrade-plan-file' 'missing-owned-plan'
        if ($missingPlan.status -ne 'REPAIR_CANDIDATE_NOT_ACTIVATED') {
            throw 'SETUP_FAST_MISSING_EXE_REPAIR_PLAN_NOT_OFFERED'
        }
        $repairedMissing=Invoke-Setup '--repair-file' 'repair-missing-files'
        if ($repairedMissing.status -ne 'REPAIRED_BACKUP_RETAINED' -or
            (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne $appHash -or
            [IO.File]::ReadAllText($missingAsset) -ne 'fixture' -or
            [IO.File]::ReadAllText($userData) -ne 'outside-user-data') {
            throw 'SETUP_FAST_MISSING_FILES_NOT_RESTORED'
        }
        $pendingMissing=Invoke-Setup '--upgrade-plan-file' 'repair-missing-confirm-plan'
        if ($pendingMissing.status -ne 'REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK') {
            throw 'SETUP_FAST_INCOMPLETE_BACKUP_ROLLBACK_OFFERED'
        }
        $unsafeRollback=Invoke-Setup '--rollback-upgrade-file' 'missing-backup-rollback-denied' 2
        if ($unsafeRollback.status -ne 'ERROR' -or
            $unsafeRollback.reason -ne 'SETUP_OWNERSHIP_MISMATCH' -or
            (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne $appHash) {
            throw 'SETUP_FAST_DAMAGED_BACKUP_ROLLBACK_ACCEPTED'
        }
        $confirmedMissing=Invoke-Setup '--confirm-upgrade-file' 'repair-missing-confirm'
        if ($confirmedMissing.status -ne 'UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED' -or
            (Test-Path -LiteralPath ($root+'.iwxa-previous'))) {
            throw 'SETUP_FAST_MISSING_FILES_REPAIR_CONFIRM_FAILED'
        }
        Write-Host 'IWXA_SETUP_FAST_MISSING_EXE_ASSET_REPAIR_CONFIRM_PASS'

        $originalFlags=[IO.File]::GetAttributes($uninstaller)
        try{
            [IO.File]::SetAttributes($uninstaller,
                ($originalFlags -bor [IO.FileAttributes]::ReadOnly))
            $denied=Invoke-Setup '--uninstall-file' 'readonly-refusal' 2
            if($denied.status -ne 'ERROR' -or
               $denied.reason -ne 'SETUP_UNINSTALL_READONLY_FILE' -or
               !(Test-Path -LiteralPath $receipt) -or
               !(Test-Path -LiteralPath $owner) -or
               (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne $appHash -or
               (Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash -ne $uninstallerHash){
                throw 'SETUP_FAST_PARTIAL_UNINSTALL'
            }
        }finally{
            if(Test-Path -LiteralPath $uninstaller){
                [IO.File]::SetAttributes($uninstaller,$originalFlags)
            }
        }
        Write-Host 'IWXA_SETUP_FAST_READONLY_UNINSTALL_REFUSED_PASS'
        $modified=$shell.CreateShortcut($link)
        $modified.TargetPath=$foreign
        $modified.Description='User-modified shortcut'
        $modified.Save()
        $modifiedHash=(Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
        $removed=Invoke-Setup '--uninstall-file' 'normal-uninstall'
        if($removed.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
           (Test-Path -LiteralPath $root) -or
           (Test-Path -LiteralPath $owner) -or
           (Test-Path -LiteralPath $uninstallKey) -or
           !(Test-Path -LiteralPath $link) -or
           (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash -ne $modifiedHash -or
           [IO.File]::ReadAllText($userData) -ne 'outside-user-data'){
            throw 'SETUP_FAST_USER_FILES_OR_SHORTCUT_NOT_PRESERVED'
        }
        Write-Host 'IWXA_SETUP_FAST_UNINSTALL_PRESERVED_USER_SHORTCUT_PASS'

        # Inject a real process failure at three distinct deletion checkpoints.
        # The original owner key and receipt (until the last stage) must
        # survive so the same signed V2 setup can resume without losing data.
        foreach($phase in @(
            'after-first-payload','after-windows-registration','after-receipt')){
            if(Test-Path -LiteralPath $link){
                Remove-Item -LiteralPath $link -Force
            }
            $again=Invoke-Setup '--install-file' ('reinstall-'+$phase)
            if($again.status -ne 'INSTALLED_NOT_LAUNCHED' -or
               !(Test-Path -LiteralPath $owner) -or
               !(Test-Path -LiteralPath $receipt) -or
               !(Test-Path -LiteralPath $uninstallKey)){
                throw ('SETUP_FAST_RESUME_INSTALL_INVALID_'+$phase)
            }
            try {
                $env:IWXA_SETUP_TEST_UNINSTALL_FAIL_AT=$phase
                $interrupted=Invoke-Setup '--uninstall-file' ('fault-'+$phase) 2
            } finally {
                Remove-Item Env:IWXA_SETUP_TEST_UNINSTALL_FAIL_AT -ErrorAction SilentlyContinue
            }
            if ($interrupted.status -ne 'ERROR' -or
                $interrupted.reason -ne ('SETUP_TEST_UNINSTALL_FAILURE_'+$phase) -or
                !(Test-Path -LiteralPath $owner) -or
                [IO.File]::ReadAllText($userData) -ne 'outside-user-data'){
                throw ('SETUP_FAST_FAULT_WAS_NOT_FAIL_CLOSED_'+$phase)
            }
            $receiptExpected = $phase -ne 'after-receipt'
            if ((Test-Path -LiteralPath $receipt) -ne $receiptExpected) {
                throw ('SETUP_FAST_FAULT_RECEIPT_PHASE_WRONG_'+$phase)
            }
            if ($phase -ne 'after-first-payload' -and
                (Test-Path -LiteralPath $uninstallKey)){
                throw ('SETUP_FAST_FAULT_UNINSTALL_REGISTRY_NOT_CLEAN_'+$phase)
            }
            if ($phase -eq 'after-receipt'){
                # A missing ownership marker must never authorize deletion.
                Set-ItemProperty -Path $owner -Name 'UninstallPending' -Value 0
                $refused=Invoke-Setup '--uninstall-file' 'resume-no-authority' 2
                if ($refused.status -ne 'ERROR' -or
                    $refused.reason -ne 'SETUP_UNINSTALL_RESUME_AUTHORITY_MISSING' -or
                    !(Test-Path -LiteralPath $owner)){
                    throw 'SETUP_FAST_UNTRUSTED_RESUME_ACCEPTED'
                }
                Set-ItemProperty -Path $owner -Name 'UninstallPending' -Value 1
            }
            $continued=Invoke-Setup '--uninstall-file' ('resumed-'+$phase)
            if ($continued.status -ne 'UNINSTALLED_USER_DATA_PRESERVED' -or
                (Test-Path -LiteralPath $owner) -or
                (Test-Path -LiteralPath $uninstallKey) -or
                (Test-Path -LiteralPath $receipt) -or
                (Test-Path -LiteralPath $root) -or
                (Test-Path -LiteralPath $link) -or
                [IO.File]::ReadAllText($userData) -ne 'outside-user-data'){
                throw ('SETUP_FAST_UNINSTALL_RESUME_FAILED_'+$phase)
            }
            Write-Host ('IWXA_SETUP_FAST_UNINSTALL_FAULT_RESUME_PASS_'+$phase)
        }
    }finally{
        if(Test-Path -LiteralPath $link){Remove-Item -LiteralPath $link -Force}
        if(Test-Path -LiteralPath $userData){Remove-Item -LiteralPath $userData -Force}
    }
}finally{Pop-Location}
