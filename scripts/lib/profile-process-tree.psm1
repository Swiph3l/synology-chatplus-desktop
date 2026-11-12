#Requires -Version 5.1
Set-StrictMode -Version Latest

function Get-ProfileProcessIdentity {
    param([Parameter(Mandatory)]$Process)
    if ($null -eq $Process.CreationDate) { throw 'Process creation time unavailable.' }
    '{0}:{1}' -f [int]$Process.ProcessId, ([datetime]$Process.CreationDate).ToUniversalTime().Ticks
}

function Select-ProfileProcessTree {
    param([object[]]$Snapshot, [string]$RootIdentity, [hashtable]$Known)
    $selected = @{}
    foreach ($item in $Snapshot) {
        if ($null -eq $item.CreationDate) { continue }
        $identity = Get-ProfileProcessIdentity $item
        if ($identity -eq $RootIdentity -or $Known.ContainsKey($identity)) {
            $selected[[int]$item.ProcessId] = $item
        }
    }
    do {
        $added = $false
        foreach ($item in $Snapshot) {
            if ($null -eq $item.CreationDate -or $selected.ContainsKey([int]$item.ProcessId)) { continue }
            $parent = $selected[[int]$item.ParentProcessId]
            if ($null -ne $parent -and ([datetime]$item.CreationDate) -ge ([datetime]$parent.CreationDate)) {
                $selected[[int]$item.ProcessId] = $item
                $added = $true
            }
        }
    } while ($added)
    foreach ($item in $selected.Values) {
        $Known[(Get-ProfileProcessIdentity $item)] = $true
        $item
    }
}

function Get-ProfileProcessRole {
    param($Process, [string]$RootIdentity)
    if ((Get-ProfileProcessIdentity $Process) -eq $RootIdentity) { return 'native' }
    if ($Process.Name -ieq 'crashpad_handler.exe') { return 'crashpad' }
    if ($Process.Name -ine 'msedgewebview2.exe') { return 'unknown' }
    # Only fixed switch values influence output. Never return command-line text.
    $command = [string]$Process.CommandLine
    if ([string]::IsNullOrWhiteSpace($command)) { return 'unknown' }
    $type = [regex]::Match($command, '(?:^|\s)--type=("?)([a-z-]+)\1(?=\s|$)')
    if (-not $type.Success) {
        if ($command -match '(?:^|\s)--type(?:=|\s|$)') { return 'unknown' }
        return 'browser'
    }
    switch ($type.Groups[2].Value) {
        'renderer' { return 'renderer' }
        'gpu-process' { return 'gpu' }
        'crashpad-handler' { return 'crashpad' }
        'utility' {
            $subtype = [regex]::Match($command, '(?:^|\s)--utility-sub-type=("?)([A-Za-z0-9_.]+)\1(?=\s|$)')
            switch ($subtype.Groups[2].Value) {
                'network.mojom.NetworkService' { return 'network' }
                'storage.mojom.StorageService' { return 'storage' }
                'audio.mojom.AudioService' { return 'audio' }
                default { return 'utility' }
            }
        }
        default { return 'unknown' }
    }
}

function ConvertTo-ProfileProcessRecord {
    param($Process, [string]$RootIdentity)
    [pscustomobject][ordered]@{
        identity = Get-ProfileProcessIdentity $Process
        pid = [int]$Process.ProcessId
        parentPid = [int]$Process.ParentProcessId
        createdUtc = ([datetime]$Process.CreationDate).ToUniversalTime().ToString('o')
        role = Get-ProfileProcessRole $Process $RootIdentity
    }
}

function Get-ProfileTotals {
    param([object[]]$Rows, [bool]$Complete)
    $total = [ordered]@{
        complete = $Complete
        processCount = $Rows.Count
        privateBytes = $null
        workingSetBytes = $null
        privateWorkingSetBytes = $null
        cpuPercent = $null
        handles = $null
    }
    if (-not $Complete) { return [pscustomobject]$total }
    foreach ($metric in @('privateBytes', 'workingSetBytes', 'privateWorkingSetBytes', 'cpuPercent', 'handles')) {
        if (@($Rows | Where-Object { $null -eq $_.$metric }).Count -gt 0) { continue }
        $sum = 0.0
        foreach ($row in $Rows) { $sum += $row.$metric }
        $total[$metric] = $sum
    }
    [pscustomobject]$total
}

Export-ModuleMember -Function Get-ProfileProcessIdentity, Select-ProfileProcessTree, Get-ProfileProcessRole, ConvertTo-ProfileProcessRecord, Get-ProfileTotals
