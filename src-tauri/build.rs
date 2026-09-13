#[path = "src/version_format.rs"]
mod version_format;
use std::{env, fs, path::Path, process::Command};

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
fn main() {
    let manifest = env::var("CARGO_MANIFEST_DIR").unwrap();
    let root = Path::new(&manifest).parent().unwrap();
    for path in [
        "src",
        "Cargo.toml",
        "Cargo.lock",
        "theme-bootstrap.js",
        "../package.json",
        "../src",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
    for name in ["HEAD", "index", "packed-refs", "refs"] {
        if let Some(path) = git(root, &["rev-parse", "--git-path", name]) {
            println!("cargo:rerun-if-changed={}", root.join(path).display());
        }
    }
    if let Some(files) = git(
        root,
        &["ls-files", "--cached", "--others", "--exclude-standard"],
    ) {
        for file in files.lines() {
            println!("cargo:rerun-if-changed={}", root.join(file).display());
        }
    }
    let commit = git(root, &["rev-parse", "HEAD"]);
    let short = git(root, &["rev-parse", "--short=7", "HEAD"]);
    let branch = git(root, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let tag = git(root, &["describe", "--tags", "--exact-match", "HEAD"]);
    let dirty =
        git(root, &["status", "--porcelain", "--untracked-files=normal"]).map(|s| !s.is_empty());
    let source = env::var("CARGO_PKG_VERSION").unwrap();
    let (display, channel) = version_format::version(&source, tag.as_deref(), short.as_deref());
    let rust = Command::new(env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());
    let date = time::OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .unwrap()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let metadata = serde_json::json!({"semantic_version":source,"display_version":display,"build_date_utc":date,
        "git_commit_full":commit,"git_commit_short":short,"git_branch":branch,"git_tag":tag,
        "build_channel":channel,"is_dirty":dirty,"rust_version":rust});
    fs::write(
        Path::new(&env::var("OUT_DIR").unwrap()).join("build-metadata.json"),
        metadata.to_string(),
    )
    .unwrap();
    tauri_build::build();
}
