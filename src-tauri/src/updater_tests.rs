//! HTTPS fixtures use ephemeral keys in memory; never install fixture payloads.
use super::{accepts, UpdateChannel};
use base64::{engine::general_purpose::STANDARD, Engine};
use semver::Version;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri_plugin_updater::UpdaterExt;

struct Fixture {
    endpoint: url::Url,
    certificate: Vec<u8>,
    public_key: String,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Fixture {
    fn new(version: &str, bad_json: bool, bad_signature: bool, slow: bool) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let certificate = cert.der().to_vec();
        let tls = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![cert.der().clone()],
                rustls::pki_types::PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into(),
            )
            .unwrap();
        let tls = Arc::new(tls);
        let key = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        let payload = if slow {
            vec![42u8; 512 * 1024]
        } else {
            b"Signed updater test payload. Never execute or install this file.".to_vec()
        };
        let signature = minisign::sign(
            Some(&key.pk),
            &key.sk,
            std::io::Cursor::new(&payload),
            Some("local updater test"),
            Some("test only"),
        )
        .unwrap();
        let public_key = STANDARD.encode(key.pk.to_box().unwrap().to_string());
        let signature = if bad_signature {
            STANDARD.encode("invalid signature")
        } else {
            STANDARD.encode(signature.to_string())
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let endpoint: url::Url = format!("https://localhost:{port}/latest.json")
            .parse()
            .unwrap();
        let metadata = if bad_json {
            b"invalid JSON".to_vec()
        } else {
            serde_json::to_vec(&serde_json::json!({"version":version,"notes":"Synthetic fixture notes","pub_date":"2026-09-13T00:00:00Z","platforms":{"windows-x86_64":{"signature":signature,"url":format!("https://localhost:{port}/payload")},"linux-x86_64":{"signature":signature,"url":format!("https://localhost:{port}/payload")},"darwin-aarch64":{"signature":signature,"url":format!("https://localhost:{port}/payload")}}})).unwrap()
        };
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let worker = std::thread::spawn(move || {
            while !flag.load(Ordering::Relaxed) {
                let Ok((stream, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                };
                stream.set_nonblocking(false).unwrap();
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                let mut stream = rustls::StreamOwned::new(
                    rustls::ServerConnection::new(tls.clone()).unwrap(),
                    stream,
                );
                let mut request = Vec::new();
                let mut buf = [0u8; 1024];
                while request.len() < 8192 && !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => request.extend_from_slice(&buf[..n]),
                    }
                }
                let downloading = request.starts_with(b"GET /payload ");
                let body = if downloading { &payload } else { &metadata };
                if write!(stream,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",body.len()).is_err() {continue;}
                for chunk in body.chunks(1024) {
                    if stream
                        .write_all(chunk)
                        .and_then(|_| stream.flush())
                        .is_err()
                    {
                        break;
                    }
                    if downloading && slow {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                }
                stream.conn.send_close_notify();
                let _ = stream.flush();
            }
        });
        Self {
            endpoint,
            certificate,
            public_key,
            stop,
            worker: Some(worker),
        }
    }
    fn updater(
        &self,
        app: &tauri::AppHandle<tauri::test::MockRuntime>,
        channel: UpdateChannel,
    ) -> tauri_plugin_updater::Updater {
        let cert = reqwest::Certificate::from_der(&self.certificate).unwrap();
        app.updater_builder()
            .endpoints(vec![self.endpoint.clone()])
            .unwrap()
            .pubkey(self.public_key.clone())
            .target("windows-x86_64")
            .timeout(Duration::from_secs(5))
            .no_proxy()
            .version_comparator(move |current, remote| accepts(&current, &remote.version, &channel))
            .configure_client(move |client| {
                client.https_only(true).add_root_certificate(cert.clone())
            })
            .build()
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            worker.join().unwrap();
        }
    }
}
fn app() -> tauri::App<tauri::test::MockRuntime> {
    app_version("0.1.0")
}
fn app_version(version: &str) -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.package_info_mut().version = Version::parse(version).unwrap();
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({"pubkey":"", "endpoints":[]}),
    );
    tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap()
}
#[tokio::test]
async fn beta_one_downloads_and_verifies_beta_two_only_in_prerelease_channel() {
    let app = app_version("0.5.0-beta.1");
    let fixture = Fixture::new("0.5.0-beta.2", false, false, false);
    assert!(fixture
        .updater(app.handle(), UpdateChannel::Stable)
        .check()
        .await
        .unwrap()
        .is_none());
    let update = fixture
        .updater(app.handle(), UpdateChannel::PreRelease)
        .check()
        .await
        .unwrap()
        .unwrap();
    assert_eq!(update.version, "0.5.0-beta.2");
    assert!(!update.download(|_, _| {}, || {}).await.unwrap().is_empty());
    // A real installation/restart remains a separate owner smoke test.
}
#[tokio::test]
async fn actual_updater_verifies_signed_https_download() {
    let app = app();
    let fixture = Fixture::new("0.2.0", false, false, false);
    let update = fixture
        .updater(app.handle(), UpdateChannel::Stable)
        .check()
        .await
        .unwrap()
        .unwrap();
    let mut count = 0;
    let bytes = update
        .download(|size, _| count += size, || {})
        .await
        .unwrap();
    assert_eq!(count, bytes.len());
    assert!(bytes.starts_with(b"Signed updater"));
    // No call to install: fixture is deliberately not an executable.
}
#[tokio::test]
async fn updater_rejects_bad_signature_and_invalid_metadata() {
    let app = app();
    let fixture = Fixture::new("0.2.0", false, true, false);
    let update = fixture
        .updater(app.handle(), UpdateChannel::Stable)
        .check()
        .await
        .unwrap()
        .unwrap();
    assert!(update.download(|_, _| {}, || {}).await.is_err());
    let invalid = Fixture::new("0.2.0", true, false, false);
    assert!(invalid
        .updater(app.handle(), UpdateChannel::Stable)
        .check()
        .await
        .is_err());
}
#[tokio::test]
async fn updater_channel_checks_and_no_update_use_real_metadata() {
    let app = app();
    let same = Fixture::new("0.1.0", false, false, false);
    assert!(same
        .updater(app.handle(), UpdateChannel::Stable)
        .check()
        .await
        .unwrap()
        .is_none());
    let preview = Fixture::new("0.2.0-rc.1", false, false, false);
    assert!(preview
        .updater(app.handle(), UpdateChannel::Stable)
        .check()
        .await
        .unwrap()
        .is_none());
    assert!(preview
        .updater(app.handle(), UpdateChannel::PreRelease)
        .check()
        .await
        .unwrap()
        .is_some());
}
#[tokio::test]
async fn updater_offline_and_cancelled_download_do_not_install() {
    let app = app();
    let fixture = Fixture::new("0.2.0", false, false, true);
    let updater = fixture.updater(app.handle(), UpdateChannel::Stable);
    let update = updater.check().await.unwrap().unwrap();
    let mut count = 0;
    let cancelled = tokio::select! { _ = tokio::time::sleep(Duration::from_millis(100))=>true, _ = update.download(|size,_|count+=size,||{})=>false };
    assert!(cancelled);
    assert!(count < 512 * 1024);
    drop(fixture);
    assert!(updater.check().await.is_err());
}
