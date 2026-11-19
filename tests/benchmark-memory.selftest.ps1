#Requires -Version 5.1
# Synthetic data only. Does not launch or inspect any application.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../scripts/lib/benchmark-memory.psm1') -Force
function Assert-Equal { param($Actual,$Expected,[string]$Label) if ($Actual -ne $Expected) { throw "$Label expected $Expected, got $Actual" } }
function New-SyntheticProcess { param([int]$Id,[int]$Parent,[int]$Age,[string]$Name='helper.exe') [pscustomobject]@{ ProcessId=$Id; ParentProcessId=$Parent; CreationDate=[datetime]'2026-01-01T00:00:00Z' + [timespan]::FromSeconds($Age); Name=$Name } }
$root=New-SyntheticProcess 100 1 10 'chatplus.exe'
$webview=New-SyntheticProcess 101 100 11 'msedgewebview2.exe'
$renderer=New-SyntheticProcess 102 101 12 'msedgewebview2.exe'
$unrelated=New-SyntheticProcess 200 1 1 'msedgewebview2.exe'
$oldChild=New-SyntheticProcess 201 100 9 'msedgewebview2.exe'
$known=@{}
$key=Get-BenchmarkProcessKey $root
$tree=@(Select-BenchmarkProcessTree @($renderer,$oldChild,$unrelated,$root,$webview) $key $known)
Assert-Equal $tree.Count 3 'Descendants only, independent of input ordering'
Assert-Equal (@($tree | Where-Object ProcessId -eq 200).Count) 0 'Unrelated WebView excluded'
Assert-Equal (@($tree | Where-Object ProcessId -eq 201).Count) 0 'Parent PID reused after child birth excluded'
$orphanTree=@(Select-BenchmarkProcessTree @($root,$renderer) $key $known)
Assert-Equal $orphanTree.Count 2 'Previously attributed orphan retained'
$reused=New-SyntheticProcess 102 999 99 'unrelated.exe'
$reusedTree=@(Select-BenchmarkProcessTree @($root,$reused) $key $known)
Assert-Equal $reusedTree.Count 1 'Known child PID reuse excluded'
$newRoot=New-SyntheticProcess 100 1 100 'chatplus.exe'
$newRootTree=@(Select-BenchmarkProcessTree @($newRoot) $key $known)
Assert-Equal $newRootTree.Count 0 'Pinned root PID reuse excluded'

$samples=@()
foreach ($pair in @(@(40,100),@(70,20))) {
    $scopes=@{}
    foreach ($scope in @('shell','webview','total')) {
        $ws = if ($scope -eq 'shell') { $pair[0] } elseif ($scope -eq 'webview') { $pair[1] } else { $pair[0]+$pair[1] }
        $scopes[$scope]=@{ working_set_bytes=$ws; private_bytes=$ws; private_working_set_bytes=$null; commit_bytes=$ws; os_peak_working_set_bytes=$(if ($scope -eq 'shell') { 200 } else { $null }); cpu_percent=2; process_count=$(if ($scope -eq 'total') { 2 } else { 1 }) }
    }
    $samples+=@{scopes=$scopes}
}
$metrics=Get-BenchmarkRunMetrics $samples 1 $null
Assert-Equal $metrics['total.sampled_peak_working_set_bytes'] 140 'Synchronized tree peak, not sum of process maxima'
Assert-Equal $metrics['total.working_set_bytes'] 115 'Per-run sample mean'
Assert-Equal $metrics['total.os_peak_working_set_bytes'] $null 'No asynchronous total peak'
Assert-Equal $metrics['total.private_working_set_bytes'] $null 'Absent counter remains null'
Assert-Equal $metrics['total.startup_ms'] $null 'Unobserved startup remains null'
Assert-Equal $metrics['total.service_count'] 1 'Prepared service count'
$stats=Get-BenchmarkSummary @(1,3,9,2,5)
Assert-Equal $stats.mean 4 'Mean'
Assert-Equal $stats.median 3 'Odd median'
Assert-Equal $stats.min 1 'Minimum'
Assert-Equal $stats.max 9 'Maximum'
Assert-Equal (Get-BenchmarkSummary @(1,3,9,2)).median 2.5 'Even median'
Assert-Equal (Get-BenchmarkSummary @()) $null 'Empty aggregate unavailable'
Write-Output 'PASS: synthetic process attribution, PID reuse, orphan retention, synchronized peaks, unavailable counters and aggregates.'
