//! Secondary launches enqueue activation without entering WebView focus callbacks.
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Default)]
struct Queue {
    ready: bool,
    pending: bool,
    running: bool,
}

#[derive(Default)]
pub struct Activation(Mutex<Queue>);

impl Activation {
    fn request(&self) -> bool {
        let mut queue = self.0.lock().unwrap_or_else(|error| error.into_inner());
        queue.pending = true;
        Self::start(&mut queue)
    }

    fn ready(&self) -> bool {
        let mut queue = self.0.lock().unwrap_or_else(|error| error.into_inner());
        queue.ready = true;
        Self::start(&mut queue)
    }

    fn start(queue: &mut Queue) -> bool {
        if queue.ready && queue.pending && !queue.running {
            queue.running = true;
            true
        } else {
            false
        }
    }

    fn take(&self) -> bool {
        let mut queue = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if queue.pending {
            queue.pending = false;
            true
        } else {
            queue.running = false;
            false
        }
    }

    fn failed_to_start(&self) {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .running = false;
    }
}

fn drain(activation: &Activation, mut restore: impl FnMut()) {
    // Never hold the queue lock while invoking Tauri or waiting for its UI thread.
    while activation.take() {
        restore();
    }
}

fn spawn_worker(app: &AppHandle) {
    let handle = app.clone();
    if std::thread::Builder::new()
        .name("chatplus-activation".into())
        .spawn(move || {
            drain(&handle.state::<Activation>(), || {
                #[cfg(debug_assertions)]
                eprintln!("[single-instance] restoring main window");
                match crate::window::show_main_window(&handle) {
                    Ok(true) => {}
                    Ok(false) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[single-instance] main window unavailable during initial setup");
                    }
                    Err(_) => {
                        eprintln!("[single-instance] could not restore main window");
                    }
                }
            });
        })
        .is_err()
    {
        app.state::<Activation>().failed_to_start();
        eprintln!("[single-instance] could not queue main window activation");
    }
}

pub fn activate(app: &AppHandle) {
    #[cfg(debug_assertions)]
    eprintln!("[single-instance] secondary launch detected");
    // Swiph3l: Windows invokes this inside WM_COPYDATA on the UI thread. Even
    // run_on_main_thread executes inline there. Provider focus must originate
    // off-thread so Wry releases its window-ID mutex before WebView2 GotFocus.
    if app.state::<Activation>().request() {
        spawn_worker(app);
    }
}

pub fn ready(app: &AppHandle) {
    // A launch received while WebViews are being built survives startup without
    // accessing application state or attempting to recreate those views.
    if app.state::<Activation>().ready() {
        spawn_worker(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn startup_launches_wait_for_readiness_and_coalesce() {
        let activation = Activation::default();
        for _ in 0..10 {
            assert!(!activation.request());
        }
        assert!(activation.ready());
        assert!(!activation.ready());
        let mut restores = 0;
        drain(&activation, || restores += 1);
        assert_eq!(restores, 1);
        assert!(activation.request());
        drain(&activation, || restores += 1);
        assert_eq!(restores, 2);
    }

    #[test]
    fn normal_startup_does_not_activate_and_failed_worker_can_retry() {
        let activation = Activation::default();
        assert!(!activation.ready());
        assert!(activation.request());
        activation.failed_to_start();
        assert!(activation.request());
        let mut restores = 0;
        drain(&activation, || restores += 1);
        assert_eq!(restores, 1);
    }

    #[test]
    fn callback_remains_nonblocking_and_launches_during_restore_are_retained() {
        let activation = Arc::new(Activation::default());
        assert!(!activation.ready());
        assert!(activation.request());
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let worker_activation = activation.clone();
        let worker = std::thread::spawn(move || {
            let mut restores = 0;
            drain(&worker_activation, || {
                restores += 1;
                if restores == 1 {
                    entered_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
            });
            done_tx.send(restores).unwrap();
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (requested_tx, requested_rx) = mpsc::channel();
        let callback_activation = activation.clone();
        let callback = std::thread::spawn(move || {
            for _ in 0..10 {
                assert!(!callback_activation.request());
            }
            requested_tx.send(()).unwrap();
        });
        requested_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        release_tx.send(()).unwrap();
        assert_eq!(done_rx.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
        callback.join().unwrap();
        worker.join().unwrap();
    }
}
