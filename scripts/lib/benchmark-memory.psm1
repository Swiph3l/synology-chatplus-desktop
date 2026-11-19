Set-StrictMode -Version Latest

function Get-BenchmarkProcessKey {
    param($Process)
    '{0}@{1}' -f $Process.ProcessId, ([datetime]$Process.CreationDate).ToUniversalTime().Ticks
}

function Select-BenchmarkProcessTree {
    <# Parent IDs alone are unsafe: verify creation times and pin each identity.
       Previously observed descendants survive loss of an intermediate parent. #>
    param([object[]]$Processes, [string]$RootKey, [hashtable]$Known)
    $byId = @{}
    foreach ($item in $Processes) { $byId[[string]$item.ProcessId] = $item }
    $selected = @{}
    foreach ($item in $Processes) {
        $key = Get-BenchmarkProcessKey $item
        if ($key -eq $RootKey -or $Known.ContainsKey($key)) { $selected[$key] = $item }
    }
    do {
        $changed = $false
        foreach ($item in $Processes) {
            $key = Get-BenchmarkProcessKey $item
            if ($selected.ContainsKey($key)) { continue }
            $parent = $byId[[string]$item.ParentProcessId]
            if ($null -eq $parent) { continue }
            $parentKey = Get-BenchmarkProcessKey $parent
            if ($selected.ContainsKey($parentKey) -and ([datetime]$item.CreationDate -ge [datetime]$parent.CreationDate)) {
                $selected[$key] = $item
                $changed = $true
            }
        }
    } while ($changed)
    foreach ($key in @($selected.Keys)) { $Known[$key] = $true }
    @($selected.Values | Sort-Object ProcessId)
}

function Get-BenchmarkSummary {
    param([object[]]$Values)
    $numbers = @($Values | Where-Object { $null -ne $_ } | ForEach-Object { [double]$_ } | Sort-Object)
    if ($numbers.Count -eq 0) { return $null }
    $middle = [int][math]::Floor($numbers.Count / 2)
    $median = $numbers[$middle]
    if ($numbers.Count % 2 -eq 0) { $median = ($numbers[$middle - 1] + $numbers[$middle]) / 2 }
    [ordered]@{
        mean = [double]($numbers | Measure-Object -Average).Average
        median = [double]$median
        min = [double]$numbers[0]
        max = [double]$numbers[-1]
    }
}

function Get-BenchmarkMetricDefinitions {
    foreach ($scope in @('shell', 'webview', 'total')) {
        foreach ($name in @('working_set_bytes', 'private_bytes', 'private_working_set_bytes', 'commit_bytes', 'sampled_peak_working_set_bytes', 'os_peak_working_set_bytes', 'cpu_percent', 'process_count')) {
            [pscustomobject]@{ name = $name; scope = $scope; unit = $(if ($name -eq 'cpu_percent') { 'percent' } elseif ($name -eq 'process_count') { 'count' } else { 'bytes' }) }
        }
    }
    [pscustomobject]@{ name = 'service_count'; scope = 'total'; unit = 'count' }
    [pscustomobject]@{ name = 'startup_ms'; scope = 'total'; unit = 'ms' }
}

function Get-BenchmarkRunMetrics {
    param([object[]]$Samples, [int]$ServiceCount, $StartupMs)
    $metrics = @{}
    foreach ($definition in @(Get-BenchmarkMetricDefinitions)) {
        $key = '{0}.{1}' -f $definition.scope, $definition.name
        if ($definition.name -eq 'service_count') { $metrics[$key] = $ServiceCount; continue }
        if ($definition.name -eq 'startup_ms') { $metrics[$key] = $StartupMs; continue }
        # Only a single shell has a meaningful OS lifetime peak. A sum of OS
        # peaks from different times is deliberately never computed.
        if ($definition.name -eq 'os_peak_working_set_bytes' -and $definition.scope -ne 'shell') { $metrics[$key] = $null; continue }
        $sampleName = $definition.name
        if ($sampleName -eq 'sampled_peak_working_set_bytes') { $sampleName = 'working_set_bytes' }
        $values = @($Samples | ForEach-Object { $_.scopes[$definition.scope][$sampleName] })
        if ($values.Count -eq 0 -or @($values | Where-Object { $null -eq $_ }).Count -gt 0) { $metrics[$key] = $null; continue }
        if ($definition.name -in @('sampled_peak_working_set_bytes', 'os_peak_working_set_bytes')) {
            $metrics[$key] = [double]($values | Measure-Object -Maximum).Maximum
        } else { $metrics[$key] = [double]($values | Measure-Object -Average).Average }
    }
    $metrics
}

Export-ModuleMember -Function Get-BenchmarkProcessKey, Select-BenchmarkProcessTree, Get-BenchmarkSummary, Get-BenchmarkMetricDefinitions, Get-BenchmarkRunMetrics
