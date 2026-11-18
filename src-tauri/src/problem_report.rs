use std::{
    fs::OpenOptions,
    io::{self, Write},
    path::Path,
};

pub fn save(directory: &Path, report: &str) -> io::Result<String> {
    if report.len() > 48 * 1024 || !report.starts_with("# Chat+ problem report\n\n") {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    // Swiph3l: The renderer supplies only the reviewed Markdown. Native code
    // chooses the Downloads folder and reserves a new file, including on retry.
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    for index in 1..=9999 {
        let filename = if index == 1 {
            "ChatPlus-report.md".to_owned()
        } else {
            format!("ChatPlus-report-{index}.md")
        };
        let path = directory.join(&filename);
        let mut file = match options.open(&path) {
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            result => result?,
        };
        if let Err(error) = file
            .write_all(report.as_bytes())
            .and_then(|_| file.sync_all())
        {
            drop(file);
            let _ = std::fs::remove_file(path);
            return Err(error);
        }
        return Ok(filename);
    }
    Err(io::Error::from(io::ErrorKind::AlreadyExists))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_export_preserves_reviewed_text_and_never_replaces_an_existing_file() {
        let mut nonce = [0u8; 8];
        getrandom::fill(&mut nonce).unwrap();
        let directory =
            std::env::temp_dir().join(format!("chatplus-report-{}", u64::from_ne_bytes(nonce)));
        std::fs::create_dir(&directory).unwrap();
        let first = "# Chat+ problem report\n\n    Preview A\n";
        let next = "# Chat+ problem report\n\n    Preview B\n";
        let a = save(&directory, first).unwrap();
        let b = save(&directory, next).unwrap();
        assert_ne!(a, b);
        assert_eq!(std::fs::read_to_string(directory.join(&a)).unwrap(), first);
        assert_eq!(std::fs::read_to_string(directory.join(&b)).unwrap(), next);
        assert!(save(&directory, "raw private logs").is_err());
        assert!(save(&directory, &format!("{first}{}", "x".repeat(49152))).is_err());
        for file in [a, b] {
            std::fs::remove_file(directory.join(file)).unwrap();
        }
        std::fs::remove_dir(directory).unwrap();
    }
}
