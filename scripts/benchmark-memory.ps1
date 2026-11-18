#Requires -Version 5.1
<# Collect an explicitly prepared release process tree. Never trims memory,
   terminates processes, changes service state or reads service profiles. #>
[CmdletBinding(DefaultParameterSetName = 'Attach')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Attach')][ValidateRange(1, 2147483647)][int]$RootProcessId,
    [Parameter(Mandatory, ParameterSetName = 'Startup')][string]$ExecutablePath,
    [Parameter(Mandatory)][ValidateSet('A','B','C','D','E','F','G','H','I')][string]$Scenario,
    [Parameter(Mandatory)][ValidateRange(0, 100)][int]$ServiceCount,
    [Parameter(Mandatory)][ValidateRange(0, 100)][int]$AccountCount,
    [ValidateSet('synology-chatplus','synology-chat','discord','slack','mattermost','messenger','whatsapp','other')][string[]]$ServiceProviders = @(),
    [ValidateRange(0, 100000)][int]$SwitchesPerformed = 0,
    [Parameter(Mandatory)][ValidateSet('idle','active')][string]$State,
    [Parameter(Mandatory)][string]$AppVersion,
    [Parameter(Mandatory)][string]$BuildId,
    [string]$ApplicationName = 'ChatPlus Desktop',
    [ValidateRange(5, 100)][int]$Repetitions = 5,
    [ValidateRange(5, 86400)][int]$DurationSeconds = 60,
    [ValidateRange(1, 86400)][int]$WarmupSeconds = 60,
    [ValidateRange(100, 60000)][int]$SampleIntervalMs = 1000,
    [ValidateRange(0, 525600)][int]$PreparedDurationMinutes = 0,
    [Parameter(Mandatory)][switch]$OperatorConfirmedScenario,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot ('../benchmarks/results/' + [datetime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')))
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/benchmark-memory.psm1') -Force
$Scenario = $Scenario.ToUpperInvariant()
$State = $State.ToLowerInvariant()
$ServiceProviders = @($ServiceProviders | ForEach-Object { $_.ToLowerInvariant() })
if (-not $OperatorConfirmedScenario) { throw 'Confirm the documented prepared scenario using -OperatorConfirmedScenario.' }
if ($ServiceProviders.Count -ne $ServiceCount -or $AccountCount -gt $ServiceCount -or ($ServiceCount -gt 0 -and $AccountCount -eq 0)) { throw 'Declare one provider per active service profile and the number of signed-in accounts.' }
if ($Scenario -eq 'H' -and ($SwitchesPerformed -lt 120 -or $ServiceCount -lt 2)) { throw 'Scenario H requires at least 120 switches between at least two service profiles before measurement.' }
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Native Windows is required.' }
if ($AppVersion -notmatch '^[a-zA-Z0-9.+_-]{1,80}$' -or $BuildId -notmatch '^[a-zA-Z0-9.+_-]{1,100}$' -or $ApplicationName -notmatch '^[a-zA-Z0-9 ._+-]{1,80}$') { throw 'Use public version/build identifiers and application names, without paths or private data.' }
$expectedServices = @{ A = 0; B = 1; C = 1; D = 3; E = 5 }
if ($expectedServices.ContainsKey($Scenario) -and $ServiceCount -ne $expectedServices[$Scenario]) { throw 'Service count does not match the scenario.' }
if ($Scenario -eq 'G' -and ($PreparedDurationMinutes * 60 + $WarmupSeconds) -lt 1800) { throw 'Scenario G requires 30 minutes of operator-confirmed continuous idle plus warmup.' }
if ($Scenario -eq 'I' -and ($PreparedDurationMinutes * 60 + $WarmupSeconds) -lt 14400) { throw 'Scenario I requires at least four hours of operator-confirmed session age plus warmup.' }
if ($Scenario -eq 'G' -and $State -ne 'idle') { throw 'Scenario G is an idle scenario.' }
if ($PSCmdlet.ParameterSetName -eq 'Startup' -and $PreparedDurationMinutes -gt 0) { throw 'A newly launched application cannot inherit prepared session time.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory must be new; existing benchmark evidence is never overwritten.' }
$null = New-Item -ItemType Directory -Path $OutputDirectory

if (-not ('ChatPlusBenchmark.NativeMemory' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace ChatPlusBenchmark {
  public static class NativeMemory {
    [StructLayout(LayoutKind.Sequential)] public struct Counters {
      public uint cb; public uint PageFaultCount;
      public UIntPtr PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage,
        QuotaPagedPoolUsage, QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage,
        PagefileUsage, PeakPagefileUsage, PrivateUsage;
    }
    [DllImport("psapi.dll", SetLastError=true)] static extern bool GetProcessMemoryInfo(IntPtr process, ref Counters counters, uint size);
    public static Counters Read(IntPtr process) {
      var value = new Counters(); value.cb = (uint)Marshal.SizeOf(typeof(Counters));
      if (!GetProcessMemoryInfo(process, ref value, value.cb)) throw new Win32Exception();
      return value;
    }
  }
}
'@
}

function Write-BenchmarkJson { param($Value, [string]$Path) [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 30), (New-Object Text.UTF8Encoding($false))) }
function Get-ProcessSnapshot { @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name,ExecutablePath) }
function Get-PinnedRoot {
    param([int]$Id)
    $root = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $Id" -Property ProcessId,ParentProcessId,CreationDate,Name,ExecutablePath
    if ($null -eq $root -or $null -eq $root.CreationDate -or [string]::IsNullOrWhiteSpace($root.ExecutablePath)) { throw 'Root process identity or executable provenance is inaccessible.' }
    $root
}
function Get-PublicProcessRecord {
    param($Item, [string]$RootKey)
    $key = Get-BenchmarkProcessKey $Item
    [ordered]@{
        identity = $key; pid = [int]$Item.ProcessId; parentPid = [int]$Item.ParentProcessId
        startedAt = ([datetime]$Item.CreationDate).ToUniversalTime().ToString('o')
        role = $(if ($key -eq $RootKey) { 'shell' } elseif ($Item.Name -ieq 'msedgewebview2.exe') { 'webview' } else { 'helper' })
        imageName = [IO.Path]::GetFileName([string]$Item.Name)
    }
}

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$processors = @(Get-CimInstance Win32_Processor)
$logicalProcessors = [int]$computer.NumberOfLogicalProcessors
if ($logicalProcessors -lt 1) { throw 'Logical processor count unavailable.' }
$environmentData = [ordered]@{
    os = [ordered]@{ name = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; architecture = [string]$os.OSArchitecture }
    hardware = [ordered]@{ cpu = [string]$processors[0].Name; logicalProcessors = $logicalProcessors; physicalMemoryBytes = [double]$computer.TotalPhysicalMemory }
    webview2Versions = @(); collectorPowerShell = $PSVersionTable.PSVersion.ToString()
}
$webviewVersions = @{}
$processRecords = @{}
$allSamples = New-Object System.Collections.Generic.List[object]
$runs = New-Object System.Collections.Generic.List[object]
$scriptHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
$moduleHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'lib/benchmark-memory.psm1') -Algorithm SHA256).Hash.ToLowerInvariant()
$binaryHashes = @{}
$known = @{}
$capturedAt = [datetime]::UtcNow.ToString('o')

