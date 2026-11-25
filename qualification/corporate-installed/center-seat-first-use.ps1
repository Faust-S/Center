# Extend the original pinned, installed Windows UIA witness without copying
# its enrollment, DPAPI, mouse and cold-restart machinery. No browser driver,
# IPC injection, signer fixture, private data export or automatic write.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$InstallRoot,
 [Parameter(Mandatory=$true)][string]$OriginalWitness
)
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'CORPORATE_INSTALLED_SEAT_WINDOWS_REQUIRED'}
$first=(Resolve-Path -LiteralPath $OriginalWitness).Path
. $first -InstallRoot $InstallRoot
# The original first-use witness has closed the process after its independent
# DPAPI cold-state read. The same installed Center and user data are reused.
function RegistryChoice([bool]$confirm){
 for($i=0;$i -lt 100;$i++){
  $dialog=[G4InstalledModal]::FindExact($global:appProcess.Id,'IWXA T3: исходный корпоративный реестр')
  if($dialog -ne [IntPtr]::Zero){
   [void][G4InstalledModal]::SetForegroundWindow($dialog)
   $button=[G4InstalledModal]::GetDlgItem($dialog,$(if($confirm){6}else{7}))
   Check ($button -ne [IntPtr]::Zero) 'CORPORATE_INSTALLED_SEAT_REGISTRY_NATIVE_BUTTON_MISSING'
   $rect=[G4InstalledModal+Rect]::new()
   Check ([G4InstalledModal]::GetWindowRect($button,[ref]$rect)) 'CORPORATE_INSTALLED_SEAT_REGISTRY_NATIVE_RECT_MISSING'
   Check (($rect.Right-$rect.Left -ge 4) -and ($rect.Bottom-$rect.Top -ge 4)) 'CORPORATE_INSTALLED_SEAT_REGISTRY_NATIVE_RECT_INVALID'
   [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
    [int][Math]::Round(($rect.Left+$rect.Right)/2),
    [int][Math]::Round(($rect.Top+$rect.Bottom)/2))
   [G4NativeMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
   Start-Sleep -Milliseconds 80
   [G4NativeMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
   RequireDialogDismissed $dialog
   return
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'CORPORATE_INSTALLED_SEAT_REGISTRY_NATIVE_DIALOG_MISSING'
}
function OpenSeatRoute(){
 ClickButton 'Personal Agent и лицензии'
 ClickButton 'Управление корпоративными местами'
 Check (WaitForText 'Подписанный T3 D3 получатель доступен' 100) 'CORPORATE_INSTALLED_SEAT_ORIGINAL_OWNER_NOT_READY'
 ClickButton 'Открыть Workspace T3'
 Check (WaitForText 'К приёмке' 100) 'CORPORATE_INSTALLED_SEAT_WORKSPACE_NOT_OPEN'
}
function WaitWorkspaceGate(){
 # Positive original Overview content is rendered only after verified readback.
 # One UIA traversal per poll; bounded wall time, never a forced sleep on success.
 $watch=[System.Diagnostics.Stopwatch]::StartNew()
 try{
  while($watch.Elapsed.TotalSeconds -lt 300){
   $elements=(DesktopRoot).FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
   $ready=$false;$checking=$false;$denied=$false
   foreach($item in $elements){
    try{$name=[string]$item.Current.Name}catch{continue}
    if($name.Contains('Control не подтвердил чтение выбранной Workspace') -or
       $name.Contains('Не удалось открыть изолированную подписанную Workspace') -or
       $name.Contains('Подписанный доступ Control отозван')){$denied=$true}
    if($name.Contains('Рабочие данные находятся в локальном пространстве домена')){$ready=$true}
    if($name.Contains('Проверяем выбранную подписанную Workspace') -or
       $name.Contains('Создаём и проверяем')){$checking=$true}
   }
   if($denied){throw 'CORPORATE_INSTALLED_SEAT_WORKSPACE_DENIED'}
   if($ready -and !$checking){
    Write-Host 'CORPORATE_INSTALLED_SEAT_WORKSPACE_GATE_READY_PASS'
    return
   }
   Start-Sleep -Milliseconds 350
  }
  throw 'CORPORATE_INSTALLED_SEAT_WORKSPACE_GATE_NOT_READY'
 }finally{
  $watch.Stop()
  Write-Host ('CORPORATE_INSTALLED_SEAT_GATE_MS='+[long]$watch.ElapsedMilliseconds)
 }
}
function WriteSeatDiagnostics(){
 # Only fixed presence codes. Never publish names, IDs, payloads or UI trees.
 $signals=@(
  @('OWNER_READY','Подписанный T3 D3 получатель доступен'),
  @('WORKSPACE_CHECKING','Проверяем выбранную подписанную Workspace'),
  @('WORKSPACE_MISSING','Подписанная Workspace недоступна'),
  @('WORKSPACE_CREATE','Создать выбранную Workspace'),
  @('WORKSPACE_CREATING','Создаём и проверяем'),
  @('WORKSPACE_DENIED','Control не подтвердил чтение выбранной Workspace'),
  @('WORKSPACE_ISOLATED_ERROR','Не удалось открыть изолированную подписанную Workspace'),
  @('WORKSPACE_READY','Рабочие данные находятся в локальном пространстве домена'),
  @('REGISTRY_CHECKING','Проверяем выбранную Workspace и читаем исходный реестр'),
  @('REGISTRY_MISSING','Исходный реестр сотрудников ещё не создан'),
  @('REGISTRY_FAILED','Чтение реестра не подтверждено'),
  @('REGISTRY_TIMEOUT','Исходная Workspace ещё не подтвердила готовность'),
  @('REGISTRY_INIT','Подключить исходный реестр T3'),
  @('SEATS_VIEW','Зарезервированные места / лимит')
 )
 foreach($signal in $signals){
  if(HasText $signal[1]){Write-Host ('CORPORATE_INSTALLED_SEAT_DIAG_'+$signal[0])}
 }
 # Only exact bounded diagnostic protocol tokens, not raw UI text.
 $codes=[System.Collections.Generic.HashSet[string]]::new()
 $elements=(DesktopRoot).FindAll([System.Windows.Automation.TreeScope]::Descendants,
   [System.Windows.Automation.Condition]::TrueCondition)
 foreach($item in $elements){
  try{
   $name=[string]$item.Current.Name
   foreach($m in [regex]::Matches($name,'IWXA: (READ_CONTEXT|READ_KERNEL|VERIFY_RECORD|LIST_KERNEL): (T3_[A-Z0-9_]{3,96}|WORKSPACE_NOT_FOUND|PERMISSION_DENIED|OPERATION_NOT_GRANTED|KERNEL_UNAVAILABLE)(?![A-Z0-9_])')){
    [void]$codes.Add($m.Groups[1].Value+':'+$m.Groups[2].Value)
   }
  }catch{}
 }
 foreach($code in $codes){Write-Host ('CORPORATE_INSTALLED_SEAT_GATE_DETAIL='+$code)}

}
function ReadBootstrapClipboard([string]$button,[string]$code){
 # The actual customer-facing copy button is the proof. Do not assume
 # WebView2 exposes a read-only HTML textarea as a UIA Edit control.
 $sentinel='IWXA_TEST_COPY_PENDING_'+[Guid]::NewGuid().ToString('N')
 Set-Clipboard -Value $sentinel
 try{
  ClickButton $button
  for($i=0;$i -lt 80;$i++){
   try{$value=[string](Get-Clipboard -Raw -ErrorAction Stop)}catch{$value=''}
   if($value -and $value -cne $sentinel){return $value}
   Start-Sleep -Milliseconds 200
  }
  throw $code
 }finally{Set-Clipboard -Value ''}
}
function ReadEmployeeBootstrap(){
 ClickButton 'Получить профиль подключения'
 Write-Host 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_READ_REQUESTED'
 Check (WaitForText 'Скопировать профиль' 100) 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_PROFILE_NOT_SHOWN'
 $raw=ReadBootstrapClipboard 'Скопировать профиль' 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_PROFILE_COPY_FAILED'
 Write-Host 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_PROFILE_COPIED'
 $fingerprint=(ReadBootstrapClipboard 'Скопировать отпечаток' 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_DIGEST_COPY_FAILED').Trim()
 Write-Host 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_DIGEST_COPIED'
 Check ($fingerprint -cmatch '^[a-f0-9]{64}$') 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_DIGEST_INVALID'
 try{$profile=$raw|ConvertFrom-Json -Depth 20}catch{throw 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_JSON_INVALID'}
 Check (@($profile.PSObject.Properties).Count -eq 13) 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_FIELDS_INVALID'
 $draft=Get-Content -LiteralPath (Join-Path $env:CORPORATE_ADMIN_DATA 'atlas-store-v1/preparation/draft.json') -Raw|ConvertFrom-Json -Depth 60
 $org=[string]$draft.activeOrganizationId
 $identity=Get-Content -LiteralPath (Join-Path $env:CORPORATE_ADMIN_DATA ('t3-admin/organizations/'+$org+'/identity.json')) -Raw|ConvertFrom-Json -Depth 20
 Check ($profile.organizationId -ceq $org -and $profile.workspaceId -ceq $identity.workspace -and
    $profile.managerPersonId -ceq $identity.reviewer -and $profile.issuerKeyId -ceq $identity.issuer -and
    $profile.reviewKeyId -ceq $identity.reviewKey -and $profile.organizationName -ceq $identity.organizationName) 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_SCOPE_INVALID'
 Check ($profile.issuerPublicKey -cmatch '^-----BEGIN PUBLIC KEY-----' -and
   $profile.reviewPublicKey -cmatch '^-----BEGIN PUBLIC KEY-----' -and
   !$raw.Contains('PRIVATE KEY')) 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_PUBLIC_KEYS_INVALID'
 # Independent digest of the exact original public profile. No credential,
 # raw profile, organization ID or digest is printed to the public run.
 $json=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw))
 $code="const p=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));const c='{'+Object.keys(p).sort().map(k=>JSON.stringify(k)+':'+JSON.stringify(p[k])).join(',')+'}';process.stdout.write(require('node:crypto').createHash('sha256').update(c).digest('hex'))"
 $actual=(& node -e $code $json)
 Check ($LASTEXITCODE -eq 0 -and $actual -ceq $fingerprint) 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_DIGEST_MISMATCH'
 return $fingerprint
}
function AssertOriginalOwnerReleased([string]$marker){
 Check ($marker -cin @('CORPORATE_INSTALLED_SEAT_OWNER_GRACEFUL_CLOSE_PASS','CORPORATE_INSTALLED_SEAT_OWNER_FINAL_CLOSE_PASS')) 'CORPORATE_INSTALLED_SEAT_OWNER_MARKER_INVALID'
 $draft=Get-Content -LiteralPath (Join-Path $env:CORPORATE_ADMIN_DATA 'atlas-store-v1/preparation/draft.json') -Raw|ConvertFrom-Json -Depth 60
 $org=[string]$draft.activeOrganizationId
 Check ($org -cmatch '^[A-Za-z0-9_-]{1,100}$') 'CORPORATE_INSTALLED_SEAT_OWNER_SCOPE_INVALID'
 $owner=Join-Path $env:CORPORATE_ADMIN_DATA ('t3-admin/organizations/'+$org)
 Check (Test-Path -LiteralPath (Join-Path $owner 'registry.json') -PathType Leaf) 'CORPORATE_INSTALLED_SEAT_OWNER_MISSING'
 # Successful ordinary close must leave the original runtime's lock absent.
 # No deletion, process injection or manual registry repair is allowed.
 for($i=0;$i -lt 40;$i++){
  if(!(Test-Path -LiteralPath (Join-Path $owner 'product.lock')) -and
     !(Test-Path -LiteralPath (Join-Path $owner 'product.recovery.lock'))){
   Write-Host $marker
   return
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'CORPORATE_INSTALLED_SEAT_OWNER_LOCK_RETAINED'
}
function WaitSeatProjection(){
 Check (WaitForText 'Зарезервированные места / лимит' 240) 'CORPORATE_INSTALLED_SEAT_ORIGINAL_VIEW_NOT_OBSERVED'
 Check ((HasText 'Нет действующей лицензии') -or (HasText 'Исходный Consumer недоступен')) 'CORPORATE_INSTALLED_SEAT_UNLICENSED_STATE_NOT_OBSERVED'
 Check (-not (HasText 'Подписанная лицензия актуальна')) 'CORPORATE_INSTALLED_SEAT_FALSE_LICENSE_CLAIM'
}
try{
 StartCenter
 $script:phase='OPEN_SEAT_FIRST_USE'
 OpenSeatRoute
 $script:phase='CREATE_ORIGINAL_WORKSPACE'
 # Corporate creation is handled by the original signed first-run gate.
 # Never race its automatic create with a second manual write.
 WaitWorkspaceGate
 ClickButton 'К приёмке'
 $script:phase='AUTO_READ_MISSING_REGISTRY'
 Check (WaitForText 'Исходный реестр сотрудников ещё не создан' 240) 'CORPORATE_INSTALLED_SEAT_MISSING_READBACK_NOT_OBSERVED'
 Check (-not (HasText 'Зарезервированные места / лимит')) 'CORPORATE_INSTALLED_SEAT_PREMATURE_VIEW'
 Write-Host 'CORPORATE_INSTALLED_SEAT_REGISTRY_MISSING_READ_PASS'
 $script:phase='CANCEL_REGISTRY_INIT'
 ClickButton 'Подключить исходный реестр T3'
 RegistryChoice $false
 Check (WaitForText 'Подключение исходного корпоративного реестра отменено' 100) 'CORPORATE_INSTALLED_SEAT_REGISTRY_CANCEL_NOT_OBSERVED'
 Check (-not (HasText 'Зарезервированные места / лимит')) 'CORPORATE_INSTALLED_SEAT_REGISTRY_CREATED_ON_CANCEL'
 Write-Host 'CORPORATE_INSTALLED_SEAT_REGISTRY_CANCEL_PASS'
 $script:phase='CONFIRM_REGISTRY_INIT'
 ClickButton 'Подключить исходный реестр T3'
 RegistryChoice $true
 WaitSeatProjection
 Write-Host 'CORPORATE_INSTALLED_SEAT_REGISTRY_INITIALIZED_PASS'
 $script:phase='READ_EMPLOYEE_BOOTSTRAP'
 $bootstrapBefore=ReadEmployeeBootstrap
 Write-Host 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_FIRST_PASS'
 $script:phase='COLD_CLOSE_SEAT_WORKSPACE'
 CloseCenter
 AssertOriginalOwnerReleased 'CORPORATE_INSTALLED_SEAT_OWNER_GRACEFUL_CLOSE_PASS'
 $script:phase='COLD_OPEN_SEAT_WORKSPACE'
 StartCenter
 OpenSeatRoute
 WaitWorkspaceGate
 # Do not click create again or the manual registry/seat read controls.
 # The only action is opening the existing Workspace, then returning.
 ClickButton 'К приёмке'
 WaitSeatProjection
 Check (-not (HasText 'Подключить исходный реестр T3')) 'CORPORATE_INSTALLED_SEAT_COLD_REGISTRY_NOT_RESTORED'
 Write-Host 'CORPORATE_INSTALLED_SEAT_COLD_READ_PASS'
 $script:phase='COLD_EMPLOYEE_BOOTSTRAP'
 $bootstrapAfter=ReadEmployeeBootstrap
 Check ($bootstrapAfter -ceq $bootstrapBefore) 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_COLD_CHANGED'
 Write-Host 'CORPORATE_INSTALLED_EMPLOYEE_BOOTSTRAP_COLD_PASS'
 $script:phase='FINAL_CLOSE_ORIGINAL_OWNER'
 CloseCenter
 AssertOriginalOwnerReleased 'CORPORATE_INSTALLED_SEAT_OWNER_FINAL_CLOSE_PASS'
}catch{
 try{WriteSeatDiagnostics}catch{Write-Host 'CORPORATE_INSTALLED_SEAT_DIAG_UNAVAILABLE'}
 Write-Host ('CORPORATE_INSTALLED_SEAT_PHASE_'+$script:phase)
 if($_.Exception.Message -cmatch '^(?:CORPORATE_INSTALLED|G4_INSTALLED)_[A-Z0-9_]{4,100}$'){
  Write-Host ('CORPORATE_INSTALLED_SEAT_FAILURE_CODE='+$_.Exception.Message)
 }
 throw
}finally{
 if($global:appProcess){try{CloseCenter -strict $false}catch{Write-Host 'CORPORATE_INSTALLED_SEAT_CLEANUP_NONBLOCKING'}}
}
