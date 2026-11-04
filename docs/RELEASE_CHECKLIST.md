# Release checklist

Version tags trigger the native matrix signed draft-release pipeline for Windows
x64, Linux x64 and macOS Apple Silicon/Intel. Every new draft is marked prerelease,
including plain tags such as `v1.0.0`. Publishing and stable promotion are separate
maintainer actions. New platforms need [native acceptance](PLATFORMS.md) before
distribution. The Linux glib source backport must pass its provenance, dependency,
strict audit and optimized regression checks before a complete release can proceed.

Keep the candidate commit, tool versions, test results and final artifact hashes
with the release record. An unchecked or unavailable check is not a pass.

## Source and validation

For 1.0.0, treat the platform matrix below as the support contract. Keep new
platforms explicitly marked candidate until their native checklist passes, retain
existing settings/session identities through upgrades, and publish only capabilities
actually exercised on the advertised systems. A version bump does not complete
these checks.

- [ ] Review the source revision and confirm it contains no private files,
      account profiles, machine paths or development fixtures.
- [ ] Synchronize versions in npm, Cargo and Tauri manifests/lockfiles with the
      intended tag, and write user-facing release notes.
- [ ] Run the [automated gates](TESTING.md), dependency/secret audits and
      [target-specific dependency policy](DEPENDENCY_POLICY.md).
- [ ] Verify the glib backport with `node scripts/check-glib-backport.mjs --metadata`
      and `node scripts/audit-linux.mjs`. On Linux, record the `glib_variant_iter`
      integration test in debug and release modes. Keep the original-registry
      advisory review with the release evidence.
- [ ] Require all four native CI jobs, CodeQL and security checks on the exact tagged main
      commit. Review failures and advisories rather than suppressing them.
- [ ] Complete [Windows acceptance](WINDOWS_ACCEPTANCE.md) for the candidate,
      including isolated profiles, background startup, notifications, read
      actions, links, downloads, themes and DPI.
- [ ] Complete macOS 14+ Apple Silicon/Intel and Linux acceptance in
      [platform support](PLATFORMS.md), including two-account isolation,
      notifications, Edit shortcuts, restart and signed upgrade behavior.
- [ ] Review remote-view capabilities, local command origin checks and provider
      navigation/permission boundaries.

## Packaging and signing

- [ ] Provision production signing as described in
      [UPDATER_SIGNING.md](UPDATER_SIGNING.md). Keep private credentials outside
      source and limited to the release build step.
- [ ] Pass strict dependency checks for every target. Verify the reviewed glib
      backport and its actual Cargo resolution; do not add advisory ignores.
- [ ] Build signed NSIS, AppImage and macOS update packages using the tag workflow. Keep package version,
      tag, source commit, manifest URL and signature aligned.
- [ ] Verify the collected package with the production signature fixture.
- [ ] Review all four provenance records and updater manifest targets; verify
      that `.dmg` and `.deb` manual downloads are not used as update payloads.
- [ ] Inspect installer name, publisher, icon, license, architecture and contents.
      Exclude local profiles, private URLs, build logs and debug fixtures.
- [ ] Generate npm/Rust SBOMs and retain required third-party notices and
      corresponding source. See [LICENSING.md](LICENSING.md).
- [ ] Retain the vendored glib MIT license, copyright notices and source/backport
      provenance with the corresponding source and distribution notices.
- [ ] Finalize distribution filenames and signing before generating checksums.
      Verify downloaded bytes against `SHA256SUMS.txt` and artifact attestations.
- [ ] Check app/installer Authenticode and scan the final files with an active,
      updated antivirus engine. Record actual results; updater signing does not
      imply Authenticode or remove SmartScreen warnings.
- [ ] Verify macOS Developer ID signing/notarization separately when configured;
      a Tauri update signature does not establish Apple trust. Confirm the
      actual Gatekeeper behavior of the distributed image.

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
- [ ] Fresh-install the `.dmg` on macOS 14+ for each architecture and the Linux
      `.deb`/AppImage on the supported WebKitGTK 4.1 distribution. Verify executable
      permission, FUSE requirements and package dependencies.
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
      native AppImage or macOS app archive appropriate to the platform.
- [ ] Capture current, sanitized [screenshots](screenshots/README.md) if needed.
- [ ] Approve initial publication as a prerelease with the unchanged reviewed
      artifacts. Confirm discovery with **Include beta updates** on, exclusion
      with it off, and retain source and recovery downloads.
- [ ] After acceptance, a plain SemVer release such as `v0.9.0` can be promoted
      by clearing its GitHub prerelease flag. Keep the same tag, signed files,
      checksums and `latest.json`; confirm stable users can discover it.

Promotion does not rebuild an artifact or make an equal version an update.
Testers already running `0.9.0` keep those accepted bytes. If a published
candidate needs code changes, prepare a higher version instead of replacing
its tag or files. A hyphenated version such as `0.9.0-beta.1` remains a SemVer
prerelease even if its GitHub flag is cleared; its stable successor needs its
own plain version and signed artifacts.
