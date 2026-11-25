# Continue the exact native employee after its original Result return and
# the Publisher/Center lifecycle. No provisioning, signing, or direct Store
# mutation. The four ordinary signed carriers are imported through Agent UI.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$AgentRoot,
 [Parameter(Mandatory=$true)][string]$GuiDriver
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(!$IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or
 $env:GITHUB_REPOSITORY -cne 'Faust-S/Center' -or
 $env:GITHUB_REF -cne 'refs/heads/work/2026-11-24-corporate-installed-one-core' -or
 $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
 $env:IWXA_T3_SYNTHETIC_PROVISION -cne 'CORPORATE_CENTER_CI_FIXTURE_ONLY' -or
 [Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA'){
 throw 'EMPLOYEE_LICENSE_CHAIN_DISPOSABLE_RUNNER_REQUIRED'
}
$AgentRoot=(Resolve-Path -LiteralPath $AgentRoot).Path
$agentExe=Join-Path $AgentRoot 'desktop/bin/IWXA Personal.exe'
$reg=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.personal-agent'
if([IO.Path]::GetFullPath($reg.InstallLocation) -ine $AgentRoot -or
 !(Test-Path -LiteralPath $agentExe -PathType Leaf)){
 throw 'EMPLOYEE_LICENSE_CHAIN_INSTALLED_AGENT_REQUIRED'
}
. (Join-Path $PSScriptRoot 'gui-driver.ps1')
. (Join-Path $PSScriptRoot 'exchange-gui-driver.ps1')
$script:guiOrdinal=0;$script:guiLastKind='NONE'
$script:stage='PREPARE'
$checks=[System.Collections.Generic.List[string]]::new()
function Need([bool]$ok,[string]$code){if(!$ok){throw $code}}
function Stage([string]$value){
 $script:stage=$value;$script:guiOrdinal=0;$script:guiLastKind='NONE'
}
function Record([string]$value){
 Need ($value -cmatch '^[A-Z0-9_]{4,100}$' -and !$checks.Contains($value)) 'EMPLOYEE_LICENSE_CHAIN_RECEIPT_INVALID'
 $checks.Add($value)
 Write-Host ('EMPLOYEE_LICENSE_CHAIN_CHECK='+$value)
}
function Open-Company($process){
 Enter-AgentCompanyPage $process
 for($i=0;$i -lt 360;$i++){
  if(Has-Text $process 'Пространство открыто' $true){return 'ORGANIZATION'}
  if(Has-Text $process 'Доступ подтверждён' $true){return 'PERSONAL'}
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSE_CHAIN_EXISTING_MEMBERSHIP_NOT_OBSERVED'
}
function Check-Registry($process,[int]$revision,[int]$count){
 Wait-ExactText $process ('Редакция реестра лицензий: '+$revision+' / Записей: '+$count)
}
function Check-LicenseView($process,[int]$revision,[int]$count,[bool]$active,[int]$tariffRevision=0){
 Check-Registry $process $revision $count
 if($active){
  Wait-Text $process 'Подписанный тариф подтверждён на момент чтения' 360
  Wait-Text $process ('Тариф: TEAM · редакция '+$tariffRevision) 240
  Wait-Text $process 'Ваше назначение подтверждено на момент чтения' 360
 }else{
  Wait-Text $process 'Нет действующей подписанной лицензии' 360
  Wait-Text $process 'Место назначено, но действующая лицензия недоступна' 360
 }
}
function Import-OriginalLicense($process,$row,[bool]$active,[int]$count){
 $path=Join-Path $handoff ([string]$row.file)
 Need ((Digest $path) -ceq $row.sha256) 'EMPLOYEE_LICENSE_CHAIN_CARRIER_CHANGED'
 if($active){
  Need ([DateTimeOffset]::Parse([string]$row.statusValidUntil) -gt [DateTimeOffset]::UtcNow.AddMinutes(1)) 'EMPLOYEE_LICENSE_CHAIN_SUCCESSOR_EXPIRED'
 }
 Enter $process 'Подписанное обновление LICENSE/STATUS (.iwxa)' $path
 Press $process 'Принять подписанное обновление'
 Check-LicenseView $process $row.revision $count $active $row.tariffRevision
}
$handoff=Join-Path $env:RUNNER_TEMP 'iwxa-licensed-employee-handoff'
$prefixPath=Join-Path $handoff 'receipt.json'
$readyPath=Join-Path $handoff 'employee-lifecycle-ready.json'
$chainPath=Join-Path $handoff 'employee-license-chain.json'
$prefix=Get-Content -LiteralPath $prefixPath -Raw|ConvertFrom-Json
$ready=Get-Content -LiteralPath $readyPath -Raw|ConvertFrom-Json
$chain=Get-Content -LiteralPath $chainPath -Raw|ConvertFrom-Json
Need ($prefix.schema -ceq 'IWXA_DISPOSABLE_LICENSED_EMPLOYEE_HANDOFF/1' -and
 $prefix.status -ceq 'ACTIVE' -and $prefix.sequence -eq 1 -and
 $prefix.recipientConfirmed -eq $true -and $prefix.productionActivation -eq $false -and
 $ready.schema -ceq 'IWXA_DISPOSABLE_EMPLOYEE_LIFECYCLE_READY/1' -and
 $ready.status -ceq 'ORIGINAL_RETURN_DELIVERY_CONFIRMED' -and $ready.checks -eq 18 -and
 $ready.originalHandoffSha256 -ceq (Digest $prefixPath) -and
 $ready.organizationId -ceq $prefix.organizationId -and
 $ready.licenseId -ceq $prefix.licenseId -and
 $ready.agentExecutableSha256 -ceq (Digest $agentExe) -and
 $ready.employeePersonId -cmatch '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$' -and
 $ready.taskId -cmatch '^task:licensed-[a-f0-9]{32}$' -and
 $ready.taskPackageSha256 -cmatch '^[a-f0-9]{64}$' -and
 $ready.returnArchiveSha256 -cmatch '^[a-f0-9]{64}$') 'EMPLOYEE_LICENSE_CHAIN_PREVIOUS_RECEIPT_INVALID'
foreach($record in @($ready.taskRecord,$ready.resultRecord)){
 Need ($record.sha256 -cmatch '^[a-f0-9]{64}$' -and $record.revision -cmatch '^[a-f0-9]{64}$' -and
  $record.artifact -cmatch '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$') 'EMPLOYEE_LICENSE_CHAIN_PREVIOUS_RECORD_INVALID'
}
Need ($ready.taskRecord.revision -ceq $ready.resultRecord.revision -and
 $chain.schema -ceq 'IWXA_DISPOSABLE_EMPLOYEE_LICENSE_CHAIN/1' -and
 $chain.status -ceq 'ORIGINAL_PUBLISHER_CENTER_LIFECYCLE_CONFIRMED' -and
 $chain.checks -eq 15 -and $chain.organizationId -ceq $ready.organizationId -and
 $chain.employeePersonId -ceq $ready.employeePersonId -and
 $chain.predecessorLicenseId -ceq $ready.licenseId -and
 $chain.successorLicenseId -and $chain.successorLicenseId -cne $chain.predecessorLicenseId -and
 $chain.lineageId -and $chain.originalHandoffSha256 -ceq (Digest $prefixPath) -and
 $chain.employeeReceiptSha256 -ceq (Digest $readyPath) -and @($chain.rows).Count -eq 4) 'EMPLOYEE_LICENSE_CHAIN_HANDOFF_INVALID'
$expected=@(
 @{file='license-suspended.iwxa';status='SUSPENDED';sequence=2;revision=2;tariffRevision=1;licenseId=$chain.predecessorLicenseId},
 @{file='license-renewed.iwxa';status='ACTIVE';sequence=1;revision=3;tariffRevision=2;licenseId=$chain.successorLicenseId},
 @{file='license-successor-revoked.iwxa';status='REVOKED';sequence=2;revision=4;tariffRevision=2;licenseId=$chain.successorLicenseId},
 @{file='license-predecessor-revoked.iwxa';status='REVOKED';sequence=3;revision=5;tariffRevision=1;licenseId=$chain.predecessorLicenseId}
)
for($i=0;$i -lt 4;$i++){
 $row=$chain.rows[$i];$want=$expected[$i]
 foreach($key in @('file','status','sequence','revision','tariffRevision','licenseId')){
  Need ($row.$key -ceq $want[$key]) 'EMPLOYEE_LICENSE_CHAIN_SEQUENCE_INVALID'
 }
 Need ($row.lineageId -ceq $chain.lineageId -and $row.sha256 -cmatch '^[a-f0-9]{64}$' -and
  (Digest (Join-Path $handoff $want.file)) -ceq $row.sha256) 'EMPLOYEE_LICENSE_CHAIN_BYTES_INVALID'
}
$agent=$null
try{
 Stage 'ORIGINAL_OFFLINE_HISTORY'
 $agent=Start-App $agentExe $AgentRoot
 if((Open-Company $agent) -ceq 'ORGANIZATION'){
  Press $agent 'Вернуться к личной работе'
  # Context selection may reopen the primary Workbench area. Use the same
  # already qualified company navigation rather than assuming the old panel.
  Need ((Open-Company $agent) -ceq 'PERSONAL') 'EMPLOYEE_LICENSE_CHAIN_PERSONAL_CONTEXT_NOT_OBSERVED'
 }
 # The first ACTIVE receipt was checked before real work. It may now have
 # expired legitimately while the other two installed products were working.
 Check-Registry $agent 1 1
 Record 'AGENT_OFFLINE_ORIGINAL_LICENSE_HISTORY_RETAINED'
 Stage 'SUSPENSION'
 Import-OriginalLicense $agent $chain.rows[0] $false 1
 Record 'AGENT_OFFLINE_SUSPENSION_PRESERVES_SEAT'
 Stage 'RENEWAL'
 Import-OriginalLicense $agent $chain.rows[1] $true 2
 Record 'AGENT_OFFLINE_RENEWAL_RESTORES_SAME_SEAT'
 Stage 'SUCCESSOR_REVOCATION'
 Import-OriginalLicense $agent $chain.rows[2] $false 2
 Record 'AGENT_OFFLINE_REVOKED_SUCCESSOR_NO_CAPACITY'
 Stage 'PREDECESSOR_REVOCATION'
 Import-OriginalLicense $agent $chain.rows[3] $false 2
 Record 'AGENT_OFFLINE_REVOKED_PREDECESSOR_NO_CAPACITY'
 Stage 'REPLAY_REVOKED_SUCCESSOR'
 # Replay the actual earlier signed ACTIVE successor, not synthetic bytes.
 # The original Consumer must reject it; the same running Agent must
 # retain its signed history and ordinary readback without a restart.
 $oldActive=Join-Path $handoff ([string]$chain.rows[1].file)
 Need ((Digest $oldActive) -ceq $chain.rows[1].sha256) 'EMPLOYEE_LICENSE_CHAIN_REPLAY_BYTES_CHANGED'
 Need ([DateTimeOffset]::Parse([string]$chain.rows[1].statusValidUntil) -gt [DateTimeOffset]::UtcNow.AddMinutes(1)) 'EMPLOYEE_LICENSE_CHAIN_REPLAY_ACTIVE_STATUS_EXPIRED'
 Enter $agent 'Подписанное обновление LICENSE/STATUS (.iwxa)' $oldActive
 Press-VerifiedEmployeeButton $agent 'Принять подписанное обновление'
 $denial=''
 for($i=0;$i -lt 240;$i++){
  foreach($code in @('CORP_STATUS_TIME_ROLLBACK_DENIED','CORP_STATUS_ROLLBACK_DENIED','CORP_STATUS_REVOKE_RESURRECTION_DENIED')){
   if(Has-Text $agent $code){$denial=$code;break}
  }
  if($denial){break}
  if(Has-Text $agent 'Исход операции неизвестен.'){throw 'EMPLOYEE_LICENSE_CHAIN_DENIED_REPLAY_MARKED_UNKNOWN'}
  Start-Sleep -Milliseconds 250
 }
 Need ([bool]$denial) 'EMPLOYEE_LICENSE_CHAIN_ORIGINAL_REPLAY_REFUSAL_NOT_OBSERVED'
 Wait-ExactText $agent 'Доступ подтверждён'
 Check-LicenseView $agent 5 2 $false
 Need (!(Has-Text $agent 'Исход операции неизвестен.')) 'EMPLOYEE_LICENSE_CHAIN_DENIED_REPLAY_MARKED_UNKNOWN'
 Press $agent 'Проверить лицензию и место'
 Check-LicenseView $agent 5 2 $false
 Record 'AGENT_REVOKED_ACTIVE_REPLAY_DENIED_WITHOUT_LOST_WRITE_HOLD'
 Stage 'COLD_REVOKED_RESULT'
 Stop-App $agent;$agent=Start-App $agentExe $AgentRoot
 if((Open-Company $agent) -ceq 'PERSONAL'){
  Press $agent 'Открыть предоставленное пространство'
  Wait-ExactText $agent 'Пространство открыто'
 }
 Check-LicenseView $agent 5 2 $false
 Wait-Text $agent 'Для нового поручения нужна действующая подписанная лицензия организации.' 240
 Press $agent 'Прочитать сохранённое поручение'
 $taskText='Check the supplier invoice: 12 units at 45 currency units each and delivery at 80. Calculate the total and explain the calculation.'
 Wait-Text $agent $taskText 360
 Press $agent 'Проверить результат'
 Wait-Text $agent 'Оригинальный T2 подтвердил Task и принятый Result в Workspace компании.' 480
 $buttons=(Window $agent).FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Выполнить в Agent'))
 foreach($button in $buttons){
  Need ($button.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button) 'EMPLOYEE_LICENSE_CHAIN_COLD_RESULT_OFFERS_DUPLICATE_SUBMISSION'
 }
 Press $agent 'Открыть Workspace для передачи'
 Exchange-Nav $agent
 Exchange-Action $agent 'iwxa-company-readback-refresh'
 Wait-Text $agent 'Подтверждены рабочие записи:' 240
 $task=Read-CompanyRecord $agent 'Поручение' $ready.taskId $ready.taskPackageSha256 $ready.employeePersonId $taskText
 $result=Read-CompanyRecord $agent 'Результат' $ready.taskId $ready.taskPackageSha256 $ready.employeePersonId ([string](12*45+80))
 Compare-CompanyRecord $ready.taskRecord $task
 Compare-CompanyRecord $ready.resultRecord $result
 Record 'AGENT_COLD_REVOKED_ORIGINAL_RESULT_PRESERVED'
 Need ($checks.Count -eq 7) 'EMPLOYEE_LICENSE_CHAIN_RECEIPTS_INCOMPLETE'
 Write-Host 'EMPLOYEE_LICENSE_CHAIN_PASS checks=7'
}catch{
 Write-Host ('EMPLOYEE_LICENSE_CHAIN_FAILURE_STAGE='+$script:stage)
 Write-Host ('EMPLOYEE_LICENSE_CHAIN_FAILURE_STEP='+$script:guiOrdinal)
 Write-Host ('EMPLOYEE_LICENSE_CHAIN_FAILURE_KIND='+$script:guiLastKind)
 throw
}finally{
 [System.Windows.Forms.Clipboard]::Clear()
 if($null -ne $agent){
  try{Stop-App $agent}catch{
   $agent.Refresh();if(!$agent.HasExited){Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue}
  }
 }
}
