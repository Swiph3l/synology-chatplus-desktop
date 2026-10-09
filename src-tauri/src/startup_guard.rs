//! Serialize Windows startup until the official single-instance receiver exists.
//!
//! This guard does not decide which process is primary or activate any window.
//! The single-instance plugin still forwards activation and exits secondary launches.

use std::{marker::PhantomData, rc::Rc};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT},
        System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject},
    },
};

const STARTUP_TIMEOUT_MS: u32 = 10_000;
const COORDINATION_ERROR: &str = "Could not coordinate ChatPlus startup.";
const STARTUP_TIMEOUT_ERROR: &str = "Another ChatPlus launch is still starting. Try again.";

pub struct StartupGuard {
    handle: HANDLE,
    // Windows mutex ownership belongs to the acquiring thread. Keep this guard
    // on that thread, including when it is released after Tauri's build phase.
    _same_thread: PhantomData<Rc<()>>,
}

pub fn acquire(identifier: &str) -> Result<StartupGuard, String> {
    acquire_with_timeout(identifier, STARTUP_TIMEOUT_MS)
}

fn acquire_with_timeout(identifier: &str, timeout_ms: u32) -> Result<StartupGuard, String> {
    // Local matches the plugin's per-session scope. Use the effective Tauri
    // identifier, so development validation profiles remain independent.
    let name: Vec<u16> = format!("Local\\{identifier}-startup-registration")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe { CreateMutexW(None, false, PCWSTR(name.as_ptr())) }
        .map_err(|_| COORDINATION_ERROR.to_string())?;
    match unsafe { WaitForSingleObject(handle, timeout_ms) } {
        WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(StartupGuard {
            handle,
            _same_thread: PhantomData,
        }),
        result => {
            // Failed acquisition owns only the handle, not the mutex.
            let _ = unsafe { CloseHandle(handle) };
            Err(if result == WAIT_TIMEOUT {
                STARTUP_TIMEOUT_ERROR
            } else {
                COORDINATION_ERROR
            }
            .to_string())
        }
    }
}

impl Drop for StartupGuard {
    fn drop(&mut self) {
        let _ = unsafe { ReleaseMutex(self.handle) };
        let _ = unsafe { CloseHandle(self.handle) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc,
        },
        time::Duration,
    };

    fn identifier() -> String {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        format!(
            "io.github.chatplus.startup-test.{}.{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[test]
    fn another_startup_is_blocked_until_the_primary_finishes_registration() {
        let id = identifier();
        let primary = acquire(&id).unwrap();
        let (result_tx, result_rx) = mpsc::channel();
        let (retry_tx, retry_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let error = acquire_with_timeout(&id, 0).err();
            result_tx.send(error).unwrap();
            retry_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let secondary = acquire_with_timeout(&id, 1_000);
            result_tx.send(secondary.err()).unwrap();
        });
        assert_eq!(
            result_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            Some(STARTUP_TIMEOUT_ERROR.to_string())
        );
        drop(primary);
        retry_tx.send(()).unwrap();
        assert_eq!(
            result_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            None
        );
        worker.join().unwrap();
    }

    #[test]
    fn independent_validation_identifiers_do_not_block_each_other() {
        let primary = acquire(&identifier()).unwrap();
        let other_id = identifier();
        std::thread::spawn(move || {
            let independent = acquire_with_timeout(&other_id, 0).unwrap();
            drop(independent);
        })
        .join()
        .unwrap();
        drop(primary);
    }

    #[test]
    fn a_plugin_exit_without_rust_drop_does_not_block_the_next_launch() {
        let id = identifier();
        let abandoned_id = id.clone();
        let raw_handle = std::thread::spawn(move || {
            let guard = acquire(&abandoned_id).unwrap();
            let raw_handle = guard.handle.0 as usize;
            // The official plugin exits the secondary process directly, so
            // Rust destructors do not release its startup mutex. Thread exit
            // exercises the same Windows abandoned-mutex ownership transfer.
            std::mem::forget(guard);
            raw_handle
        })
        .join()
        .unwrap();

        struct AbandonedHandle(HANDLE);
        impl Drop for AbandonedHandle {
            fn drop(&mut self) {
                let _ = unsafe { CloseHandle(self.0) };
            }
        }
        // The test process survives, unlike the exiting secondary, so close
        // its original handle explicitly after checking the ownership transfer.
        let original = AbandonedHandle(HANDLE(raw_handle as *mut std::ffi::c_void));
        let recovered = acquire_with_timeout(&id, 0).unwrap();
        drop(original);
        drop(recovered);

        std::thread::spawn(move || {
            let next = acquire_with_timeout(&id, 0).unwrap();
            drop(next);
        })
        .join()
        .unwrap();
    }
}
