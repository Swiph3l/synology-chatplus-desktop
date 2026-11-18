//! Single on-demand snapshots. Only numeric observations and fixed service types cross IPC.
use crate::{providers::ProviderId, state};
use serde::Serialize;
use std::time::Instant;
use tauri::Manager;

pub struct StartupClock {
    started: Instant,
    cpu_seconds: Option<f64>,
}

impl StartupClock {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            cpu_seconds: platform::cpu_seconds(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    version: &'static str,
    os: &'static str,
    architecture: &'static str,
    webview_version: Option<String>,
    uptime_seconds: u64,
    main_resident_bytes: Option<u64>,
    main_cpu_percent: Option<f64>,
    active_services: usize,
    enabled_types: Vec<ProviderId>,
    webview_processes: Option<usize>,
    webview_resident_bytes: Option<u64>,
}

pub fn sample(app: &tauri::AppHandle) -> Snapshot {
    let clock = app.state::<StartupClock>();
    let uptime = clock.started.elapsed();
    let settings = app.state::<state::AppState>();
    let mut enabled_types = Vec::new();
    {
        let settings = settings.0.lock().unwrap_or_else(|error| error.into_inner());
        for service in settings.services.iter().filter(|service| service.enabled) {
            if !enabled_types.contains(&service.provider) {
                enabled_types.push(service.provider);
            }
        }
    }
    let active_services = app
        .webviews()
        .keys()
        .filter(|label| label.starts_with("service-"))
        .count();
    let (webview_processes, webview_resident_bytes) = platform::webviews();
    Snapshot {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        webview_version: tauri::webview_version().ok(),
        uptime_seconds: uptime.as_secs(),
        main_resident_bytes: platform::main_resident_bytes(),
        main_cpu_percent: cpu_percent(
            clock.cpu_seconds,
            platform::cpu_seconds(),
            uptime.as_secs_f64(),
        ),
        active_services,
        enabled_types,
        webview_processes,
        webview_resident_bytes,
    }
}

fn cpu_percent(start: Option<f64>, end: Option<f64>, elapsed: f64) -> Option<f64> {
    let used = end? - start?;
    (elapsed > 0.0 && used >= 0.0).then(|| 100.0 * used / elapsed)
}

#[cfg(windows)]
mod platform {
    use std::collections::{HashMap, HashSet};
    use windows::{
        core::Owned,
        Win32::{
            Foundation::{ERROR_NO_MORE_FILES, FILETIME, HANDLE},
            System::{
                Diagnostics::ToolHelp::*,
                ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
                Threading::{
                    GetCurrentProcess, GetProcessTimes, OpenProcess,
                    PROCESS_QUERY_LIMITED_INFORMATION,
                },
            },
        },
    };

    pub(super) fn cpu_seconds() -> Option<f64> {
        let [mut created, mut exited, mut kernel, mut user] = [FILETIME::default(); 4];
        unsafe {
            GetProcessTimes(
                GetCurrentProcess(),
                &mut created,
                &mut exited,
                &mut kernel,
                &mut user,
            )
        }
        .ok()?;
        let ticks = |v: FILETIME| (u64::from(v.dwHighDateTime) << 32) | u64::from(v.dwLowDateTime);
        Some((ticks(kernel) + ticks(user)) as f64 / 10_000_000.0)
    }

    fn resident_bytes(handle: HANDLE) -> Option<u64> {
        let size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let mut counters = PROCESS_MEMORY_COUNTERS {
            cb: size,
            ..Default::default()
        };
        unsafe { GetProcessMemoryInfo(handle, &mut counters, size) }.ok()?;
        Some(counters.WorkingSetSize as u64)
    }

    pub(super) fn main_resident_bytes() -> Option<u64> {
        resident_bytes(unsafe { GetCurrentProcess() })
    }

