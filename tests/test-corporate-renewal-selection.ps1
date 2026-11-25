# Read-only StrictMode regression. Import only the pure selection helper,
# never execute the installed witness or any signing / native GUI operation.
param([string]$Witness=(Join-Path $PSScriptRoot 'installed-publisher-center-corporate.ps1'))
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $Witness).Path,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'RENEWAL_SELECTION_WITNESS_PARSE_FAILED'}
$functions=@($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Find-RenewalPreparation'
},$false))
if($functions.Count -ne 1){throw 'RENEWAL_SELECTION_HELPER_REQUIRED'}
. ([scriptblock]::Create($functions[0].Extent.Text))
$original=[pscustomobject]@{id='initial'}
$renewal=[pscustomobject]@{id='successor';previousProposalId='initial'}
$other=[pscustomobject]@{id='unrelated';previousProposalId='other'}
$checks=0
foreach($case in @(
  @{proposals=@($original,$renewal);expected=1},
  @{proposals=@($renewal,$original);expected=1},
  @{proposals=@($original,$other);expected=0},
  @{proposals=@($original,$renewal,$other);expected=1},
  @{proposals=@($original,$renewal,[pscustomobject]@{id='second';previousProposalId='initial'});expected=2},
  @{proposals=@([pscustomobject]@{id='null-link';previousProposalId=$null},$original);expected=0}
)){
  $result=@(Find-RenewalPreparation ([pscustomobject]@{proposals=$case.proposals}) 'initial')
  if($result.Count -ne $case.expected){throw 'RENEWAL_SELECTION_COUNT_MISMATCH'}
  if($case.expected -eq 1 -and $result[0].id -cne 'successor'){throw 'RENEWAL_SELECTION_WRONG_ID'}
  $checks++
}
Write-Host ('RENEWAL_SELECTION_STRICT_MODE=PASS checks='+$checks)
