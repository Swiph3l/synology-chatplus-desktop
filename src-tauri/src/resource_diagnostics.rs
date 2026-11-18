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
pub struct Environment {
    version: &'static str,
    os: &'static str,
    architecture: &'static str,
    webview_version: Option<String>,
    enabled_types: Vec<ProviderId>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    environment: Environment,
    uptime_seconds: u64,
    main_resident_bytes: Option<u64>,
    main_cpu_percent: Option<f64>,
    active_services: usize,
    webview_processes: Option<usize>,
    webview_resident_bytes: Option<u64>,
}

pub fn environment(app: &tauri::AppHandle) -> Environment {
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
    Environment {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        webview_version: tauri::webview_version().ok(),
        enabled_types,
    }
}

pub fn sample(app: &tauri::AppHandle) -> Snapshot {
    let clock = app.state::<StartupClock>();
    let uptime = clock.started.elapsed();
    let cpu = cpu_percent(
        clock.cpu_seconds,
        platform::cpu_seconds(),
        uptime.as_secs_f64(),
    );
    let views = app.webviews();
    let active_services = views
        .keys()
        .filter(|label| label.starts_with("service-"))
        .count();
    let (webview_processes, webview_resident_bytes) = platform::webviews(views.into_values());
    Snapshot {
        environment: environment(app),
        uptime_seconds: uptime.as_secs(),
        main_resident_bytes: platform::main_resident_bytes(),
        main_cpu_percent: cpu,
        active_services,
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
    use std::{
        collections::HashSet,
        sync::mpsc,
        time::{Duration, Instant},
    };
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment8;
    use windows::{
        core::{Interface, Owned},
        Win32::{
            Foundation::{FILETIME, HANDLE},
            System::{
                ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
                SystemInformation::GetSystemTimePreciseAsFileTime,
                Threading::{
                    GetCurrentProcess, GetProcessTimes, OpenProcess,
                    PROCESS_QUERY_LIMITED_INFORMATION,
                },
            },
        },
    };

    fn ticks(time: FILETIME) -> u64 {
        (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
    }

    fn process_times(handle: HANDLE) -> Option<(u64, u64)> {
        let [mut created, mut exited, mut kernel, mut user] = [FILETIME::default(); 4];
        unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) }
            .ok()?;
        Some((ticks(created), ticks(kernel) + ticks(user)))
    }

    pub(super) fn cpu_seconds() -> Option<f64> {
        Some(process_times(unsafe { GetCurrentProcess() })?.1 as f64 / 10_000_000.0)
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

    fn resident_at_sample(pid: u32, cutoff: u64) -> Option<u64> {
        let process =
            unsafe { Owned::new(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?) };
        let (created, _) = process_times(*process)?;
        if created > cutoff {
            return None;
        }
        resident_bytes(*process)
    }

    fn environment_pids(view: &tauri::webview::PlatformWebview) -> Option<Vec<u32>> {
        let environment: ICoreWebView2Environment8 = view.environment().cast().ok()?;
        let processes = unsafe { environment.GetProcessInfos() }.ok()?;
        let mut count = 0;
        unsafe { processes.Count(&mut count) }.ok()?;
        (0..count)
            .map(|index| {
                let info = unsafe { processes.GetValueAtIndex(index) }.ok()?;
                let mut pid = 0;
                unsafe { info.ProcessId(&mut pid) }.ok()?;
                u32::try_from(pid).ok().filter(|&pid| pid > 0)
            })
            .collect()
    }

    pub(super) fn webviews(
        views: impl Iterator<Item = tauri::Webview>,
    ) -> (Option<usize>, Option<u64>) {
        // Swiph3l: Ask the application's WebView2 environments on their COM thread.
        // A generic process-tree walk can include unrelated apps launched via the shell.
        let (send, receive) = mpsc::channel();
        let deadline = Instant::now() + Duration::from_secs(2);
        let cutoff = ticks(unsafe { GetSystemTimePreciseAsFileTime() });
        let mut expected = 0;
        for view in views {
            let send = send.clone();
            if view
                .with_webview(move |view| {
                    if Instant::now() < deadline {
                        let _ = send.send(environment_pids(&view));
                    }
                })
                .is_err()
            {
                return (None, None);
            }
            expected += 1;
        }
        drop(send);
        let mut pids = HashSet::new();
        for _ in 0..expected {
            let Ok(Some(ids)) =
                receive.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            else {
                return (None, None);
            };
            pids.extend(ids);
        }
        // Swiph3l: A renderer can exit, and its PID can be recycled before OpenProcess.
        // Require its handle to predate this sample; return no total if any reading is missing.
        let bytes = pids.iter().try_fold(0_u64, |sum, &pid| {
            sum.checked_add(resident_at_sample(pid, cutoff)?)
        });
        (Some(pids.len()), bytes)
    }

    #[cfg(test)]
    #[test]
    fn replacement_process_cannot_supply_memory_for_an_earlier_snapshot() {
        assert_eq!(resident_at_sample(std::process::id(), 0), None);
        let now = ticks(unsafe { GetSystemTimePreciseAsFileTime() });
        assert!(resident_at_sample(std::process::id(), now).is_some_and(|bytes| bytes > 0));
        assert_eq!(webviews(std::iter::empty()), (Some(0), Some(0)));
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
    pub(super) fn webviews(
        _views: impl Iterator<Item = tauri::Webview>,
    ) -> (Option<usize>, Option<u64>) {
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
        assert_eq!(platform::webviews(std::iter::empty()), (None, None));
    }

    #[test]
    fn native_main_process_sample_returns_resident_memory_and_cpu_time() {
        assert!(platform::main_resident_bytes().is_some_and(|value| value > 0));
        assert!(platform::cpu_seconds().is_some());
    }
}