    fn webview_pids() -> Option<Vec<u32>> {
        // Swiph3l: Parent IDs and an executable-name match are sufficient for attribution.
        let snapshot = unsafe { Owned::new(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?) };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        unsafe { Process32FirstW(*snapshot, &mut entry) }.ok()?;
        let mut children = HashMap::<u32, Vec<(u32, bool)>>::new();
        loop {
            let length = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            let webview = String::from_utf16_lossy(&entry.szExeFile[..length])
                .eq_ignore_ascii_case("msedgewebview2.exe");
            children
                .entry(entry.th32ParentProcessID)
                .or_default()
                .push((entry.th32ProcessID, webview));
            if let Err(error) = unsafe { Process32NextW(*snapshot, &mut entry) } {
                if error.code() != ERROR_NO_MORE_FILES.to_hresult() {
                    return None;
                }
                break;
            }
        }
        let mut stack = vec![std::process::id()];
        let mut seen = HashSet::from([std::process::id()]);
        let mut pids = Vec::new();
        while let Some(parent) = stack.pop() {
            for (pid, webview) in children.remove(&parent).unwrap_or_default() {
                if seen.insert(pid) {
                    if webview {
                        pids.push(pid);
                    }
                    stack.push(pid);
                }
            }
        }
        Some(pids)
    }

    pub(super) fn webviews() -> (Option<usize>, Option<u64>) {
        let Some(pids) = webview_pids() else {
            return (None, None);
        };
        // Swiph3l: Discard partial totals when a renderer exits or denies access during sampling.
        let bytes = pids.iter().try_fold(0_u64, |sum, &pid| {
            let process = unsafe {
                Owned::new(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?)
            };
            sum.checked_add(resident_bytes(*process)?)
        });
        (Some(pids.len()), bytes)
    }
}

#[cfg(unix)]
mod platform {
    pub(super) fn cpu_seconds() -> Option<f64> {
        let mut usage = std::mem::MaybeUninit::uninit();
        if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
            return None;
        }
        let usage = unsafe { usage.assume_init() };
        let seconds = |time: libc::timeval| time.tv_sec as f64 + time.tv_usec as f64 / 1_000_000.0;
        Some(seconds(usage.ru_utime) + seconds(usage.ru_stime))
    }

    #[cfg(target_os = "linux")]
    pub(super) fn main_resident_bytes() -> Option<u64> {
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        let mut fields = status
            .lines()
            .find_map(|line| line.strip_prefix("VmRSS:"))?
            .split_whitespace();
        let kib = fields.next()?.parse::<u64>().ok()?;
        (fields.next() == Some("kB"))
            .then_some(kib)?
            .checked_mul(1024)
    }

    #[cfg(target_os = "macos")]
    pub(super) fn main_resident_bytes() -> Option<u64> {
        let mut info = std::mem::MaybeUninit::<libc::proc_taskinfo>::uninit();
        let size = std::mem::size_of::<libc::proc_taskinfo>() as i32;
        let result = unsafe {
            libc::proc_pidinfo(
                std::process::id() as i32,
                libc::PROC_PIDTASKINFO,
                0,
                info.as_mut_ptr().cast(),
                size,
            )
        };
        (result == size).then(|| unsafe { info.assume_init() }.pti_resident_size)
    }

    // Swiph3l: WebKit helpers can be shared or launched outside the app's process tree.
    pub(super) fn webviews() -> (Option<usize>, Option<u64>) {
        (None, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_metrics_and_multiple_cpu_cores_are_distinct_from_idle() {
        assert_eq!(cpu_percent(None, Some(1.0), 3.0), None);
        assert_eq!(cpu_percent(Some(1.0), Some(1.0), 0.0), None);
        assert_eq!(cpu_percent(Some(1.0), Some(1.0), 3.0), Some(0.0));
        assert_eq!(cpu_percent(Some(1.0), Some(7.0), 3.0), Some(200.0));
        #[cfg(unix)]
        assert_eq!(platform::webviews(), (None, None));
    }

    #[test]
    fn native_main_process_sample_returns_resident_memory_and_cpu_time() {
        assert!(platform::main_resident_bytes().is_some_and(|value| value > 0));
        assert!(platform::cpu_seconds().is_some());
    }
}
