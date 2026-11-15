#Requires -Version 5.1
<# Attach-only process counters. Does not launch, stop, trim, navigate or read profiles. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$RootProcessId,
    [Parameter(Mandatory)][ValidateRange(5, 86400)][int]$DurationSeconds,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [ValidateRange(1, 3600)][int]$SampleIntervalSeconds = 5,
    [ValidateSet('unconfirmed', 'startup-observation', 'idle', 'single-account', 'multi-account', 'multi-service', 'tray', 'switching', 'closed-service', 'extended')][string]$Scenario = 'unconfirmed',
    [ValidateSet('unconfirmed', 'foreground', 'background', 'minimized', 'tray')][string]$WindowState = 'unconfirmed',
    [ValidateRange(0, 100)][int]$ServiceCount = 0,
    [ValidateRange(0, 100)][int]$AccountCount = 0,
    [ValidateRange(0, 100)][int]$SynologyChatPlusCount = 0,
    [ValidateRange(0, 100)][int]$SynologyChatCount = 0,
    [ValidateRange(0, 100)][int]$DiscordCount = 0,
    [ValidateRange(0, 100)][int]$WhatsAppCount = 0,
    [ValidateRange(0, 100)][int]$MessengerCount = 0,
    [ValidateRange(0, 100)][int]$MattermostCount = 0,
    [ValidateRange(0, 100)][int]$SlackCount = 0,
    [ValidateRange(0, 1000000)][int]$SwitchesPerformed = 0,
    [switch]$IncludePrivateWorkingSet
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$modulePath = Join-Path $PSScriptRoot 'lib/profile-process-tree.psm1'
$collectorProvenance = [ordered]@{
    scriptSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
    moduleSha256 = (Get-FileHash -LiteralPath $modulePath -Algorithm SHA256).Hash.ToLowerInvariant()
    hashedUtc = [datetime]::UtcNow.ToString('o')
}
Import-Module $modulePath -Force
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Windows is required.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory must be new.' }
$declaredProviders = $SynologyChatPlusCount + $SynologyChatCount + $DiscordCount + $WhatsAppCount + $MessengerCount + $MattermostCount + $SlackCount
if ($PSBoundParameters.ContainsKey('ServiceCount') -and $declaredProviders -gt $ServiceCount) { throw 'Provider declarations exceed declared service count.' }
$workload = [ordered]@{}
foreach ($parameterName in @('ServiceCount', 'AccountCount', 'SynologyChatPlusCount', 'SynologyChatCount', 'DiscordCount', 'WhatsAppCount', 'MessengerCount', 'MattermostCount', 'SlackCount', 'SwitchesPerformed')) {
    $workload[$parameterName] = if ($PSBoundParameters.ContainsKey($parameterName)) { [int](Get-Variable -Name $parameterName -ValueOnly) } else { $null }
}

function Write-ProfileJson {
    param($Value, [string]$Path)
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 12), (New-Object Text.UTF8Encoding($false)))
}
function Get-ProcessSnapshot {
    @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name, CommandLine, ExecutablePath)
}
function Get-SafeVersion {
    param([string]$Path)
    try {
        $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($Path).FileVersion
        if ($version -match '^\d+(?:\.\d+){1,3}$') { return $version }
    } catch { }
    return $null
}

