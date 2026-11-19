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
    main_private_resident_bytes: Option<u64>,
    main_cpu_percent: Option<f64>,
    active_services: usize,
    #[serde(flatten)]
    webview: WebviewMemory,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewMemory {
    webview_processes: Option<usize>,
    app_webview_private_resident_bytes: Option<u64>,
    service_webview_private_resident_bytes: Option<u64>,
    shared_webview_private_resident_bytes: Option<u64>,
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
    let (main_resident_bytes, main_private_resident_bytes) = platform::main_memory();
    Snapshot {
        environment: environment(app),
        uptime_seconds: uptime.as_secs(),
        main_resident_bytes,
        main_private_resident_bytes,
        main_cpu_percent: cpu,
        active_services,
        webview: platform::webviews(app, views.into_values()),
    }
}

fn cpu_percent(start: Option<f64>, end: Option<f64>, elapsed: f64) -> Option<f64> {
    let used = end? - start?;
    (elapsed > 0.0 && used >= 0.0).then(|| 100.0 * used / elapsed)
}

#[cfg(windows)]
mod platform {
    use super::WebviewMemory;
    use std::{
        collections::{HashMap, HashSet},
        path::PathBuf,
        sync::mpsc,
        time::{Duration, Instant},
    };
    use tauri::Manager;
    use webview2_com::{
        CoTaskMemPWSTR, Microsoft::Web::WebView2::Win32::ICoreWebView2Environment8,
    };
    use windows::{
        core::{Interface, Owned},
        Win32::{
            Foundation::{FILETIME, HANDLE},
            System::{
                ProcessStatus::{
                    GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2,
                },
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

    fn resident_memory(handle: HANDLE) -> Option<(u64, u64)> {
        let size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32;
        let mut counters = PROCESS_MEMORY_COUNTERS_EX2 {
            cb: size,
            PrivateWorkingSetSize: usize::MAX,
            ..Default::default()
        };
        // Swiph3l: EX2 extends the PSAPI counter layout. A legacy Windows build
        // can leave the extra fields unwritten, so require a valid private value.
        unsafe {
            GetProcessMemoryInfo(
                handle,
                (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX2).cast(),
                size,
            )
        }
        .ok()?;
        (counters.cb >= size && counters.PrivateWorkingSetSize <= counters.WorkingSetSize)
            .then_some((
                counters.WorkingSetSize as u64,
                counters.PrivateWorkingSetSize as u64,
            ))
    }

    pub(super) fn main_memory() -> (Option<u64>, Option<u64>) {
        let handle = unsafe { GetCurrentProcess() };
        match resident_memory(handle) {
            Some((resident, private)) => (Some(resident), Some(private)),
            None => (resident_bytes(handle), None),
        }
    }

    fn private_at_sample(pid: u32, cutoff: u64) -> Option<u64> {
        let process =
            unsafe { Owned::new(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?) };
        let (created, _) = process_times(*process)?;
        if created > cutoff {
            return None;
        }
        resident_memory(*process).map(|(_, private)| private)
    }

    fn environment_processes(
        view: &tauri::webview::PlatformWebview,
    ) -> Option<(PathBuf, Vec<u32>)> {
        let environment: ICoreWebView2Environment8 = view.environment().cast().ok()?;
        let mut folder = Default::default();
        unsafe { environment.UserDataFolder(&mut folder) }.ok()?;
        let directory = PathBuf::from(CoTaskMemPWSTR::from(folder).to_string());
        let processes = unsafe { environment.GetProcessInfos() }.ok()?;
        let mut count = 0;
        unsafe { processes.Count(&mut count) }.ok()?;
        let pids = (0..count)
            .map(|index| {
                let info = unsafe { processes.GetValueAtIndex(index) }.ok()?;
                let mut pid = 0;
                unsafe { info.ProcessId(&mut pid) }.ok()?;
                u32::try_from(pid).ok().filter(|&pid| pid > 0)
            })
            .collect::<Option<_>>()?;
        Some((directory, pids))
    }

    fn own_directories(app: &tauri::AppHandle) -> Option<HashSet<PathBuf>> {
        let root = app.path().app_local_data_dir().ok()?;
        let settings = app.state::<crate::state::AppState>();
        let profiles: Vec<_> = settings
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .services
            .iter()
            .filter_map(|service| service.profile_directory(&root))
            .collect();
        Some(
            std::iter::once(root)
                .chain(profiles)
                .filter_map(|path| path.canonicalize().ok())
                .collect(),
        )
    }

    #[derive(Default)]
    struct ViewGroup {
        app: bool,
        service: bool,
        pids: HashSet<u32>,
    }

    fn process_groups(
        views: impl Iterator<Item = tauri::Webview>,
        directories: &HashSet<PathBuf>,
    ) -> Option<(HashSet<u32>, HashSet<u32>)> {
        // Swiph3l: Ask each WebView2 environment on its COM thread. WebView2
        // honors system overrides, so also verify the effective data directory.
        let (send, receive) = mpsc::channel();
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut expected = 0;
        for view in views {
            let label = view.label();
            let service = label.starts_with("service-") || crate::popups::is_popup_label(label);
            let send = send.clone();
            view.with_webview(move |view| {
                if Instant::now() < deadline {
                    let _ = send.send((service, environment_processes(&view)));
                }
            })
            .ok()?;
            expected += 1;
        }
        drop(send);
        let mut groups = HashMap::<PathBuf, ViewGroup>::new();
        for _ in 0..expected {
            let (service, processes) = receive
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .ok()?;
            let (folder, pids) = processes?;
            let folder = folder.canonicalize().ok()?;
            if !directories.contains(&folder) {
                return None;
            }
            let group = groups.entry(folder).or_default();
            group.pids.extend(pids);
            if service {
                group.service = true;
            } else {
                group.app = true;
            }
        }
        let mut app_pids = HashSet::new();
        let mut service_pids = HashSet::<u32>::new();
        for group in groups.into_values() {
            if group.service {
                service_pids.extend(&group.pids);
            }
            if group.app {
                app_pids.extend(group.pids);
            }
        }
        Some((app_pids, service_pids))
    }

    fn sum_private<'a>(
        pids: impl Iterator<Item = &'a u32>,
        bytes: &mut impl FnMut(u32) -> Option<u64>,
    ) -> Option<u64> {
        let mut pids = pids.peekable();
        pids.peek()?;
        pids.try_fold(0_u64, |total, &pid| total.checked_add(bytes(pid)?))
    }

    fn summarize(
        app: &HashSet<u32>,
        services: &HashSet<u32>,
        mut bytes: impl FnMut(u32) -> Option<u64>,
    ) -> WebviewMemory {
        // Swiph3l: The migrated primary service can use the UI's original WebView2
        // profile. Attribute those PIDs once, to neither side's exclusive total.
        WebviewMemory {
            webview_processes: Some(app.union(services).count()),
            app_webview_private_resident_bytes: sum_private(app.difference(services), &mut bytes),
            service_webview_private_resident_bytes: sum_private(
                services.difference(app),
                &mut bytes,
            ),
            shared_webview_private_resident_bytes: sum_private(
                app.intersection(services),
                &mut bytes,
            ),
        }
    }

    pub(super) fn webviews(
        app: &tauri::AppHandle,
        views: impl Iterator<Item = tauri::Webview>,
    ) -> WebviewMemory {
        let cutoff = ticks(unsafe { GetSystemTimePreciseAsFileTime() });
        let groups =
            own_directories(app).and_then(|directories| process_groups(views, &directories));
        let Some((app, services)) = groups else {
            return WebviewMemory::default();
        };
        summarize(&app, &services, |pid| private_at_sample(pid, cutoff))
    }

    #[cfg(test)]
    #[test]
    fn replacement_process_cannot_supply_memory_for_an_earlier_snapshot() {
        assert_eq!(private_at_sample(std::process::id(), 0), None);
        if let (_, Some(private)) = main_memory() {
            let now = ticks(unsafe { GetSystemTimePreciseAsFileTime() });
            assert!(private > 0);
            assert!(private_at_sample(std::process::id(), now).is_some_and(|bytes| bytes > 0));
        }
    }

    #[cfg(test)]
    #[test]
    fn shared_processes_count_once_and_missing_metrics_stay_unavailable() {
        let app = HashSet::from([1, 2]);
        let services = HashSet::from([2, 3, 4]);
        let memory = summarize(&app, &services, |pid| (pid != 4).then_some(u64::from(pid)));
        assert_eq!(memory.webview_processes, Some(4));
        assert_eq!(memory.app_webview_private_resident_bytes, Some(1));
        assert_eq!(memory.service_webview_private_resident_bytes, None);
        assert_eq!(memory.shared_webview_private_resident_bytes, Some(2));

        let shared_only = summarize(&app, &app, |pid| Some(u64::from(pid)));
        assert_eq!(shared_only.app_webview_private_resident_bytes, None);
        assert_eq!(shared_only.service_webview_private_resident_bytes, None);
        assert_eq!(shared_only.shared_webview_private_resident_bytes, Some(3));
    }
}

#[cfg(unix)]
mod platform {
    use super::WebviewMemory;

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

    pub(super) fn main_memory() -> (Option<u64>, Option<u64>) {
        (main_resident_bytes(), None)
    }

    // Swiph3l: WebKit helpers can be shared or launched outside the app's process tree.
    pub(super) fn webviews(
        _: &tauri::AppHandle,
        _views: impl Iterator<Item = tauri::Webview>,
    ) -> WebviewMemory {
        WebviewMemory::default()
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
    }

    #[test]
    fn native_main_process_sample_returns_resident_memory_and_cpu_time() {
        assert!(platform::main_memory().0.is_some_and(|value| value > 0));
        assert!(platform::cpu_seconds().is_some());
    }
}