for ($iteration = 1; $iteration -le $Repetitions; $iteration++) {
    $issues = New-Object System.Collections.Generic.List[string]
    $startupMs = $null
    $root = $null
    $runSamples = New-Object System.Collections.Generic.List[object]
    $runStartedAt = [datetime]::UtcNow.ToString('o')
    $stage = 'startup'
    try {
        if ($PSCmdlet.ParameterSetName -eq 'Startup') {
            if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { throw 'Release executable not found.' }
            $launchClock = [Diagnostics.Stopwatch]::StartNew()
            $launched = Start-Process -FilePath $ExecutablePath -PassThru
            $RootProcessId = $launched.Id
            $null = Read-Host 'Press Enter when the application and the prepared services are usable (manual readiness timing)'
            $startupMs = [double]$launchClock.Elapsed.TotalMilliseconds
            $known = @{}
        }
        $stage = 'root_identity'
        $root = Get-PinnedRoot $RootProcessId
        $rootKey = Get-BenchmarkProcessKey $root
        if ($PSCmdlet.ParameterSetName -eq 'Attach' -and $iteration -gt 1 -and $rootKey -ne $attachedRootKey) { throw 'Root PID was reused or application restarted between repetitions.' }
        $attachedRootKey = $rootKey
        if (([datetime]::UtcNow - ([datetime]$root.CreationDate).ToUniversalTime()).TotalMinutes -lt $PreparedDurationMinutes) { throw 'Declared prepared duration exceeds the pinned application session age.' }
        $stage = 'executable_provenance'
        $binaryHash = (Get-FileHash -LiteralPath $root.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant()
        $binaryHashes[$binaryHash] = $true
        if ($binaryHashes.Count -ne 1) { throw 'Executable changed during the benchmark.' }
        Write-Host "Run $iteration/${Repetitions}: warmup $WarmupSeconds seconds, then $DurationSeconds seconds; do not change prepared state."
        Start-Sleep -Seconds $WarmupSeconds
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $previousCpu = @{}
        $previousTime = $null
        $sampleNumber = 0
        # A baseline sample supplies CPU deltas; it is not part of the result.
        do {
            $cycleStart = $clock.Elapsed.TotalMilliseconds
            $sampleAt = [datetime]::UtcNow.ToString('o')
            $stage = 'process_attribution'
            $snapshot = @(Get-ProcessSnapshot)
            $tree = @(Select-BenchmarkProcessTree -Processes $snapshot -RootKey $rootKey -Known $known)
            if (@($tree | Where-Object { (Get-BenchmarkProcessKey $_) -eq $rootKey }).Count -ne 1) { throw 'Pinned root exited or PID identity changed.' }
            $privateWorkingSets = @{}
            try {
                foreach ($counter in @(Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess,WorkingSetPrivate)) {
                    $privateWorkingSets[[string]$counter.IDProcess] = $counter.WorkingSetPrivate
                }
            } catch { # An unavailable optional counter remains null in every affected scope.
                $privateWorkingSets = @{}
            }
            $scopes = @{}
            foreach ($scope in @('shell','webview','total')) {
                $scopes[$scope] = @{ working_set_bytes = 0.0; private_bytes = 0.0; private_working_set_bytes = 0.0; commit_bytes = 0.0; os_peak_working_set_bytes = 0.0; cpu_percent = 0.0; process_count = 0 }
            }
            $currentCpu = @{}
            $identities = New-Object System.Collections.Generic.List[string]
            foreach ($item in $tree) {
                $key = Get-BenchmarkProcessKey $item
                $record = Get-PublicProcessRecord $item $rootKey
                $processRecords[$key] = $record
                $identities.Add($key)
                if ($record.role -eq 'webview' -and $item.ExecutablePath) {
                    try { $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($item.ExecutablePath).FileVersion; if ($version) { $webviewVersions[$version] = $true } } catch { }
                }
                $stage = 'process_counter_read'
                $process = Get-Process -Id ([int]$item.ProcessId) -ErrorAction Stop
                try {
                    $process.Refresh()
                    # Pin the handle before reading counters and recheck against the
                    # CIM identity to avoid attributing a recycled PID.
                    if ([math]::Abs(($process.StartTime.ToUniversalTime() - ([datetime]$item.CreationDate).ToUniversalTime()).TotalMilliseconds) -gt 1) { throw 'Process start identity changed during sampling.' }
                    $memory = [ChatPlusBenchmark.NativeMemory]::Read($process.Handle)
                    $cpu = $process.TotalProcessorTime.TotalMilliseconds
                    $currentCpu[$key] = $cpu
                    $deltaCpu = 0.0
                    if ($null -ne $previousTime) {
                        if ($previousCpu.ContainsKey($key)) { $deltaCpu = $cpu - $previousCpu[$key] }
                        elseif (([datetime]$item.CreationDate).ToUniversalTime() -ge $previousTime) { $deltaCpu = $cpu }
                        else { throw 'Previously running descendant appeared without a CPU baseline.' }
                        if ($deltaCpu -lt 0) { throw 'CPU counter moved backwards.' }
                    }
                    $elapsedMs = if ($null -eq $previousTime) { 1.0 } else { ([datetime]::Parse($sampleAt).ToUniversalTime() - $previousTime).TotalMilliseconds }
                    $cpuPercent = if ($null -eq $previousTime) { 0.0 } else { 100.0 * $deltaCpu / $elapsedMs / $logicalProcessors }
                    $targets = @('total')
                    if ($record.role -in @('shell','webview')) { $targets += $record.role }
                    foreach ($scope in $targets) {
                        $scopes[$scope].working_set_bytes += [double]$memory.WorkingSetSize.ToUInt64()
                        $scopes[$scope].private_bytes += [double]$memory.PrivateUsage.ToUInt64()
                        $scopes[$scope].commit_bytes += [double]$memory.PrivateUsage.ToUInt64()
                        $scopes[$scope].cpu_percent += $cpuPercent
                        $scopes[$scope].process_count++
                        if ($scope -eq 'shell') { $scopes[$scope].os_peak_working_set_bytes = [double]$memory.PeakWorkingSetSize.ToUInt64() }
                        $privateSet = $privateWorkingSets[[string]$item.ProcessId]
                        if ($null -eq $privateSet) { $scopes[$scope].private_working_set_bytes = $null }
                        elseif ($null -ne $scopes[$scope].private_working_set_bytes) { $scopes[$scope].private_working_set_bytes += [double]$privateSet }
                    }
                } finally { $process.Dispose() }
            }
            foreach ($scope in @('webview','total')) { $scopes[$scope].os_peak_working_set_bytes = $null }
            $cycleEnd = $clock.Elapsed.TotalMilliseconds
            if ($sampleNumber -gt 0) {
                $sample = [ordered]@{ runId = $iteration; sampleId = $sampleNumber; sampledAt = $sampleAt; elapsedMs = $cycleStart; cycleDurationMs = $cycleEnd - $cycleStart; processIdentities = @($identities); scopes = $scopes }
                $runSamples.Add($sample)
                $allSamples.Add($sample)
            }
            $previousCpu = $currentCpu
            $previousTime = [datetime]::Parse($sampleAt).ToUniversalTime()
            $sampleNumber++
            if ($cycleStart -ge $DurationSeconds * 1000) { break }
            $remaining = $SampleIntervalMs - ($clock.Elapsed.TotalMilliseconds - $cycleStart)
            if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int]$remaining) }
        } while ($true)
        if ($runSamples.Count -lt 3) { throw 'Too few complete sampling cycles; lengthen the measurement window.' }
        # All tree values in a cycle are summed before taking the maximum.
        $runMetrics = Get-BenchmarkRunMetrics -Samples @($runSamples.ToArray()) -ServiceCount $ServiceCount -StartupMs $startupMs
        $runs.Add([ordered]@{ id = $iteration; status = 'measured'; startedAt = $runStartedAt; completedAt = [datetime]::UtcNow.ToString('o'); sampleCount = $runSamples.Count; metrics = $runMetrics; issues = @() })
    } catch {
        # Public failures use fixed classifications, never raw exception messages,
        # which can contain paths, account names or provider URLs.
        $issues.Add($stage + '_failed')
        Write-Warning "Run $iteration is invalid. Check process availability, permissions and the documented setup; no private exception details are exported."
        $runs.Add([ordered]@{ id = $iteration; status = 'invalid'; startedAt = $runStartedAt; completedAt = [datetime]::UtcNow.ToString('o'); sampleCount = $runSamples.Count; metrics = @{}; issues = @($issues.ToArray()) })
    }
    if ($PSCmdlet.ParameterSetName -eq 'Startup' -and $null -ne $root -and $iteration -lt $Repetitions) {
        $null = Read-Host 'Exit the benchmark application completely using its normal Exit action, then press Enter for the next launch'
        $remainingRoot = Get-CimInstance Win32_Process -Filter "ProcessId = $RootProcessId"
        if ($null -ne $remainingRoot -and (Get-BenchmarkProcessKey $remainingRoot) -eq (Get-BenchmarkProcessKey $root)) { throw 'Application is still running. Existing output is retained; rerun into a new directory after exiting normally.' }
    }
}