$initial = @(Get-ProcessSnapshot)
$root = @($initial | Where-Object ProcessId -eq $RootProcessId)
if ($root.Count -ne 1 -or $null -eq $root[0].CreationDate -or [string]::IsNullOrEmpty($root[0].ExecutablePath)) { throw 'Root identity or executable provenance unavailable.' }
$root = $root[0]
$rootIdentity = Get-ProfileProcessIdentity $root
$rootHash = (Get-FileHash -LiteralPath $root.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant()
$rootVersion = Get-SafeVersion $root.ExecutablePath
$computer = Get-CimInstance Win32_ComputerSystem -Property NumberOfLogicalProcessors, TotalPhysicalMemory
$os = Get-CimInstance Win32_OperatingSystem -Property Version, BuildNumber, OSArchitecture
$logicalProcessors = [int]$computer.NumberOfLogicalProcessors
if ($logicalProcessors -lt 1) { throw 'Logical CPU count unavailable.' }
$null = New-Item -ItemType Directory -Path $OutputDirectory
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$known = @{}
$previousCpu = @{}
$versions = @{}
$samples = New-Object Collections.Generic.List[object]
$startedUtc = [datetime]::UtcNow
$clock = [Diagnostics.Stopwatch]::StartNew()
$nextSample = 0.0
$index = 0

while ($true) {
    $elapsed = $clock.Elapsed.TotalSeconds
    if ($index -gt 0 -and $elapsed -gt $DurationSeconds) { break }
    $observedUtc = [datetime]::UtcNow
    $complete = $true
    $snapshotStatus = 'available'
    $snapshot = @()
    try { $snapshot = @(Get-ProcessSnapshot) } catch { $complete = $false; $snapshotStatus = 'unavailable' }
    $tree = @(Select-ProfileProcessTree $snapshot $rootIdentity $known)
    # Do not let inaccessible unrelated system processes invalidate this tree.
    $treePids = @($tree | ForEach-Object { [int]$_.ProcessId })
    $knownPids = @($known.Keys | ForEach-Object { [int]($_ -split ':')[0] })
    if (@($snapshot | Where-Object { $null -eq $_.CreationDate -and ($_.ProcessId -eq $RootProcessId -or $_.ParentProcessId -in $treePids -or $_.ProcessId -in $knownPids) }).Count -gt 0) { $complete = $false; $snapshotStatus = 'identity-unavailable' }
    $privateWorkingSets = @{}
    if ($IncludePrivateWorkingSet) {
        try {
            foreach ($counter in @(Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess, WorkingSetPrivate, ElapsedTime, Timestamp_Object, Frequency_Object)) {
                $privateWorkingSets[[int]$counter.IDProcess] = $counter
            }
        } catch { }
    }
    $sampleRows = @()
    foreach ($item in $tree) {
        $public = ConvertTo-ProfileProcessRecord $item $rootIdentity
        $ageSeconds = ($observedUtc - ([datetime]$item.CreationDate).ToUniversalTime()).TotalSeconds
        $row = [ordered]@{
            sample = $index; elapsedSeconds = [math]::Round($elapsed, 3); observedUtc = $observedUtc.ToString('o')
            identity = $public.identity; pid = $public.pid; parentPid = $public.parentPid; role = $public.role
            processAgeSeconds = [math]::Round($ageSeconds, 3)
            counterStatus = 'unavailable'; privateBytes = $null; workingSetBytes = $null
            privateWorkingSetStatus = 'not-requested'; privateWorkingSetBytes = $null
            cpuPercent = $null; handles = $null
        }
        try {
            $process = [Diagnostics.Process]::GetProcessById([int]$item.ProcessId)
            try {
                $process.Refresh()
                # CIM truncates creation timestamps to microseconds; allow only that precision loss.
                if ([math]::Abs(($process.StartTime.ToUniversalTime() - ([datetime]$item.CreationDate).ToUniversalTime()).Ticks) -gt 10) { throw 'Identity changed.' }
                $privateBytes = [double]$process.PrivateMemorySize64
                $workingSet = [double]$process.WorkingSet64
                $handles = [int]$process.HandleCount
                $cpuSeconds = $process.TotalProcessorTime.TotalSeconds
                $counterElapsed = $clock.Elapsed.TotalSeconds
                if ($process.HasExited) { throw 'Process exited during counters.' }
                $row.privateBytes = $privateBytes
                $row.workingSetBytes = $workingSet
                $row.handles = $handles
                $before = $previousCpu[$public.identity]
                if ($null -ne $before -and $counterElapsed -gt $before.elapsed -and $cpuSeconds -ge $before.cpu) {
                    $row.cpuPercent = [math]::Round(100 * ($cpuSeconds - $before.cpu) / ($counterElapsed - $before.elapsed) / $logicalProcessors, 4)
                }
                $previousCpu[$public.identity] = @{ elapsed = $counterElapsed; cpu = $cpuSeconds }
                $row.counterStatus = 'available'
                if ($IncludePrivateWorkingSet) {
                    $row.privateWorkingSetStatus = 'unavailable'
                    $counter = $privateWorkingSets[[int]$item.ProcessId]
                    if ($null -ne $counter -and [double]$counter.Frequency_Object -gt 0) {
                        $counterAge = ([double]$counter.Timestamp_Object - [double]$counter.ElapsedTime) / [double]$counter.Frequency_Object
                        if ([math]::Abs($counterAge - $ageSeconds) -le 2) {
                            $row.privateWorkingSetBytes = [double]$counter.WorkingSetPrivate
                            $row.privateWorkingSetStatus = 'available-age-matched'
                        }
                    }
                }
            } finally { $process.Dispose() }
        } catch { $complete = $false }
        if ($public.role -ne 'native' -and $item.Name -ieq 'msedgewebview2.exe' -and -not [string]::IsNullOrEmpty($item.ExecutablePath)) {
            $runtime = Get-SafeVersion $item.ExecutablePath
            if ($null -ne $runtime) { $versions[$runtime] = $true }
        }
        $record = [pscustomobject]$row
        $sampleRows += $record
    }
    # Flush one bounded sample at a time; extended captures must not retain every process row.
    $sampleRows | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'processes.csv') -Append -NoTypeInformation -Encoding UTF8
    $rootPresent = @($tree | Where-Object { (Get-ProfileProcessIdentity $_) -eq $rootIdentity }).Count -eq 1
    if (-not $rootPresent) { $complete = $false }
    $roles = [ordered]@{}
    foreach ($role in @('native', 'browser', 'renderer', 'gpu', 'network', 'storage', 'audio', 'utility', 'crashpad', 'unknown')) {
        $roleRows = @($sampleRows | Where-Object role -eq $role)
        $roleComplete = $snapshotStatus -eq 'available' -and @($roleRows | Where-Object counterStatus -ne 'available').Count -eq 0
        $roles[$role] = Get-ProfileTotals $roleRows $roleComplete
    }
    $samples.Add([pscustomobject][ordered]@{
        sample = $index; elapsedSeconds = [math]::Round($elapsed, 3); observedUtc = $observedUtc.ToString('o')
        rootPresent = $rootPresent; snapshotStatus = $snapshotStatus
        total = Get-ProfileTotals $sampleRows $complete; roles = $roles
    })
    $index += 1
    $nextSample += $SampleIntervalSeconds
    do {
        $waitSeconds = [math]::Min($nextSample, $DurationSeconds) - $clock.Elapsed.TotalSeconds
        if ($waitSeconds -gt 0) { Start-Sleep -Milliseconds ([int][math]::Min(60000, $waitSeconds * 1000)) }
    } while ($waitSeconds -gt 0)
    if ($nextSample -gt $DurationSeconds -and $clock.Elapsed.TotalSeconds -ge $DurationSeconds) { break }
}
$clock.Stop()
$metadata = [ordered]@{
    schemaVersion = 1; kind = 'attached-process-tree'; startedUtc = $startedUtc.ToString('o'); finishedUtc = [datetime]::UtcNow.ToString('o')
    collector = $collectorProvenance
    requestedDurationSeconds = $DurationSeconds; observedDurationSeconds = [math]::Round($clock.Elapsed.TotalSeconds, 3); sampleIntervalSeconds = $SampleIntervalSeconds
    root = [ordered]@{ identity = $rootIdentity; pid = $RootProcessId; createdUtc = ([datetime]$root.CreationDate).ToUniversalTime().ToString('o'); executableSha256 = $rootHash; fileVersion = $rootVersion; ageAtObservationSeconds = [math]::Round(($startedUtc - ([datetime]$root.CreationDate).ToUniversalTime()).TotalSeconds, 3) }
    environment = [ordered]@{ osVersion = $os.Version; osBuild = $os.BuildNumber; osArchitecture = $os.OSArchitecture; logicalProcessors = $logicalProcessors; physicalMemoryBytes = [double]$computer.TotalPhysicalMemory; powershellVersion = $PSVersionTable.PSVersion.ToString(); webview2Versions = @($versions.Keys | Sort-Object) }
    declarations = [ordered]@{ scenario = $Scenario; windowState = $WindowState; workload = $workload; status = 'operator-declared-unverified' }
    limitations = @('Attach observation is not startup latency.', 'Working-set sums include shared pages more than once; private bytes are the primary additive memory metric.', 'PSS and unique resident memory are not measured.', 'A first CPU observation has no delta; CPU is normalized by logical CPU count.', 'Private working set is optional and PERF age matching may leave it unavailable.', 'Unobserved descendants that orphan before the first snapshot cannot be attributed.', 'Collection has observer overhead; match cadence and environment between runs.')
    sampleCount = $samples.Count; completeSampleCount = @($samples | Where-Object { $_.total.complete }).Count
}
Write-ProfileJson $metadata (Join-Path $OutputDirectory 'session.json')
Write-ProfileJson @($samples.ToArray()) (Join-Path $OutputDirectory 'samples.json')
$summaryRows = foreach ($sample in $samples) {
    foreach ($scope in @('total') + @($sample.roles.Keys)) {
        $value = if ($scope -eq 'total') { $sample.total } else { $sample.roles[$scope] }
        [pscustomobject][ordered]@{ sample = $sample.sample; elapsedSeconds = $sample.elapsedSeconds; scope = $scope; complete = $value.complete; processCount = $value.processCount; privateBytes = $value.privateBytes; workingSetBytes = $value.workingSetBytes; privateWorkingSetBytes = $value.privateWorkingSetBytes; cpuPercent = $value.cpuPercent; handles = $value.handles }
    }
}
$summaryRows | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'roles.csv') -NoTypeInformation -Encoding UTF8
[pscustomobject]@{ sampleCount = $samples.Count; completeSampleCount = $metadata.completeSampleCount; durationSeconds = $metadata.observedDurationSeconds }
