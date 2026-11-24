# Shared native UI Automation driver for the exact installed witnesses.
# Dot-source only after the caller's disposable-runner/STA checks.
# Import only the exact allowlisted native GUI functions from the pinned
# public Publisher qualification. Never execute its provisioning or main body.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile(
 (Resolve-Path -LiteralPath $GuiDriver).Path,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'EMPLOYEE_INSTALLED_DRIVER_PARSE_FAILED'}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$definitions=@($ast.FindAll({
 param($n)
 $n -is [System.Management.Automation.Language.CommandAst] -and
 $n.GetCommandName() -ceq 'Add-Type' -and
 @($n.CommandElements|Where-Object {$_ -is [System.Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -ceq 'TypeDefinition'}).Count -eq 1
},$false))
if($definitions.Count -ne 1 -or $definitions[0].CommandElements.Count -ne 3 -or
 $definitions[0].CommandElements[2] -isnot [System.Management.Automation.Language.StringConstantExpressionAst]){
 throw 'EMPLOYEE_INSTALLED_DRIVER_TYPE_INVALID'
}
Add-Type -TypeDefinition $definitions[0].CommandElements[2].Value
$names=@('Gui-Step','Digest','Start-App','Window','Control','Press','Focus-App','Enter',
 'Read-Edit','Select-FirstReal','Wait-Text','Has-Text','Original-Confirm','Wait-ExactText',
 'Picker-Foreground','Native-FileDialog','Stop-App')
foreach($name in $names){
 $nodes=@($ast.FindAll({
  param($n)
  $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name
 },$false))
 if($nodes.Count -ne 1){throw 'EMPLOYEE_INSTALLED_DRIVER_FUNCTION_MISSING'}
 . ([scriptblock]::Create($nodes[0].Extent.Text))
}
function Open-CenterRegistry($process){
 Press $process 'Personal Agent и лицензии' $true
 Press $process 'Управление корпоративными местами' $true
 Wait-Text $process 'Подписанный T3 D3 получатель доступен' 360
 Press $process 'Открыть Workspace T3' $true
 Wait-Text $process 'К приёмке' 160
 Wait-Text $process 'Рабочие данные находятся в локальном пространстве домена' 240
 Press $process 'К приёмке' $true
 Wait-Text $process 'Зарезервированные места / лимит' 240
 Wait-Text $process 'Получить профиль подключения' 240
}
# Workbench V8 exposes "Задачи" on its always available primary rail.
# The active-only context group is not a button named "Работа".
# Resolve the actual current visible child after entering the rail section.
function Agent-VisibleButton($process,[string]$name){
 $items=(Window $process).FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.PropertyCondition]::new(
   [System.Windows.Automation.AutomationElement]::NameProperty,$name))
 foreach($item in $items){
  try{
   if($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
     !$item.Current.IsOffscreen -and $item.Current.IsEnabled){return $true}
  }catch{}
 }
 return $false
}
function Enter-AgentCompanyPage($process){
 Press $process 'Задачи'
 # The active rail now exposes Work's contextual sidebar. Expand the
 # real sidebar/disclosure if the saved layout has them collapsed.
 for($i=0;$i -lt 120;$i++){
  if(Agent-VisibleButton $process 'Работа в организации'){break}
  if(Agent-VisibleButton $process 'Открыть панель'){
   Press $process 'Открыть панель'
  }elseif(Agent-VisibleButton $process 'Показать подразделы Работа'){
   Press $process 'Показать подразделы Работа'
  }
  Start-Sleep -Milliseconds 250
 }
 if(!(Agent-VisibleButton $process 'Работа в организации')){throw 'CORPORATE_GUI_AGENT_COMPANY_NAVIGATION_NOT_AVAILABLE'}
 Press $process 'Работа в организации'
 Wait-Text $process 'Работа в организации' 240
}

# Consent-bearing employee operations must activate the exact focused button.
# One ordinary keyboard activation; never re-dispatch when the outcome is unknown.
function Press-VerifiedEmployeeButton($process,[string]$name){
 Gui-Step 'BUTTON'
 Focus-App $process
 $element=Control $process $name
 for($i=0;$i -lt 60 -and !$element.Current.IsEnabled;$i++){
  Start-Sleep -Milliseconds 200
  $element=Control $process $name
 }
 if(!$element.Current.IsEnabled){throw 'EMPLOYEE_INSTALLED_CONSENT_BUTTON_DISABLED'}
 try{$element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()}catch{}
 $element.SetFocus()
 $focused=$false
 for($i=0;$i -lt 20;$i++){
  try{
   $active=[System.Windows.Automation.AutomationElement]::FocusedElement
   if($element.Current.HasKeyboardFocus -or ($active -and [System.Windows.Automation.Automation]::Compare($active,$element))){
    $focused=$true
    break
   }
  }catch{}
  Start-Sleep -Milliseconds 100
 }
 if(!$focused -or !$element.Current.IsEnabled -or [CorporateQualificationGui]::GetForegroundWindow() -ne $process.MainWindowHandle){
  throw 'EMPLOYEE_INSTALLED_CONSENT_FOCUS_NOT_CONFIRMED'
 }
 [System.Windows.Forms.SendKeys]::SendWait(' ')
}
