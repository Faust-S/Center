# Native UIA only: actual installed user actions and read-only observations.
# Loaded by the existing disposable-runner STA witness. No browser automation,
# owner API calls, database injection, synthetic receipt or archive construction.
function Exchange-Control($process,[string]$value,[bool]$byId,[int]$attempts=240){
 $property=if($byId){[System.Windows.Automation.AutomationElement]::AutomationIdProperty}else{[System.Windows.Automation.AutomationElement]::NameProperty}
 $condition=[System.Windows.Automation.PropertyCondition]::new($property,$value)
 for($i=0;$i -lt $attempts;$i++){
  $matches=@()
  foreach($item in (Window $process).FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)){
   try{
    if($item.Current.Name -ceq $value -or $byId -and $item.Current.AutomationId -ceq $value){
     $matches+=,$item
    }
   }catch{}
  }
  if($matches.Count -eq 1){return $matches[0]}
  if($matches.Count -gt 1){
   $visible=@($matches|Where-Object {!$_.Current.IsOffscreen})
   if($visible.Count -eq 1){return $visible[0]}
   throw 'EMPLOYEE_LICENSED_EXCHANGE_CONTROL_AMBIGUOUS'
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_CONTROL_MISSING'
}
function Exchange-Action($process,[string]$value,[bool]$byId=$true){
 Gui-Step 'BUTTON'
 Focus-App $process
 $element=$null
 for($i=0;$i -lt 240;$i++){
  try{
   $candidate=Exchange-Control $process $value $byId 1
   if($candidate.Current.IsEnabled){$element=$candidate;break}
  }catch{
   if($_.Exception.Message -cne 'EMPLOYEE_LICENSED_EXCHANGE_CONTROL_MISSING'){throw}
  }
  Start-Sleep -Milliseconds 250
 }
 if(!$element){throw 'EMPLOYEE_LICENSED_EXCHANGE_ACTION_DISABLED'}
 try{$element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()}catch{}
 $pattern=$null
 if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){
  $pattern.Invoke()
 }elseif($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)){
  $pattern.Select()
 }elseif($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){
  if($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed){$pattern.Expand()}
 }else{throw 'EMPLOYEE_LICENSED_EXCHANGE_ACTION_PATTERN_REQUIRED'}
 Start-Sleep -Milliseconds 250
}
function Exchange-Nav($process){
 # The current responsive shell may hide its navigation at a narrow size.
 if(!(Has-Text $process 'Перенос данных' $true) -and (Agent-VisibleButton $process 'Открыть доменную навигацию')){
  Press $process 'Открыть доменную навигацию'
 }
 Gui-Step 'BUTTON'
 Focus-App $process
 $cond=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Перенос данных')
 for($i=0;$i -lt 240;$i++){
  $items=@((Window $process).FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)|Where-Object {
   $_.Current.IsEnabled -and !$_.Current.IsOffscreen -and
   ($_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button)
  })
  if($items.Count -gt 1){throw 'EMPLOYEE_LICENSED_EXCHANGE_NAV_AMBIGUOUS'}
  if($items.Count -eq 1){
   $items[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
   Wait-Text $process 'Рабочие записи организации' 240
   return
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_NAV_MISSING'
}
function Exchange-ReadValue($process,[string]$id,[string]$regex){
 for($i=0;$i -lt 240;$i++){
  try{
   $el=Exchange-Control $process $id $true 1
   $values=@([string]$el.Current.Name)
   $pattern=$null
   if($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){
    $values+=([string]$pattern.DocumentRange.GetText(-1)).Trim()
   }
   foreach($d in $el.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)){
    try{$values+=([string]$d.Current.Name).Trim()}catch{}
   }
   $matches=@($values|Where-Object {$_ -cmatch $regex}|Sort-Object -CaseSensitive -Unique)
   if($matches.Count -eq 1){return [string]$matches[0]}
   if($matches.Count -gt 1){throw 'EMPLOYEE_LICENSED_EXCHANGE_VALUE_AMBIGUOUS'}
  }catch{
   if($_.Exception.Message -eq 'EMPLOYEE_LICENSED_EXCHANGE_VALUE_AMBIGUOUS'){throw}
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_VALUE_MISSING'
}
function Exchange-Confirm($process,[string]$id,[string]$buttonId){
 Gui-Step 'CHECKBOX'
 Focus-App $process
 $control=Exchange-Control $process $id $true
 $toggle=$control.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
 Need ($control.Current.IsEnabled -and $toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) 'EMPLOYEE_LICENSED_EXCHANGE_CONSENT_NOT_FRESH'
 Need (!(Exchange-Control $process $buttonId $true).Current.IsEnabled) 'EMPLOYEE_LICENSED_EXCHANGE_CONSENT_GATE_OPEN'
 $toggle.Toggle()
 for($i=0;$i -lt 120;$i++){
  $fresh=Exchange-Control $process $id $true
  $state=$fresh.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState
  if($state -eq [System.Windows.Automation.ToggleState]::On -and (Exchange-Control $process $buttonId $true).Current.IsEnabled){return}
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_CONSENT_UNCONFIRMED'
}
function Read-CompanyRecord($process,[string]$kind,[string]$taskId,[string]$taskSha,[string]$person,[string]$expectedText){
 # A named details element contains the original verified record; do not
 # accept an unrelated hash, text from a Task catalog or a manager receipt.
 $groupName='Рабочая запись '+$kind+': '+$taskId
 $group=Exchange-Control $process $groupName $false
 $summaryName=$kind+': '+$taskId
 $summaryCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$summaryName)
 $summary=@($group.FindAll([System.Windows.Automation.TreeScope]::Descendants,$summaryCondition))
 if($summary.Count -ne 1){throw 'EMPLOYEE_LICENSED_EXCHANGE_RECORD_SUMMARY_INVALID'}
 $pattern=$null
 if($summary[0].TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){
  if($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed){$pattern.Expand()}
 }else{
  $already=@($group.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name -cmatch '^SHA-256: [a-f0-9]{64}$'})
  if($already.Count -eq 0){
   $summary[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  }
 }
 for($i=0;$i -lt 240;$i++){
  $group=Exchange-Control $process $groupName $false 1
  $values=@($group.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|ForEach-Object {try{([string]$_.Current.Name).Trim()}catch{}})
  $hashes=@($values|ForEach-Object {if($_ -cmatch '^SHA-256: ([a-f0-9]{64})$'){$Matches[1]}}|Sort-Object -Unique)
  $revisions=@($values|ForEach-Object {if($_ -cmatch ('^Исполнитель: '+[regex]::Escape($person)+'\. Редакция: ([a-f0-9]{64})$')){$Matches[1]}}|Sort-Object -Unique)
  $artifacts=@($values|ForEach-Object {if($_ -cmatch '^Артефакт: ([A-Za-z0-9][A-Za-z0-9._:/@-]{0,159})$'){$Matches[1]}}|Sort-Object -Unique)
  if($hashes.Count -eq 1 -and $revisions.Count -eq 1 -and $artifacts.Count -eq 1 -and
    ($values -ccontains ('SHA-256 подписанной Task: '+$taskSha)) -and
    (@($values|Where-Object {$_.Contains($expectedText)}).Count -gt 0)){
    return [pscustomobject]@{sha256=$hashes[0];revision=$revisions[0];artifact=$artifacts[0]}
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_EXACT_RECORD_NOT_OBSERVED'
}
function Compare-CompanyRecord($a,$b){
 Need ($a.sha256 -ceq $b.sha256 -and $a.revision -ceq $b.revision -and $a.artifact -ceq $b.artifact) 'EMPLOYEE_LICENSED_EXCHANGE_RECORD_IDENTITY_CHANGED'
}
function Exchange-Dialog($process,[string[]]$titles){
 $handle=[CorporateQualificationGui]::GetForegroundWindow()
 if($handle -eq [IntPtr]::Zero -or $handle -eq $process.MainWindowHandle){return $null}
 try{
  $dialog=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if($dialog.Current.ClassName -cne '#32770' -or $dialog.Current.Name -cnotin $titles){return $null}
  # A WebView2-owned dialog may belong to a child process, not the host.
  # Verify process ancestry rather than selecting an arbitrary OS window.
  $pidValue=[int]$dialog.Current.ProcessId
  for($n=0;$n -lt 12;$n++){
   if($pidValue -eq $process.Id){return $handle}
   $owner=Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = '+$pidValue) -ErrorAction Stop
   if(!$owner -or $owner.ParentProcessId -eq $pidValue -or !$owner.ParentProcessId){break}
   $pidValue=[int]$owner.ParentProcessId
  }
 }catch{return $null}
 return $null
}
function Exchange-DialogPath([IntPtr]$handle,[string]$file){
 Gui-Step 'FILE_DIALOG'
 Picker-Foreground $handle
 $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1148')
 $dialog=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
 $container=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
 if(!$container){throw 'EMPLOYEE_LICENSED_EXCHANGE_FILENAME_CONTROL_MISSING'}
 $fields=if($container.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit){@($container)}else{
  @($container.FindAll([System.Windows.Automation.TreeScope]::Descendants,
   [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)))
 }
 if($fields.Count -ne 1){throw 'EMPLOYEE_LICENSED_EXCHANGE_FILENAME_CONTROL_INVALID'}
 $field=$fields[0]
 $value=$field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
 $field.SetFocus()
 $value.SetValue($file)
 Need ($value.Current.Value -ceq $file) 'EMPLOYEE_LICENSED_EXCHANGE_FILENAME_READBACK_MISMATCH'
 Picker-Foreground $handle
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 for($i=0;$i -lt 120;$i++){
  if(![CorporateQualificationGui]::IsWindow($handle)){return}
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_FILE_DIALOG_NOT_CLOSED'
}
function Wait-CompletedArchive([string]$file){
 for($i=0;$i -lt 240;$i++){
  if(Test-Path -LiteralPath $file -PathType Leaf){
   try{
    $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    try{$length=$stream.Length}finally{$stream.Dispose()}
    if($length -gt 0){
     $first=Digest $file
     Start-Sleep -Milliseconds 500
     if((Get-Item -LiteralPath $file).Length -eq $length -and (Digest $file) -ceq $first){return $first}
    }
   }catch{}
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_PHYSICAL_ARCHIVE_MISSING'
}
function Export-CompanyArchive($process,[string]$destination){
 # Accept only the exact original displayed filename in the dedicated
 # runner's Downloads folder, or an explicit user-selected native save path.
 $name=Exchange-ReadValue $process 'iwxa-exchange-archive-filename' '^[A-Za-z0-9_.-]{1,240}\.iwxa$'
 $digest=Exchange-ReadValue $process 'iwxa-exchange-archive-digest' '^[a-f0-9]{64}$'
 $downloads=(New-Object -ComObject Shell.Application).Namespace('shell:Downloads')
 if(!$downloads -or !$downloads.Self.Path){throw 'EMPLOYEE_LICENSED_EXCHANGE_DOWNLOADS_NOT_RESOLVED'}
 $default=Join-Path ([string]$downloads.Self.Path) $name
 Need (!(Test-Path -LiteralPath $default) -and !(Test-Path -LiteralPath $destination)) 'EMPLOYEE_LICENSED_EXCHANGE_ARCHIVE_PATH_ALREADY_EXISTS'
 # Use the real physical button for WebView2 download/user activation.
 Press $process 'Скачать .iwxa' $true
 for($i=0;$i -lt 240;$i++){
  if(Test-Path -LiteralPath $default -PathType Leaf){
   $bytesHash=Wait-CompletedArchive $default
   Copy-Item -LiteralPath $default -Destination $destination -ErrorAction Stop
   Need ((Digest $destination) -ceq $bytesHash) 'EMPLOYEE_LICENSED_EXCHANGE_PHYSICAL_COPY_CHANGED'
   Remove-Item -LiteralPath $default -Force
   return [pscustomobject]@{packageDigest=$digest;fileSha256=$bytesHash}
  }
  $dialog=Exchange-Dialog $process @('Save As','Сохранить как','Сохранение')
  if($dialog){
   Exchange-DialogPath $dialog $destination
   return [pscustomobject]@{packageDigest=$digest;fileSha256=(Wait-CompletedArchive $destination)}
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_DOWNLOAD_NOT_OBSERVED'
}
function Import-CompanyArchive($process,[string]$file){
 Need (Test-Path -LiteralPath $file -PathType Leaf) 'EMPLOYEE_LICENSED_EXCHANGE_IMPORT_ARCHIVE_MISSING'
 Press $process 'Выбрать архив .iwxa' $true
 for($i=0;$i -lt 240;$i++){
  $dialog=Exchange-Dialog $process @('Open','Открыть')
  if($dialog){Exchange-DialogPath $dialog $file;return}
  Start-Sleep -Milliseconds 250
 }
 throw 'EMPLOYEE_LICENSED_EXCHANGE_OPEN_DIALOG_NOT_OBSERVED'
}
function Open-CenterExchange($process){
 Press $process 'Открыть Workspace T3' $true
 Wait-Text $process 'Рабочие данные находятся в локальном пространстве домена' 240
 Exchange-Nav $process
}
