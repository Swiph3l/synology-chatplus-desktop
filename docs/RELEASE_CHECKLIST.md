# Release checklist

Release automation is disabled until maintainer review and activation.
Record the exact commit, clean/dirty state, tool versions, UTC date and final
artifact hashes for each candidate. Never equate an unchecked item with PASS.

- [ ] Select a reviewed, committed source revision; no private changes or files.
- [ ] Align Cargo/npm/Tauri versions, release notes and eventual tag.
- [ ] Run `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`.
- [ ] Run `npm run build` and `npm run check:release`.
- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Run locked Cargo check, debug tests and release tests on supported targets.
- [ ] Run `npm run tauri build`; retain the actual final packages.
- [ ] Run `npm audit`, `cargo audit --file src-tauri/Cargo.lock --deny warnings`
      and `cargo deny --manifest-path src-tauri/Cargo.toml --config deny.toml --locked check`.
- [ ] Resolve or explicitly review advisories with target/reachability evidence;
      do not silence advisories merely to obtain a green build.
- [ ] Scan tracked and untracked candidate files with the free Gitleaks CLI;
      scan `git --all --reflog` history and any unreachable objects separately.
- [ ] Review credentials/session keywords, private hosts/IPs, absolute paths,
      screenshots, binary strings and all extracted installer contents. A real
      historical secret requires revocation/rotation and history remediation.
- [ ] Verify GitHub secret scanning and push protection in repository Security
      settings; do not assume local configuration enables these server settings.
- [ ] Review actual CodeQL JS/TS, Rust and Actions results for the public GPLv3
      repository. Do not assume paid private-repository access.
- [ ] Confirm Dependabot runs and review updates; no automatic merging.
- [ ] Recheck Tauri grants and local command origins. Test hostile remote IPC,
      cross-origin redirects/popups and camera/microphone/notification prompts.
- [ ] Review privacy with a controlled test server and recorded network traffic,
      including WebView/OS requests. Never publish real NAS/session capture data.
- [ ] Verify NSIS name, icon, publisher, version, license and per-user location.
- [ ] Fresh-install on a clean Windows VM, with and without WebView2 installed.
- [ ] Upgrade a prior supported version; test running-app handling and preference
      retention. Test reinstall/downgrade behavior and document supported paths.
- [ ] Uninstall: shortcuts/autostart/registration removed; test both retaining
      and deleting app data, without touching unrelated files.
- [ ] Inspect contents: no dev fixture, profiles, private references, proprietary
      Synology bundles or build-machine paths. Review third-party license notices
      and platform library redistribution obligations beyond SBOM metadata.
- [ ] Check Authenticode of app and installer with `Get-AuthenticodeSignature`;
      label unsigned output accurately. Never recommend disabling SmartScreen.
- [ ] Generate SBOMs with `cargo install cargo-cyclonedx --version 0.5.9 --locked`
      then `npm run sbom -- release-artifacts`; validate CycloneDX schemas and
      confirm target/dependency inventory matches the final build.
- [ ] Place only final distribution files in `release-artifacts`, including NSIS,
      MSI if produced, Linux/macOS packages and SBOMs. Finish all signing first.
- [ ] Run `npm run checksums -- release-artifacts`; independently verify hashes.
- [ ] Scan final EXE and NSIS using active, updated Defender. Record file, SHA-256,
      engine/signature versions, command, exit/result and findings. Disabled or
      unavailable protection is NOT TESTED, never PASS.
- [ ] Review and explicitly enable future GitHub artifact attestations only for
      an authorized public build. Verify downloaded artifacts with
      `gh attestation verify <artifact> -R Swiph3l/synology-chatplus-desktop`.
- [ ] Separately authorize publication; attach unchanged artifacts, checksums,
      both SBOMs, notes and provenance. Do not publish raw private audit logs.

## Optional future VirusTotal check

Only after selecting the final public RC, passing private-data review and deciding
that its binary is intended for public distribution: obtain explicit upload
authorization, manually submit the final file at VirusTotal, and record the
SHA-256, scan time and results URL. Treat submissions as disclosure to a third
party. Investigate detections; zero detections is not a safety guarantee. Never
upload current private/development builds automatically or store an API key in Git.

## Local evidence commands

```powershell
Get-FileHash '<final artifact>' -Algorithm SHA256
Get-AuthenticodeSignature '<final artifact>'
# Use the installed Defender platform's MpCmdRun.exe with an active engine:
& '<MpCmdRun.exe>' -Scan -ScanType 3 -File '<final artifact>' -DisableRemediation -ReturnHR
```

Keep local logs outside the repository. Replacing or signing any artifact
invalidates earlier hashes and scan evidence: regenerate them.
