#Requires -Version 5.1
# Synthetic inputs only. Never inspects or launches an application.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../scripts/lib/profile-process-tree.psm1') -Force
function Assert-Equal {
    param($Actual, $Expected, [string]$Label)
    if ($Actual -ne $Expected) { throw "$Label failed." }
}
function New-SyntheticProcess {
    param([int]$Id, [int]$Parent, [int]$Seconds, [string]$Name = 'msedgewebview2.exe', [string]$Command = 'webview.exe')
    [pscustomobject]@{
        ProcessId = $Id; ParentProcessId = $Parent
        CreationDate = ([datetime]'2026-01-01T00:00:00Z').AddSeconds($Seconds)
        Name = $Name; CommandLine = $Command; ExecutablePath = 'C:\private-sentinel\program.exe'
    }
}
$root = New-SyntheticProcess 10 1 10 'chatplus.exe'
$browser = New-SyntheticProcess 11 10 11
$renderer = New-SyntheticProcess 12 11 12 'msedgewebview2.exe' 'webview.exe --type=renderer'
$unrelated = New-SyntheticProcess 99 1 1
$tooOld = New-SyntheticProcess 13 10 9
$key = Get-ProfileProcessIdentity $root
$known = @{}
$tree = @(Select-ProfileProcessTree @($renderer, $tooOld, $unrelated, $root, $browser) $key $known)
Assert-Equal $tree.Count 3 'Unordered descendant attribution'
Assert-Equal (@($tree | Where-Object ProcessId -eq 13).Count) 0 'Child predating parent PID incarnation'
Assert-Equal (@(Select-ProfileProcessTree @($root, $renderer) $key $known).Count) 2 'Observed orphan retention'
$reusedChild = New-SyntheticProcess 12 99 99
Assert-Equal (@(Select-ProfileProcessTree @($root, $reusedChild) $key $known).Count) 1 'Child PID reuse exclusion'
$reusedRoot = New-SyntheticProcess 10 1 100 'chatplus.exe'
$newChild = New-SyntheticProcess 14 10 101
Assert-Equal (@(Select-ProfileProcessTree @($reusedRoot, $newChild, $renderer) $key $known).Count) 1 'Root reuse excludes new tree while retaining observed orphan'

$cases = @(
    @('webview.exe', 'browser'),
    @('', 'unknown'),
    @('webview.exe --type=renderer', 'renderer'),
    @('webview.exe --type="gpu-process"', 'gpu'),
    @('webview.exe --type=crashpad-handler', 'crashpad'),
    @('webview.exe --type=utility --utility-sub-type=network.mojom.NetworkService', 'network'),
    @('webview.exe --type=utility --utility-sub-type=storage.mojom.StorageService', 'storage'),
    @('webview.exe --type=utility --utility-sub-type=audio.mojom.AudioService', 'audio'),
    @('webview.exe --type=utility --utility-sub-type=private.UNKNOWN', 'utility'),
    @('webview.exe --type=unexpected', 'unknown'),
    @('webview.exe --type=malformed123', 'unknown')
)
foreach ($case in $cases) {
    $item = New-SyntheticProcess 15 10 15 'msedgewebview2.exe' $case[0]
    Assert-Equal (Get-ProfileProcessRole $item $key) $case[1] 'Allowlisted role classification'
}
Assert-Equal (Get-ProfileProcessRole $root $key) 'native' 'Pinned native role'
Assert-Equal (Get-ProfileProcessRole (New-SyntheticProcess 16 10 16 'crashpad_handler.exe') $key) 'crashpad' 'Crashpad executable role'
Assert-Equal (Get-ProfileProcessRole (New-SyntheticProcess 17 10 17 'private-sentinel.exe') $key) 'unknown' 'Unknown helper role'
$sentinel = 'PRIVATE_QUERY_SENTINEL_7c0d'
$malicious = New-SyntheticProcess 18 10 18 'msedgewebview2.exe' ('webview.exe --type=renderer --url=https://private.invalid/?token=' + $sentinel)
$export = ConvertTo-ProfileProcessRecord $malicious $key | ConvertTo-Json -Compress
Assert-Equal ($export.Contains($sentinel)) $false 'Query text never serialized'
Assert-Equal ($export.Contains('private-sentinel')) $false 'Executable path never serialized'
Assert-Equal ($export.Contains('CommandLine')) $false 'Raw command field never serialized'
Assert-Equal ($export.Contains('ExecutablePath')) $false 'Raw executable path field never serialized'

$completeRow = [pscustomobject]@{ privateBytes = 100; workingSetBytes = 200; privateWorkingSetBytes = $null; cpuPercent = 2.5; handles = 5 }
$totals = Get-ProfileTotals @($completeRow, $completeRow) $true
Assert-Equal $totals.privateBytes 200 'Additive private bytes'
Assert-Equal $totals.workingSetBytes 400 'Explicit working-set sum'
Assert-Equal $totals.cpuPercent 5 'CPU delta sum'
Assert-Equal $totals.processCount 2 'Process count'
Assert-Equal $totals.privateWorkingSetBytes $null 'Unavailable optional metric remains unavailable'
$incomplete = Get-ProfileTotals @($completeRow) $false
foreach ($metric in @('privateBytes', 'workingSetBytes', 'privateWorkingSetBytes', 'cpuPercent', 'handles')) {
    Assert-Equal $incomplete.$metric $null 'Incomplete total cannot masquerade as partial sum'
}
Write-Output 'PASS: process attribution, orphan retention, PID reuse, allowlisted roles, private-data exclusion and incomplete totals.'
