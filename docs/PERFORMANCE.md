# Performance measurements

The website's offline measurement tool invokes `scripts/benchmark-memory.ps1`
for each prepared Windows workload. The collector records samples, and
`scripts/validate-performance.mjs` checks process identity, sample counts and
the evidence behind each summary. `scripts/export-performance.mjs` accepts a
verified measurement and writes files to the specified local output directory.
The unmeasured example lives in the test fixtures. The desktop installer ships
no benchmark dataset.

Use the attach-only Windows collector to observe a running release build without
changing its services, authentication, notifications or memory policy. Task
Manager group headings are useful clues, but they cannot establish a unique
application memory total.

```powershell
powershell.exe -NoProfile -File scripts/profile-process-tree.ps1 `
  -RootProcessId 12345 -DurationSeconds 60 -SampleIntervalSeconds 5 `
  -OutputDirectory ..\validation\profile-before-run1 `
  -Scenario multi-service -WindowState unconfirmed `
  -ServiceCount 6 -SynologyChatPlusCount 1 -DiscordCount 2 `
  -WhatsAppCount 1 -MessengerCount 1 -MattermostCount 1
```

Replace the example PID with the native ChatPlus process PID. The output directory
must be new. Keep output outside the public source tree. Set workload and window
declarations only when known; omitted counts are `null`. These declarations are
operator supplied and are not verified by inspecting accounts or page content.
`-SynologyChatCount` and `-SlackCount` cover the other supported session providers.
Where local policy blocks unsigned scripts, use an approved invocation for the
current process; the collector does not change machine execution policy.

The collector never starts or terminates applications, trims working sets,
navigates services, reads profiles or exports command lines or executable paths.
Command lines are read temporarily to recognize fixed Chromium process-role
switches. Exported roles are native, browser, renderer, GPU, network, storage,
audio, utility, crashpad and unknown. Executable paths are used temporarily to
read the root file SHA-256 and numeric WebView2 file versions.

## Outputs and interpretation

- `session.json`: root PID and creation-time identity, on-disk executable hash,
  file version, OS and runtime environment, declarations and limitations. Collector
  script/module SHA-256 hashes are computed at invocation start; keep both files
  unchanged throughout a capture.
- `samples.json`: timestamped totals and per-role totals with completeness flags.
- `processes.csv`: per-process identity, age, role, memory, CPU and handle counters.
- `roles.csv`: total and per-role counters in table form at each sample time.

PID plus creation time identifies a process. Descendants are attributed through
observed parent relationships; previously observed orphans remain in the tree.
Reused PIDs do not inherit attribution. An unobserved process that orphaned before
the first snapshot cannot be recovered safely. A missing root, unavailable tree
snapshot, missing relevant creation time or failed required process counter makes
that sample's total memory/CPU/handle metrics unavailable. Do not average partial
totals as if they represented the full tree. Per-role totals may still be useful
when their own completeness flag is true.

Private bytes measure process-private committed allocation and are the primary
additive memory metric. Working-set sums include shared resident pages more than
once; do not describe them as unique or proportional memory. PSS and unique
resident memory are not collected. `-IncludePrivateWorkingSet` optionally samples
PERF CIM counters, accepting a PID only when its reported age matches the pinned
process age within two seconds. This is approximate: stale PERF counters or rapid
PID reuse inside that tolerance can still misattribute an optional value. The
primary private-byte and working-set counters use the pinned process handle.
The PERF query can add substantial overhead and may leave the value unavailable;
match this option across compared runs.

CPU percentage uses changes in cumulative process CPU time divided by monotonic
elapsed time and logical CPU count. The first observation of each process has no
CPU delta. CPU totals remain unavailable while any included process lacks a
delta. A sample's `elapsedSeconds` marks observation start; collecting a tree is
not atomic. The collector records actual monotonic duration, which may exceed the
requested duration when a counter query is slow. CSV decimals follow the host
PowerShell culture; JSON stores numeric values independent of locale.

Attaching to an existing process measures process age and time observed. It does
not measure startup latency. For startup, arrange observation immediately after
manually launching the release build and label the result as a startup
observation. Measure launch-to-interactive latency separately with a defined UI
readiness signal; do not substitute process age or first-sample time.

## Repeatable scenario matrix

Prepare each scenario manually and use the same service state for each compared
build. Preserve notification delivery and sign-in persistence during preparation.

| Scenario             | Preparation and checkpoints                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Startup observation  | Observe immediately after manual launch; record process age and first observation delay.                                        |
| Idle                 | Sample after 1, 5, 15 and 30 minutes of continuous idle. A 1,800 second capture also records the interval between checkpoints.  |
| One Synology account | Declare one Synology ChatPlus service and confirmed account count; wait for normal loading before idle capture.                 |
| Multiple accounts    | Use distinct service profiles; keep provider/account counts identical between runs.                                             |
| Multiple messengers  | Include the intended Synology, Discord, WhatsApp, Messenger and Mattermost workload; declare each count.                        |
| Background and tray  | Capture foreground, background, minimized and tray states separately; confirm notifications still arrive.                       |
| Repeated switching   | Use the same ordered switch sequence and count; capture before, during and after it.                                            |
| Closing services     | Capture before and after the same disable/remove action; check renderer/process counts settle and retained services still work. |
| Extended operation   | Repeat after a defined long session, such as four hours, with matched activity and reconnect conditions.                        |

For each scenario, collect at least three matched release-build runs before and
after the proposed change. Record version/hash, WebView2 version, OS, CPU count,
cadence, warmup, enabled services, window state and workload. Avoid builds, test
suites, updates and other heavy work during captures. Account for incoming
messages, provider background activity, GPU work and collector overhead. Alternate
build order where practical to reduce runtime-update and caching effects.

Compare complete synchronized total samples and per-role distributions. Report
run medians and ranges, process counts, handles and normalized CPU alongside
private bytes; retain unavailable values as unavailable. Inspect monotonic growth
after repeated service actions rather than treating a single high working set as
a leak. Keep raw local evidence private; publish only reviewed aggregate results
with workload and measurement limitations. Do not claim savings from unmatched
snapshots or fixture-level work-count reductions.

Run the synthetic attribution/privacy checks with:

```powershell
powershell.exe -NoProfile -File tests/profile-process-tree.selftest.ps1
```

## Windows account isolation and process groups

The service ID selects a persistent `services/<id>` data directory; the migrated
`chatplus` service retains its original default store. Tauri keys its WebView
contexts by data directory, and Wry passes that directory as WebView2's user data
folder. Each folder has its own browser/helper collection under Microsoft's
[process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model).
Repeated browser, GPU and utility processes can therefore be expected with
separate accounts; their presence alone does not establish duplicate creation.

WebView2 supports [named profiles in a shared environment](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/multi-profile-support).
The locked Wry API has `with_profile_name`, but the current Tauri/runtime layers
do not forward that setting. Changing only `data_directory` would reuse the
default profile and merge same-origin account state. A shared-environment
experiment needs explicit profile plumbing and measured evidence before adoption.

Such an experiment must preserve profile isolation on older runtimes, related
authentication/download popups and existing sign-ins. Wry's legacy controller
fallback does not apply named profiles; popups must use both the opener's
environment and profile under Microsoft's [popup contract](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2newwindowrequestedeventargs).
The documented [user-data-folder move](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder)
does not establish a safe migration that combines multiple existing default
profiles. Keep the current directories until migration, rollback, notifications,
two-account isolation and compatibility have been validated.
