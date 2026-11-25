# Genuine installed Admin Center and Agent, disposable public Center CI only.
# No native owner write shortcuts, no injected IPC, no private evidence upload.
# The original Publisher two-product witness remains an independent gate.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$CenterExe,
 [Parameter(Mandatory=$true)][string]$AgentRoot,
 [Parameter(Mandatory=$true)][string]$GuiDriver
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(!$IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or
 $env:GITHUB_REPOSITORY -cne 'Faust-S/Center' -or
 $env:GITHUB_REF -cne 'refs/heads/work/2026-11-24-corporate-installed-one-core' -or
 $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
 $env:IWXA_T3_SYNTHETIC_PROVISION -cne 'CORPORATE_CENTER_CI_FIXTURE_ONLY'){
 throw 'EMPLOYEE_INSTALLED_DISPOSABLE_RUNNER_REQUIRED'
}
if([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA'){
 throw 'EMPLOYEE_INSTALLED_STA_REQUIRED'
}
$CenterExe=(Resolve-Path -LiteralPath $CenterExe).Path
$AgentRoot=(Resolve-Path -LiteralPath $AgentRoot).Path
$agentExe=Join-Path $AgentRoot 'desktop/bin/IWXA Personal.exe'
if(!(Test-Path -LiteralPath $agentExe -PathType Leaf)){
 throw 'EMPLOYEE_INSTALLED_AGENT_EXE_MISSING'
}
$centerReg=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center'
$agentReg=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.personal-agent'
if([IO.Path]::GetFullPath($centerReg.InstallLocation) -ine (Split-Path $CenterExe -Parent) -or
 [IO.Path]::GetFullPath($agentReg.InstallLocation) -ine $AgentRoot -or
 [IO.Path]::GetFullPath($centerReg.DataLocation) -ieq [IO.Path]::GetFullPath($agentReg.DataLocation)){
 throw 'EMPLOYEE_INSTALLED_PRODUCT_SCOPE_INVALID'
}
. (Join-Path $PSScriptRoot 'gui-driver.ps1')
$script:guiOrdinal=0;$script:guiLastKind='NONE'
$script:stage='PREPARE'
function Stage([string]$value){
 if($value -cnotmatch '^[A-Z0-9_]{4,80}$'){throw 'EMPLOYEE_INSTALLED_STAGE_INVALID'}
 $script:stage=$value;$script:guiOrdinal=0;$script:guiLastKind='NONE'
}
$checks=[System.Collections.Generic.List[string]]::new()
function Record([string]$value){
 if($value -cnotmatch '^[A-Z0-9_]{4,80}$' -or $checks.Contains($value)){
  throw 'EMPLOYEE_INSTALLED_CHECK_INVALID'
 }
 $checks.Add($value)
 Write-Host ('EMPLOYEE_INSTALLED_CHECK='+$value)
}
function Need([bool]$ok,[string]$code){if(!$ok){throw $code}}
function Copy-Visible($process,[string]$button){
 $sentinel='IWXA_EMPLOYEE_COPY_PENDING_'+[guid]::NewGuid().ToString('N')
 [System.Windows.Forms.Clipboard]::SetText($sentinel)
 try{
  Press $process $button
  for($i=0;$i -lt 100;$i++){
   $value=[System.Windows.Forms.Clipboard]::GetText()
   if($value -and $value -cne $sentinel){
    Need ($value.Length -le 32768) 'EMPLOYEE_INSTALLED_PUBLIC_TRANSFER_TOO_LARGE'
    return $value
   }
   Start-Sleep -Milliseconds 200
  }
  throw 'EMPLOYEE_INSTALLED_PUBLIC_COPY_NOT_OBSERVED'
 }finally{[System.Windows.Forms.Clipboard]::Clear()}
}
function Open-AgentCompany($process){
 Stage 'AGENT_V8_NAVIGATION'
 Enter-AgentCompanyPage $process
 Stage 'AGENT_T3_PROFILE_READINESS'
 # Startup preference read and explicit enable can asynchronously replace
 # the readiness button. Resolve the current UIA element and invoke that
 # element, not a second name lookup after React replaced it.
 $readDispatched=$false;$enableDispatched=$false
 $lastAction='WAIT'
 Focus-App $process
 for($i=0;$i -lt 360;$i++){
  if(Has-Text $process 'Первое подключение к организации'){return}
  foreach($action in @('CHECK','ENABLE')){
   if($action -ceq 'CHECK' -and $readDispatched){continue}
   if($action -ceq 'ENABLE' -and $enableDispatched){continue}
   $id=if($action -ceq 'CHECK'){'iwxa-company-t3-check'}else{'iwxa-company-t3-enable'}
   $name=if($action -ceq 'CHECK'){'Проверить состояние T3'}else{'Включить локальную работу T3'}
   $condition=[System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,$id)
   $matches=@()
   foreach($item in (Window $process).FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)){
    try{
     if($item.Current.Name -ceq $name -and
        $item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
        $item.Current.IsEnabled -and !$item.Current.IsOffscreen){$matches+=,$item}
    }catch{}
   }
   if($matches.Count -gt 1){throw 'EMPLOYEE_INSTALLED_AGENT_T3_ACTION_AMBIGUOUS'}
   if($matches.Count -ne 1){continue}
   $element=$matches[0];$pattern=$null
   try{
    if(!$element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern) -or !$element.Current.IsEnabled){continue}
   }catch{continue}
   # Read-only Check is separate from the one explicit persisted Enable.
   # Once Invoke is entered, a lost ACK is never permission to repeat Enable.
   Gui-Step 'BUTTON'
   if($action -ceq 'CHECK'){$readDispatched=$true}else{$enableDispatched=$true}
   $lastAction=$action
   try{$pattern.Invoke()}catch{$lastAction=$action+'_ACK_UNKNOWN'}
   break
  }
  Start-Sleep -Milliseconds 250
 }
 Write-Host ('EMPLOYEE_INSTALLED_T3_READINESS_LAST_ACTION='+$lastAction)
 throw 'EMPLOYEE_INSTALLED_AGENT_T3_PROFILE_NOT_READY'
}
# Observe finite public status markers only. Never emit a UI name, raw
# exception, profile content, path, identity, key or other native evidence.
function Profile-Diagnostic($process,[string]$phase){
 $known=@(
  @('T3_EMPLOYEE_WINDOWS_PARENT_NOT_TRUSTED','T3_EMPLOYEE_WINDOWS_PARENT_NOT_TRUSTED'),
  @('T3_EMPLOYEE_WINDOWS_CANDIDATE_EXISTS_READBACK','T3_EMPLOYEE_WINDOWS_CANDIDATE_EXISTS_READBACK'),
  @('T3_EMPLOYEE_WINDOWS_CANDIDATE_NOT_FOUND','T3_EMPLOYEE_WINDOWS_CANDIDATE_NOT_FOUND'),
  @('T3_EMPLOYEE_BOOTSTRAP_FINGERPRINT_MISMATCH','T3_EMPLOYEE_BOOTSTRAP_FINGERPRINT_MISMATCH'),
  @('T3_EMPLOYEE_BOOTSTRAP_READBACK_MISMATCH','T3_EMPLOYEE_BOOTSTRAP_READBACK_MISMATCH'),
  @('T3_EMPLOYEE_WINDOWS_CANDIDATE_BINDING_CHANGED','T3_EMPLOYEE_WINDOWS_CANDIDATE_BINDING_CHANGED'),
  @('T3_ORIGINAL_OWNER_NOT_INSTALLED','T3_ORIGINAL_OWNER_NOT_INSTALLED'),
  @('T3_OUTCOME_UNKNOWN_RECONCILE_FIRST','T3_OUTCOME_UNKNOWN_RECONCILE_FIRST'),
  @('T3_EMPLOYEE_EXPLICIT_ISSUER_CONFIRMATION_REQUIRED','T3_EMPLOYEE_EXPLICIT_ISSUER_CONFIRMATION_REQUIRED'),
  @('T3_EMPLOYEE_ISSUER_PUBLIC_KEY_INVALID','T3_EMPLOYEE_ISSUER_PUBLIC_KEY_INVALID'),
  @('T3_EMPLOYEE_WINDOWS_ROOT_REQUIRED','T3_EMPLOYEE_WINDOWS_ROOT_REQUIRED'),
  @('T3_EMPLOYEE_WINDOWS_CANDIDATE_DPAPI_REQUIRED','T3_EMPLOYEE_WINDOWS_CANDIDATE_DPAPI_REQUIRED'),
  @('T3_EMPLOYEE_BOOTSTRAP_PROFILE_INVALID','T3_EMPLOYEE_BOOTSTRAP_PROFILE_INVALID'),
  @('Исходный T3 не подтвердил точный профиль сотрудника.','UI_CANDIDATE_NOT_VERIFIED'),
  @('Вставьте полный исходный профиль из Admin Center.','UI_BOOTSTRAP_PROFILE_REJECTED')
 )
 foreach($pair in $known){
  if(Has-Text $process $pair[0]){
   Write-Host ('EMPLOYEE_INSTALLED_PROFILE_DIAGNOSTIC='+$phase+':'+$pair[1])
   return
  }
 }
 Write-Host ('EMPLOYEE_INSTALLED_PROFILE_DIAGNOSTIC='+$phase+':NO_RECOGNIZED_UI_STATUS')
}
function Wait-ProfileConfirmation($process,[int]$attempts){
 for($i=0;$i -lt $attempts;$i++){
  if(Has-Text $process 'Локальный профиль подтверждён'){return $true}
  Start-Sleep -Milliseconds 500
 }
 return $false
}
function Complete-EmployeeProfileReadback($process){
 Stage 'AGENT_PROFILE_CREATE_ONCE'
 Press $process 'Создать свой защищённый профиль'
 Stage 'AGENT_PROFILE_CONFIRMATION'
 if(Wait-ProfileConfirmation $process 120){
  Write-Host 'EMPLOYEE_INSTALLED_PROFILE_READBACK=FIRST_ACK'
  return
 }
 Profile-Diagnostic $process 'CREATE'
 # A timeout does NOT prove creation failed. Recover the original candidate
 # using the explicit read-only control. Never generate a second credential.
 Stage 'AGENT_PROFILE_EXISTING_READBACK'
 Press $process 'Прочитать ранее созданный профиль'
 if(!(Wait-ProfileConfirmation $process 120)){
  Profile-Diagnostic $process 'READ'
  throw 'EMPLOYEE_INSTALLED_AGENT_PROFILE_READBACK_NOT_CONFIRMED'
 }
 Write-Host 'EMPLOYEE_INSTALLED_PROFILE_READBACK=RECOVERED_EXISTING'
}
function Sign-EmployeeChallenge($process,[string]$request,$candidate){
 $q=$request|ConvertFrom-Json -Depth 20
 Need ($q.request.actorId -ceq $candidate.employeePersonId -and
  $q.request.principalId -ceq $candidate.organizationId -and
  $q.request.resource -ceq $candidate.workspaceId) 'EMPLOYEE_INSTALLED_CHALLENGE_SCOPE_INVALID'
 Enter $process 'Запрос подтверждения из Admin Center' $request
 Press $process 'Подписать запрос'
 Wait-Text $process 'Скопировать ответ' 240
 $raw=Copy-Visible $process 'Скопировать ответ'
 $proof=$raw|ConvertFrom-Json -Depth 20
 Need ($proof.schema -ceq 'IWXA_T3_ACCESS_SIGNED/1' -and
  $proof.keyId -ceq $candidate.credentialKeyId -and
  $proof.payload.kind -ceq 'PROOF' -and $proof.payload.challenge -ceq $q.challenge -and
  $proof.signature -cmatch '^[A-Za-z0-9_-]{86}$') 'EMPLOYEE_INSTALLED_PROOF_SCOPE_INVALID'
 return $raw
}
$work=Join-Path $env:RUNNER_TEMP ('iwxa-employee-first-use-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work|Out-Null
$invite=Join-Path $work 'employee-invitation.iwxa'
$taskFile=Join-Path $work 'employee-task.iwxa'
$cen=$null;$agent=$null
try{
 Stage 'CENTER_PROFILE'
 $cen=Start-App $CenterExe
 # The previously qualified Admin first-use created only an organization
 # and registry. Add a real local contact via its ordinary GUI.
 Press $cen 'Сотрудники и роли'
 Enter $cen 'Имя' 'Installed employee qualification'
 Press $cen 'Добавить участника'
 Wait-Text $cen 'Installed employee qualification' 120
 Open-CenterRegistry $cen
 Wait-Text $cen 'Административный реестр отделён от рабочей Workspace' 240
 Record 'ORIGINAL_REGISTRY_SEPARATE_WORKSPACE'
 Select-FirstReal $cen 'Сотрудник в организации'
 Press $cen 'Получить профиль подключения'
 Wait-Text $cen 'Скопировать профиль' 240
 $profileRaw=Copy-Visible $cen 'Скопировать профиль'
 $fingerprint=(Copy-Visible $cen 'Скопировать отпечаток').Trim()
 $profile=$profileRaw|ConvertFrom-Json -Depth 20
 Need ($fingerprint -cmatch '^[a-f0-9]{64}$' -and
  $profile.organizationName -ceq 'G4WindowsOrganization' -and
  !$profileRaw.Contains('PRIVATE KEY')) 'EMPLOYEE_INSTALLED_BOOTSTRAP_PROFILE_INVALID'
 # Use the same independent canonical digest check as the previous installed
 # Center first-use witness; never print the public profile or identifiers.
 $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($profileRaw))
 $code="const p=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));const c='{'+Object.keys(p).sort().map(k=>JSON.stringify(k)+':'+JSON.stringify(p[k])).join(',')+'}';process.stdout.write(require('node:crypto').createHash('sha256').update(c).digest('hex'))"
 $actual=(& node -e $code $encoded)
 Need ($LASTEXITCODE -eq 0 -and $actual -ceq $fingerprint) 'EMPLOYEE_INSTALLED_PROFILE_DIGEST_INVALID'
 Record 'CENTER_EXACT_PUBLIC_BOOTSTRAP'
 Stage 'AGENT_OWN_PROFILE'
 $agent=Start-App $agentExe $AgentRoot
 Open-AgentCompany $agent
 Stage 'AGENT_OWN_PROFILE'
 Wait-Text $agent 'Первое подключение к организации' 240
 Enter $agent 'Профиль подключения' $profileRaw
 Enter $agent 'Подтверждённый отпечаток профиля SHA-256' $fingerprint
 Complete-EmployeeProfileReadback $agent
 $candidateRaw=Copy-Visible $agent 'Скопировать публичную запись'
 $candidate=$candidateRaw|ConvertFrom-Json -Depth 20
 Need ($candidate.schema -ceq 'IWXA_T3_ORIGINAL_EMPLOYEE_WINDOWS_CANDIDATE/1' -and
  $candidate.organizationId -ceq $profile.organizationId -and
  $candidate.workspaceId -ceq $profile.workspaceId -and
  $candidate.managerPersonId -ceq $profile.managerPersonId -and
  $candidate.employeePersonId -cne $profile.managerPersonId -and
  $candidate.profileDigest -ceq $fingerprint -and
  $candidate.originalKernelEnrollment -eq $false -and $candidate.originalSignedGrant -eq $false -and
  !$candidateRaw.Contains('PRIVATE KEY')) 'EMPLOYEE_INSTALLED_CANDIDATE_INVALID'
 Record 'AGENT_INDEPENDENT_PUBLIC_CANDIDATE_NO_GRANTS'
 Stage 'KEY_CHALLENGE'
 Enter $cen 'Публичная запись, полученная от Agent' $candidateRaw
 Press $cen 'Перенести публичную запись'
 Wait-Text $cen 'Публичная запись перенесена' 160
 Need ((Read-Edit $cen 'Подписанная личность T3 сотрудника') -ceq $candidate.employeePersonId -and
  (Read-Edit $cen 'Идентификатор публичного PROOF-ключа') -ceq $candidate.credentialKeyId) 'EMPLOYEE_INSTALLED_CENTER_IDENTITY_INVALID'
 Press $cen '1. Запросить подтверждение ключа'
 Wait-Text $cen 'Скопировать запрос ключа' 240
 $keyChallenge=Copy-Visible $cen 'Скопировать запрос ключа'
 $keyProof=Sign-EmployeeChallenge $agent $keyChallenge $candidate
 Enter $cen 'Оригинальный подписанный ответ сотрудника' $keyProof
 Wait-Text $cen 'Ответ ключа соответствует текущему запросу' 120
 Press-VerifiedEmployeeButton $cen 'Подтвердить ключ и перечитать Kernel'
 Original-Confirm $cen 'IWXA T3: подтвердить ключ сотрудника'
 Wait-Text $cen 'Публичный PROOF-ключ подтверждён оригинальным Kernel' 240
 Record 'ORIGINAL_PROOF_ADMISSION_THROUGH_INSTALLED_UI'
 Stage 'ENROLLMENT_CHALLENGE'
 Press $cen '2. Запросить подтверждение сотрудника'
 Wait-Text $cen 'Скопировать запрос подключения' 240
 $memberChallenge=Copy-Visible $cen 'Скопировать запрос подключения'
 Need (($memberChallenge|ConvertFrom-Json -Depth 20).challenge -cne
  ($keyChallenge|ConvertFrom-Json -Depth 20).challenge) 'EMPLOYEE_INSTALLED_CHALLENGE_REUSED'
 $memberProof=Sign-EmployeeChallenge $agent $memberChallenge $candidate
 Enter $cen 'Подписанный ответ сотрудника' $memberProof
 Wait-Text $cen 'Ответ подключения соответствует текущему запросу' 120
 Press-VerifiedEmployeeButton $cen 'Выдать ACTION/DATA и перечитать STATUS'
 Original-Confirm $cen 'IWXA T3: выдать полномочия сотруднику'
 Wait-Text $cen 'Подтверждены отдельные ACTION work.prepare и DATA package.export' 240
 Record 'ORIGINAL_DISTINCT_MEMBERSHIP_PROOF_AND_GRANTS'
 Stage 'WORKSPACE_RIGHTS'
 Press-VerifiedEmployeeButton $cen 'Разрешить работу и перенос Workspace'
 Original-Confirm $cen 'IWXA T3: права сотрудника в Workspace'
 Wait-Text $cen 'Четыре права подтверждены исходным Kernel' 240
 Record 'ORIGINAL_FOUR_WORKSPACE_GRANTS'
 Stage 'RETURN_EXPORT_RIGHT'
 Press-VerifiedEmployeeButton $cen 'Разрешить возврат полной Workspace'
 Original-Confirm $cen 'IWXA T3: права сотрудника в Workspace'
 Wait-Text $cen 'Отдельное право DATA подтверждено' 240
 Record 'ORIGINAL_ADDITIVE_WORKSPACE_RETURN_EXPORT_GRANT'
 Stage 'MANAGER_TASK_RIGHT'
 Press-VerifiedEmployeeButton $cen 'Выдать адресное право на Task'
 Original-Confirm $cen 'IWXA T3: право выдачи поручений сотруднику'
 Wait-Text $cen 'Подтверждено отдельное DATA-право руководителя' 240
 Record 'ORIGINAL_MANAGER_ADDRESSED_TASK_GRANT'
 Stage 'SIGNED_INVITATION'
 Native-FileDialog $cen 'Сохранить персональное приглашение .iwxa' $invite $false
 Wait-Text $cen 'Подписанный .iwxa сохранён, доставка не подтверждена' 240
 Need ((Get-Item -LiteralPath $invite).Length -gt 0) 'EMPLOYEE_INSTALLED_INVITATION_EMPTY'
 Press $agent 'Подключить профиль для получения приглашения'
 Wait-Text $agent 'Ожидается приглашение' 240
 Enter $agent 'Путь к приглашению .iwxa' $invite
 Press $agent 'Проверить приглашение'
 Wait-Text $agent 'Доступ подтверждён' 240
 Record 'AGENT_ORIGINAL_SIGNED_INVITATION_IMPORTED'
 Stage 'AGENT_ORIGINAL_WORKSPACE'
 Press $agent 'Открыть предоставленное пространство'
 try{
  Wait-Text $agent 'Пространство открыто' 240
  Wait-Text $agent $candidate.workspaceId 240
  Wait-Text $agent 'Закрыть Workspace компании' 240
  Wait-Text $agent 'Рабочие данные находятся в локальном пространстве домена' 360
 }catch{
  # A failed original Host mount is not an absent invitation or a UIA
  # retry of a signed write. Publish bounded diagnostic only.
  $codes=@()
  foreach($item in (Window $agent).FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)){
   try{
    $m=[regex]::Match([string]$item.Current.Name,'^Исходная Workspace недоступна\. ((?:T3|INTEROP)_[A-Z0-9_]{4,95})$')
    if($m.Success){$codes+= $m.Groups[1].Value}
   }catch{}
  }
  $codes=@($codes|Sort-Object -Unique)
  if($codes.Count -eq 1){Write-Host ('EMPLOYEE_INSTALLED_WORKSPACE_HOST_CODE='+$codes[0])}
  throw
 }
 Record 'AGENT_ORIGINAL_CORPORATE_WORKSPACE_OPEN'
 Wait-Text $agent 'Право возврата Workspace подтверждено' 240
 Record 'AGENT_ORIGINAL_WORKSPACE_RETURN_GRANT_IMPORTED'
 Stage 'CENTER_COLD_ROSTER'
 Stop-App $cen;$cen=Start-App $CenterExe
 Open-CenterRegistry $cen
 Wait-Text $cen 'Административный реестр отделён от рабочей Workspace' 240
 Record 'CENTER_COLD_ORIGINAL_SEPARATE_REGISTRY'
 Press $cen 'Прочитать подключённых сотрудников'
 Select-FirstReal $cen 'Сотрудник из исходного T3'
 Press $cen 'Открыть подключённого сотрудника'
 Wait-Text $cen 'Подтверждены отдельные ACTION work.prepare и DATA package.export' 240
 Need ((Read-Edit $cen 'Подписанная личность T3 сотрудника') -ceq $candidate.employeePersonId -and
  (Read-Edit $cen 'Идентификатор публичного PROOF-ключа') -ceq $candidate.credentialKeyId) 'EMPLOYEE_INSTALLED_COLD_ROSTER_IDENTITY_INVALID'
 Record 'CENTER_COLD_ORIGINAL_ROSTER_REOPEN'
 Wait-Text $cen 'Отдельное право DATA подтверждено' 240
 Record 'CENTER_COLD_ORIGINAL_RETURN_EXPORT_GRANT'
 # This first-use gate intentionally stops before any licensed Task execution.
 # It cannot qualify Publisher trust, a seat assignment or Result acceptance.
 Write-Host ('EMPLOYEE_INSTALLED_FIRST_USE=PASS checks='+$checks.Count)
}catch{
 Write-Host ('EMPLOYEE_INSTALLED_FAILURE_STAGE='+$script:stage)
 Write-Host ('EMPLOYEE_INSTALLED_FAILURE_STEP='+$script:guiOrdinal)
 Write-Host ('EMPLOYEE_INSTALLED_FAILURE_KIND='+$script:guiLastKind)
 throw
}finally{
 [System.Windows.Forms.Clipboard]::Clear()
 foreach($p in @($agent,$cen)){
  if($null -ne $p){
   try{Stop-App $p}catch{
    $p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
   }
  }
 }
 Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
