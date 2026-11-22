# Product-owned one-time installed Windows witness for Agent06 online accounts.
# Uses the original Setup Core-installed Tauri + original Python Core.
# Synthetic profiles ONLY; no real Google, IMAP, DAV or Telegram interaction.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ProgramRoot,
    [Parameter(Mandatory=$true)][string]$DataRoot,
    [Parameter(Mandatory=$true)][string]$SandboxRoot,
    [Parameter(Mandatory=$true)][string]$ResultPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$phase='VALIDATE'
$uiCheckpoint='NOT_STARTED'
$native=$null
$started=$false
$passedStages=@()
$originalEnv=@{}
$ruDisclosure=-join ([char[]]@(0x41f,0x43e,0x43a,0x430,0x437,0x430,0x442,0x44c,0x20,0x43f,0x43e,0x434,0x440,0x430,0x437,0x434,0x435,0x43b,0x44b,0x20,0x412,0x43e,0x437,0x43c,0x43e,0x436,0x43d,0x43e,0x441,0x442,0x438))
$ruNavigation=-join ([char[]]@(0x418,0x43d,0x442,0x435,0x433,0x440,0x430,0x446,0x438,0x438))
$ruConnections=-join ([char[]]@(0x41f,0x43e,0x434,0x43a,0x43b,0x44e,0x447,0x435,0x43d,0x438,0x44f))
$ruTitle=-join ([char[]]@(0x41e,0x43d,0x43b,0x430,0x439,0x43d,0x2d,0x441,0x435,0x440,0x432,0x438,0x441,0x44b,0x20,0x438,0x20,0x430,0x43a,0x43a,0x430,0x443,0x43d,0x442,0x44b))
function Require([bool]$valid,[string]$code){
    if(!$valid){throw $code}
}
function NativeStop {
    if(!$script:native){return}
    try{
        $script:native.Refresh()
        if(!$script:native.HasExited){
            [void]$script:native.CloseMainWindow()
            if(!$script:native.WaitForExit(9000)){
                Stop-Process -Id $script:native.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }finally{
        $script:native.Dispose()
        $script:native=$null
    }
}
try{
    Require ($env:OS -eq 'Windows_NT') 'agent06_online_windows_required'
    $program=[IO.Path]::GetFullPath($ProgramRoot)
    $sandbox=[IO.Path]::GetFullPath($SandboxRoot)
    $data=[IO.Path]::GetFullPath($DataRoot)
    Require ($program.Equals((Join-Path $sandbox 'application'),[StringComparison]::OrdinalIgnoreCase) -and
        $data.Equals((Join-Path $sandbox 'data'),[StringComparison]::OrdinalIgnoreCase)
        ) 'agent06_online_sandbox_scope_invalid'
    Require (!(Test-Path -LiteralPath $ResultPath)) 'agent06_online_existing_witness_receipt'
    $installReceipt=Join-Path $program 'explorer-install-receipt.json'
    Require (Test-Path -LiteralPath $installReceipt -PathType Leaf) 'agent06_online_original_install_receipt_missing'
    $receipt=Get-Content -LiteralPath $installReceipt -Raw -Encoding UTF8 | ConvertFrom-Json
    Require ($receipt.schema -eq 'IWXA_EXPLORER_INSTALL_RECEIPT/1.1.0' -and
        $receipt.status -eq 'INSTALLED_GENERIC_STATE_READY') 'agent06_online_original_install_receipt_invalid'
    $rel=[string]$receipt.managed_runtime.python_executable
    Require ($rel -and -not [IO.Path]::IsPathRooted($rel) -and
        $rel -notmatch '(^|[\\/])\.\.([\\/]|$)' -and -not $rel.Contains(':')
        ) 'agent06_online_runtime_relative_path_invalid'
    $python=[IO.Path]::GetFullPath((Join-Path $program $rel.Replace('/','\')))
    Require ($python.StartsWith($program.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $python -PathType Leaf)) 'agent06_online_installed_python_missing'
    $exe=Join-Path $program 'desktop\bin\IWXA Personal.exe'
    Require (Test-Path -LiteralPath $exe -PathType Leaf) 'agent06_online_installed_native_exe_missing'
    $control=Join-Path $program 'tools\iwxa_windows_user_control.py'
    Require (Test-Path -LiteralPath $control -PathType Leaf) 'agent06_online_installed_control_missing'
    $probe=Join-Path (Join-Path $PSScriptRoot '..\agent061') 'qualify_online_services_installed.py'
    Require (Test-Path -LiteralPath $probe -PathType Leaf) 'agent06_online_installed_probe_missing'
    $profile=Join-Path $sandbox 'online-isolated-profile'
    foreach($key in @('LOCALAPPDATA','APPDATA','USERPROFILE','TEMP','TMP')){
        $originalEnv[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
    }
    $relocations=@{
        LOCALAPPDATA=(Join-Path $profile 'AppData\Local')
        APPDATA=(Join-Path $profile 'AppData\Roaming')
        USERPROFILE=(Join-Path $profile 'UserProfile')
        TEMP=(Join-Path $profile 'Temp')
        TMP=(Join-Path $profile 'Temp')
    }
    foreach($name in $relocations.Keys){
        [void](New-Item -ItemType Directory -Path $relocations[$name] -Force)
        [Environment]::SetEnvironmentVariable($name,$relocations[$name],'Process')
    }
    $port=0
    for($i=0;$i -lt 30;$i++){
        $candidate=Get-Random -Minimum 23000 -Maximum 48000
        $listener=$null
        try{
            $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$candidate)
            $listener.Start()
            $port=$candidate
            break
        }catch [Net.Sockets.SocketException]{
            continue
        }finally{
            if($listener){$listener.Stop()}
        }
    }
    Require ($port -gt 0) 'agent06_online_loopback_port_unavailable'
    $proof=Join-Path $sandbox 'online-local-only-proof.json'
    function CoreControl([string]$action,[switch]$json){
        $out=Join-Path $sandbox ('core-control-'+$action+'.private.log')
        $previous=$ErrorActionPreference
        try{
            $ErrorActionPreference='Continue'
            & $python -B $control --install-root $program --action $action --port $port --ready-timeout 8 --no-dialog *> $out
            $exit=$LASTEXITCODE
        }finally{$ErrorActionPreference=$previous}
        if($exit -ne 0){return $null}
        if($json){
            try {return Get-Content -LiteralPath $out -Raw -Encoding UTF8|ConvertFrom-Json}
            catch {return $null}
        }
        return $true
    }
    function NativeStart {
        Require ($null -eq $script:native) 'agent06_online_native_already_running'
        $script:native=Start-Process -FilePath $exe -ArgumentList @('--port',[string]$port) -WorkingDirectory $program -PassThru
        $start=[DateTime]::UtcNow
        $seenWindow=$false
        $ready=$false
        while(([DateTime]::UtcNow-$start).TotalSeconds -lt 100){
            $script:native.Refresh()
            if($script:native.HasExited){throw 'agent06_online_native_exited_before_ready'}
            if($script:native.MainWindowHandle -ne [IntPtr]::Zero -and
                $script:native.MainWindowTitle -eq 'IWXA Personal'){$seenWindow=$true}
            if($seenWindow){
                $state=CoreControl 'diagnostics' -json
                if($null -ne $state -and $state.control_center_ready -eq $true -and
                   $state.runtime_process_alive -eq $true){$ready=$true;break}
            }
            Start-Sleep -Milliseconds 350
        }
        Require ($seenWindow -and $ready) 'agent06_online_native_core_unavailable'
        $script:started=$true
    }
    function Phase([string]$name,[string]$expected){
        $out=Join-Path $sandbox ('online-'+$name+'.private.log')
        $previous=$ErrorActionPreference
        try{
            $ErrorActionPreference='Continue'
            & $python -B $probe --install-root $program --port $port --proof $proof --phase $name *> $out
            $exit=$LASTEXITCODE
        }finally{$ErrorActionPreference=$previous}
        Require ($exit -eq 0) ('agent06_online_phase_'+$name+'_failed')
        $lines=@(Get-Content -LiteralPath $out -ErrorAction SilentlyContinue)
        Require (@($lines|Where-Object {$_ -ceq $expected}).Count -eq 1
            ) ('agent06_online_phase_'+$name+'_receipt_invalid')
        $script:passedStages+=@($name)
    }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    function FindUI([string[]]$names,[string]$kind,[int]$attempts=45){
        for($i=0;$i -lt $attempts;$i++){
            $script:native.Refresh()
            Require (-not $script:native.HasExited) 'agent06_online_native_window_closed'
            if($script:native.MainWindowHandle -eq [IntPtr]::Zero){
                Start-Sleep -Milliseconds 350
                continue
            }
            $root=[System.Windows.Automation.AutomationElement]::FromHandle($script:native.MainWindowHandle)
            foreach($name in $names){
                $byName=[System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::NameProperty,$name)
                $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$byName)
                foreach($node in $nodes){
                    try{
                        if($kind -eq 'button' -and
                            $node.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button){continue}
                        if($kind -eq 'button' -and -not $node.Current.IsEnabled){continue}
                        if($kind -eq 'button' -and $node.Current.IsOffscreen){
                            # The accepted desktop sidebar scrolls independently.
                            # UIA may expose a real button but mark it offscreen
                            # on compact Windows screens. Scroll the actual item
                            # into view instead of treating it as absent.
                            try{
                                $scroll=$node.GetCurrentPattern(
                                    [System.Windows.Automation.ScrollItemPattern]::Pattern)
                                $scroll.ScrollIntoView()
                            }catch{
                                try{$node.SetFocus()}catch{}
                            }
                            Start-Sleep -Milliseconds 90
                            if($node.Current.IsOffscreen){continue}
                        }
                        return $node
                    }catch{}
                }
            }
            Start-Sleep -Milliseconds 350
        }
        return $null
    }
    function ClickUI($node){
        Require ($null -ne $node) 'agent06_online_ui_button_missing'
        try{
            $pattern=$node.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $pattern.Invoke()
        }catch{
            $node.SetFocus()
            $rect=$node.Current.BoundingRectangle
            Require ($rect.Width -gt 3 -and $rect.Height -gt 3 -and
                -not $node.Current.IsOffscreen) 'agent06_online_ui_button_not_clickable'
            [Windows.Forms.Cursor]::Position=[Drawing.Point]::new(
                [int]($rect.Left+$rect.Width/2),[int]($rect.Top+$rect.Height/2))
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Agent06OnlineClick {
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extraInfo);
}
'@ -ErrorAction SilentlyContinue
            [Agent06OnlineClick]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
            Start-Sleep -Milliseconds 60
            [Agent06OnlineClick]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
        }
    }
    function CheckOnlineUI([switch]$AfterRemove){
        $script:uiCheckpoint='LOOKUP_INITIAL_TITLE'
        $title=FindUI @("Online services and accounts",$ruTitle) 'any' 3
        if($null -eq $title){
            $script:uiCheckpoint='LOOKUP_CAPABILITIES_DISCLOSURE'
            $section=FindUI @("Show subsections Capabilities",$ruDisclosure) 'button' 55
            if($null -ne $section){ClickUI $section}
            $script:uiCheckpoint='LOOKUP_INTEGRATIONS_BUTTON'
            $integrations=FindUI @("Connections",$ruConnections,"Integrations",$ruNavigation) 'button' 60
            $script:uiCheckpoint='CLICK_INTEGRATIONS'
            ClickUI $integrations
        }
        $script:uiCheckpoint='LOOKUP_FINAL_TITLE'
        $title=FindUI @("Online services and accounts",$ruTitle) 'any' 65
        Require ($null -ne $title) 'agent06_online_gui_section_unavailable'
        $script:uiCheckpoint='LOOKUP_MAIL_B'
        $other=FindUI @('Synthetic Installed Mail B') 'any' 65
        Require ($null -ne $other) 'agent06_online_gui_remaining_account_absent'
        if(!$AfterRemove){
            $script:uiCheckpoint='LOOKUP_MAIL_A'
            $first=FindUI @('Synthetic Installed Mail A') 'any' 65
            Require ($null -ne $first) 'agent06_online_gui_first_account_absent'
        }else{
            $script:uiCheckpoint='CHECK_REMOVAL'
            $removed=FindUI @('Synthetic Installed Mail A') 'any' 2
            Require ($null -eq $removed) 'agent06_online_gui_deleted_account_still_present'
        }
        $script:uiCheckpoint='COMPLETE'
    }
    function FindDashboardUI([string[]]$labels,[string]$kind,[int]$attempts=55){
        for($tick=0;$tick -lt $attempts;$tick++){
            $script:native.Refresh()
            Require (-not $script:native.HasExited) 'agent062_dashboard_native_window_closed'
            if($script:native.MainWindowHandle -eq [IntPtr]::Zero){
                Start-Sleep -Milliseconds 300
                continue
            }
            $root=[System.Windows.Automation.AutomationElement]::FromHandle($script:native.MainWindowHandle)
            $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition)
            foreach($node in $nodes){
                try{
                    if($kind -eq 'button' -and
                       $node.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button){continue}
                    if($kind -eq 'button' -and !$node.Current.IsEnabled){continue}
                    $label=[string]$node.Current.Name
                    if(!$label){continue}
                    $matched=$false
                    foreach($expected in $labels){
                        if($label.Contains([string]$expected)){$matched=$true;break}
                    }
                    if(!$matched){continue}
                    if($node.Current.IsOffscreen){
                        try{
                            $scroll=$node.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern)
                            $scroll.ScrollIntoView()
                        }catch{
                            try{$node.SetFocus()}catch{}
                        }
                        Start-Sleep -Milliseconds 80
                    }
                    if($node.Current.IsOffscreen){continue}
                    return $node
                }catch{}
            }
            Start-Sleep -Milliseconds 300
        }
        return $null
    }
    function CheckDashboard([switch]$AfterCold){
        $script:uiCheckpoint='DASHBOARD_HOME'
        $home=FindDashboardUI @('Моё рабочее место','My workspace') 'any' 5
        if($null -eq $home){
            $go=FindDashboardUI @('Главная','Home') 'button' 50
            Require ($null -ne $go) 'agent062_dashboard_home_navigation_missing'
            ClickUI $go
        }
        $home=FindDashboardUI @('Моё рабочее место','My workspace') 'any' 60
        Require ($null -ne $home) 'agent062_dashboard_home_missing'
        if(!$AfterCold){
            $script:uiCheckpoint='DASHBOARD_CUSTOMIZE'
            $edit=FindDashboardUI @('Настроить','Customize') 'button' 50
            Require ($null -ne $edit) 'agent062_dashboard_customize_missing'
            ClickUI $edit
            $script:uiCheckpoint='DASHBOARD_ADD'
            $add=FindDashboardUI @('Добавить блок','Add widget') 'button' 40
            Require ($null -ne $add) 'agent062_dashboard_add_missing'
            ClickUI $add
            $choice=FindDashboardUI @('Состояние работ','Work overview') 'button' 45
            Require ($null -ne $choice) 'agent062_dashboard_catalog_widget_missing'
            ClickUI $choice
            $script:uiCheckpoint='DASHBOARD_DONE'
            $done=FindDashboardUI @('Готово','Done') 'button' 45
            Require ($null -ne $done) 'agent062_dashboard_finish_missing'
            ClickUI $done
        }
        $script:uiCheckpoint='DASHBOARD_WIDGET'
        $widget=FindDashboardUI @('Состояние работ','Work overview') 'any' 55
        Require ($null -ne $widget) 'agent062_dashboard_widget_missing'
        $script:uiCheckpoint='COMPLETE'
    }
    $phase='NATIVE_FIRST'
    NativeStart
    $phase='CREATE'
    Phase 'create' 'AGENT06_INSTALLED_ONLINE_CREATED_PASS'
    $phase='GUI_FIRST'
    CheckOnlineUI
    $phase='DASHBOARD_FIRST'
    CheckDashboard
    NativeStop
    Require ((CoreControl 'stop') -eq $true) 'agent06_online_first_core_stop_failed'
    $phase='NATIVE_COLD_REOPEN'
    NativeStart
    $phase='COLD_READBACK'
    Phase 'readback' 'AGENT06_INSTALLED_ONLINE_COLD_RESTORED_PASS'
    $phase='DASHBOARD_COLD'
    CheckDashboard -AfterCold
    $phase='REMOVE'
    Phase 'remove' 'AGENT06_INSTALLED_ONLINE_REMOVED_PASS'
    NativeStop
    Require ((CoreControl 'stop') -eq $true) 'agent06_online_second_core_stop_failed'
    $phase='NATIVE_COLD_REMOVE_REOPEN'
    NativeStart
    $phase='COLD_REMOVE_READBACK'
    Phase 'postremove' 'AGENT06_INSTALLED_ONLINE_COLD_REMOVE_READBACK_PASS'
    $phase='GUI_COLD_REMOVE'
    CheckOnlineUI -AfterRemove
    NativeStop
    Require ((CoreControl 'stop') -eq $true) 'agent06_online_final_core_stop_failed'
    $phase='RESULT'
    [ordered]@{
        schema='IWXA_AGENT062_INSTALLED_GUI_AND_HOME_WITNESS/1'
        status='PASS'
        dashboard_added_via_gui=$true
        dashboard_restored_after_cold_restart=$true
        native_window_first_opened=$true
        original_core_connected=$true
        online_account_create_confirmed=$true
        online_gui_accounts_visible=$true
        online_cold_profile_readback=$true
        online_multiaccount_removal_confirmed=$true
        online_cold_removal_readback=$true
        online_gui_deletion_visible=$true
        real_external_effects_performed=$false
        public_artifacts_uploaded=$false
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    Write-Host 'AGENT06_ONLINE_INSTALLED_GUI_WITNESS_PASS'
}catch{
    $allow=@(
        'VALIDATE','NATIVE_FIRST','CREATE','GUI_FIRST','DASHBOARD_FIRST','NATIVE_COLD_REOPEN',
        'COLD_READBACK','DASHBOARD_COLD','REMOVE','NATIVE_COLD_REMOVE_REOPEN',
        'COLD_REMOVE_READBACK','GUI_COLD_REMOVE','RESULT'
    )
    if($phase -cnotin $allow){$phase='VALIDATE'}
    # Return only fixed, non-secret witness reason codes; never return UI
    # text, paths, account details or private exception messages.
    $safeCodes=@(
        'agent062_dashboard_native_window_closed',
        'agent062_dashboard_home_navigation_missing',
        'agent062_dashboard_home_missing',
        'agent062_dashboard_customize_missing',
        'agent062_dashboard_add_missing',
        'agent062_dashboard_catalog_widget_missing',
        'agent062_dashboard_finish_missing',
        'agent062_dashboard_widget_missing',
        'agent06_online_ui_button_missing',
        'agent06_online_native_core_unavailable',
        'agent06_online_native_exited_before_ready',
        'agent06_online_native_window_closed',
        'agent06_online_gui_section_unavailable',
        'agent06_online_gui_remaining_account_absent',
        'agent06_online_gui_first_account_absent',
        'agent06_online_gui_deleted_account_still_present',
        'agent06_online_phase_create_failed',
        'agent06_online_phase_create_receipt_invalid',
        'agent06_online_phase_readback_failed',
        'agent06_online_phase_readback_receipt_invalid',
        'agent06_online_phase_remove_failed',
        'agent06_online_phase_remove_receipt_invalid',
        'agent06_online_phase_postremove_failed',
        'agent06_online_phase_postremove_receipt_invalid'
    )
    $safeReason='other'
    if([string]$_.Exception.Message -cin $safeCodes){
        $safeReason=[string]$_.Exception.Message
    }
    [ordered]@{
        schema='IWXA_AGENT062_INSTALLED_GUI_AND_HOME_WITNESS/1'
        status='FAIL'
        phase=$phase
        failure_code=$safeReason
        ui_checkpoint=$uiCheckpoint
        original_core_started=$started
        real_external_effects_performed=$false
        public_artifacts_uploaded=$false
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    Write-Host ('AGENT06_ONLINE_INSTALLED_GUI_WITNESS_FAIL:'+ $phase)
    exit 1
}finally{
    NativeStop
    if($started){$null=CoreControl 'stop'}
    foreach($name in @('LOCALAPPDATA','APPDATA','USERPROFILE','TEMP','TMP')){
        [Environment]::SetEnvironmentVariable($name,$originalEnv[$name],'Process')
    }
}
