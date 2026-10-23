# Release checklist

Version tags trigger the Windows x64 signed draft-release pipeline. Publishing
the draft is a separate maintainer action. Linux and macOS are experimental and
need their own target validation before distribution.

Keep the candidate commit, tool versions, test results and final artifact hashes
with the release record. An unchecked or unavailable check is not a pass.

## Source and validation

- [ ] Review the source revision and confirm it contains no private files,
      account profiles, machine paths or development fixtures.
- [ ] Synchronize versions in npm, Cargo and Tauri manifests/lockfiles with the
      intended tag, and write user-facing release notes.
- [ ] Run the [automated gates](TESTING.md), dependency/secret audits and
      [target-specific dependency policy](DEPENDENCY_POLICY.md).
- [ ] Require Windows CI, CodeQL and security checks on the exact tagged main
      commit. Review failures and advisories rather than suppressing them.
- [ ] Complete [Windows acceptance](WINDOWS_ACCEPTANCE.md) for the candidate,
      including isolated profiles, background startup, notifications, read
      actions, links, downloads, themes and DPI.
- [ ] Review remote-view capabilities, local command origin checks and provider
      navigation/permission boundaries.

## Packaging and signing

- [ ] Provision production signing as described in
      [UPDATER_SIGNING.md](UPDATER_SIGNING.md). Keep private credentials outside
      source and limited to the release build step.
- [ ] Build the signed NSIS setup using the tag workflow. Keep package version,
      tag, source commit, manifest URL and signature aligned.
- [ ] Verify the collected package with the production signature fixture.
- [ ] Inspect installer name, publisher, icon, license, architecture and contents.
      Exclude local profiles, private URLs, build logs and debug fixtures.
- [ ] Generate npm/Rust SBOMs and retain required third-party notices and
      corresponding source. See [LICENSING.md](LICENSING.md).
- [ ] Finalize distribution filenames and signing before generating checksums.
      Verify downloaded bytes against `SHA256SUMS.txt` and artifact attestations.
- [ ] Check app/installer Authenticode and scan the final files with an active,
      updated antivirus engine. Record actual results; updater signing does not
      imply Authenticode or remove SmartScreen warnings.

Useful verification commands, with the final artifact substituted:

```powershell
Get-FileHash -LiteralPath '<artifact>' -Algorithm SHA256
Get-AuthenticodeSignature -LiteralPath '<artifact>'
gh attestation verify '<artifact>' -R Swiph3l/synology-chatplus-desktop
```

Changing or signing a file invalidates its earlier hashes and scan results.
Keep raw local evidence outside the checkout. Any third-party binary scan upload
must use an artifact intended for public distribution.

## Installation and updates

- [ ] Fresh-install on clean Windows with WebView2 present and absent.
- [ ] Upgrade from a supported prior production-key version. Verify the installed
      version, settings, isolated provider sessions and normal restart behavior.
- [ ] Exercise stable/beta eligibility with **Include beta updates** off and on;
      confirm drafts and downgrades are excluded.
- [ ] Test network failure, cancellation, signature rejection and confirmation
      before installation.
- [ ] Verify single-instance handling, close-to-tray and autostart after login.
- [ ] Test uninstall/reinstall, shortcut and autostart cleanup, and data-retention
      choices without modifying unrelated files.

## Publication

- [ ] Review the generated draft assets, channel manifest, signatures, checksums,
      SBOMs, attestation and release notes. The updater targets the NSIS setup,
      not the standalone application.
- [ ] Capture current, sanitized [screenshots](screenshots/README.md) if needed.
- [ ] Approve publication and publish the unchanged reviewed artifacts. Confirm
      public release discovery and retain source and recovery downloads.