$environmentData.webview2Versions = @($webviewVersions.Keys | Sort-Object)
$validRuns = @($runs.ToArray() | Where-Object { $_.status -eq 'measured' })
$scenarioStatus = if ($validRuns.Count -eq $Repetitions -and $binaryHashes.Count -eq 1) { 'measured' } else { 'invalid' }
$metricResults = @()
foreach ($definition in @(Get-BenchmarkMetricDefinitions)) {
    $key = '{0}.{1}' -f $definition.scope, $definition.name
    $values = @($validRuns | ForEach-Object { $_.metrics[$key] })
    $available = @($values | Where-Object { $null -ne $_ }).Count
    $metricStatus = if ($scenarioStatus -ne 'measured') { 'invalid' } elseif ($available -eq $Repetitions) { 'measured' } else { 'unavailable' }
    $reason = if ($metricStatus -eq 'measured') { $null } elseif ($definition.name -eq 'startup_ms' -and $PSCmdlet.ParameterSetName -eq 'Attach') { 'Attach mode does not observe application readiness.' } elseif ($definition.name -eq 'os_peak_working_set_bytes' -and $definition.scope -ne 'shell') { 'Individual process lifetime peaks cannot form a simultaneous tree peak.' } else { 'One or more runs or required counters were unavailable.' }
    $metricResults += [ordered]@{ name = $definition.name; unit = $definition.unit; scope = $definition.scope; status = $metricStatus; reason = $reason; runCount = $(if ($metricStatus -eq 'measured') { $Repetitions } else { 0 }); aggregates = $(if ($metricStatus -eq 'measured') { Get-BenchmarkSummary $values } else { $null }) }
}

$samplesPath = Join-Path $OutputDirectory 'samples.json'
$processesPath = Join-Path $OutputDirectory 'processes.json'
Write-BenchmarkJson @($allSamples.ToArray()) $samplesPath
Write-BenchmarkJson @($processRecords.Values | Sort-Object identity) $processesPath
$sources = @(
    [ordered]@{ path = 'samples.json'; kind = 'samples'; sha256 = (Get-FileHash -LiteralPath $samplesPath -Algorithm SHA256).Hash.ToLowerInvariant() },
    [ordered]@{ path = 'processes.json'; kind = 'processes'; sha256 = (Get-FileHash -LiteralPath $processesPath -Algorithm SHA256).Hash.ToLowerInvariant() }
)
$labels = @{ A = 'No active services'; B = 'One Synology ChatPlus service'; C = 'One Discord service'; D = 'Three active services'; E = 'Five active services'; F = 'Minimized to tray'; G = 'Thirty minutes idle'; H = 'Intensive service switching'; I = 'Long session (at least four hours)' }
$scenarios = @()
foreach ($id in @('A','B','C','D','E','F','G','H','I')) {
    $selected = $id -eq $Scenario
    $scenarios += [ordered]@{ id = $id; label = $labels[$id]; status = $(if ($selected) { $scenarioStatus } else { 'not_run' }); reason = $(if ($selected -and $scenarioStatus -eq 'measured') { $null } elseif ($selected) { 'One or more repetitions were incomplete.' } else { 'This scenario has not been run in this dataset.' }); serviceCount = $(if ($selected) { $ServiceCount } elseif ($expectedServices.ContainsKey($id)) { $expectedServices[$id] } else { $null }); state = $(if ($selected) { $State } else { $null }); workload = $(if ($selected) { [ordered]@{ serviceProviders = @($ServiceProviders); accountCount = $AccountCount; switchesPerformed = $SwitchesPerformed } } else { $null }); repetitionsRequired = $Repetitions; repetitionsCompleted = $(if ($selected) { $validRuns.Count } else { 0 }); metrics = @(if ($selected) { $metricResults }); runs = @(if ($selected) { $runs.ToArray() }); sources = @(if ($selected) { $sources }) }
}
$result = [ordered]@{
    schemaVersion = 1; methodologyId = 'chatplus-windows-process-tree-v1'; datasetKind = 'production'; status = $scenarioStatus
    measuredAt = $capturedAt; application = [ordered]@{ name = $ApplicationName; version = $AppVersion }
    build = [ordered]@{ id = $BuildId; appVersion = $AppVersion; configuration = 'release'; executableSha256 = $(if ($binaryHashes.Count -eq 1) { @($binaryHashes.Keys)[0] } else { $null }) }
    environment = $environmentData
    attribution = [ordered]@{ method = 'parent_pid_and_creation_time'; description = 'Pinned root plus descendants with verified parent creation ordering; previously observed descendants retained by PID and creation time. Includes every observed descendant, regardless of image name.' }
    collection = [ordered]@{ scriptSha256 = $scriptHash; moduleSha256 = $moduleHash; durationSeconds = $DurationSeconds; warmupSeconds = $WarmupSeconds; sampleIntervalMs = $SampleIntervalMs; preparedDurationMinutes = $PreparedDurationMinutes; serviceCountMethod = 'operator_confirmed'; startupMethod = $(if ($PSCmdlet.ParameterSetName -eq 'Startup') { 'launch_to_operator_ready' } else { 'not_observed_attach_mode' }); repetitionMethod = $(if ($PSCmdlet.ParameterSetName -eq 'Startup') { 'separate_manual_launches' } else { 'repeated_windows_same_session' }) }
    scenarios = $scenarios
}
$resultPath = Join-Path $OutputDirectory 'performance.json'
Write-BenchmarkJson $result $resultPath
$csv = foreach ($sample in $allSamples.ToArray()) {
    foreach ($scope in @('shell','webview','total')) {
        foreach ($name in @('working_set_bytes','private_bytes','private_working_set_bytes','commit_bytes','os_peak_working_set_bytes','cpu_percent','process_count')) {
            [pscustomobject][ordered]@{ scenario = $Scenario; run = $sample.runId; sample = $sample.sampleId; sampledAt = $sample.sampledAt; cycleDurationMs = $sample.cycleDurationMs; scope = $scope; metric = $name; value = $sample.scopes[$scope][$name] }
        }
    }
}
$csv | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'samples.csv') -NoTypeInformation -Encoding UTF8
$metricResults | ForEach-Object { [pscustomobject][ordered]@{ scenario = $Scenario; scope = $_.scope; metric = $_.name; unit = $_.unit; status = $_.status; runCount = $_.runCount; mean = $(if ($null -ne $_.aggregates) { $_.aggregates.mean } else { $null }); median = $(if ($null -ne $_.aggregates) { $_.aggregates.median } else { $null }); min = $(if ($null -ne $_.aggregates) { $_.aggregates.min } else { $null }); max = $(if ($null -ne $_.aggregates) { $_.aggregates.max } else { $null }) } } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'summary.csv') -NoTypeInformation -Encoding UTF8
Write-Host "Written $resultPath (status: $scenarioStatus). Validate with: node scripts/validate-performance.mjs <result-path>"
if ($scenarioStatus -ne 'measured') { exit 1 }
