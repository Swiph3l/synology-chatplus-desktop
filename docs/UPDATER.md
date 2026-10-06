# Updater and release architecture

Rust owns checks, channel eligibility, metadata, progress/cancellation and verified
bytes. The local update panel reads snapshots and requests actions; remote provider
views have no updater permissions. The official Tauri updater verifies signatures
before bytes can become installable, and installation requires user confirmation.

## Startup and six-hour checks

Automatic checks are opt-in. The first check is scheduled ten seconds after startup;
subsequent attempts run at most every six hours, using monotonic elapsed time. Failed
attempts also advance the schedule to avoid retry storms. Persisted successful-check
time is history, not a gate that prevents a new process's startup check. About uses
cached state without requesting GitHub. Manual checks show errors and allow retry;
automatic errors stay quiet. Busy checking/downloading/ready/installing operations
share a locked gate.

## Stable and Pre-release channels

Stable accepts production releases only, via GitHub's latest-release `latest.json`.
Pre-release examines at most 100 published releases, chooses the highest eligible
SemVer and accepts both beta/RC and newer stable versions. The saved channel never
changes automatically. Drafts and missing eligible metadata are skipped.

Stable tags produce `latest.json`; prerelease tags produce
`latest-prerelease.json`. The selected release version determines the manifest,
while the saved channel controls eligibility. Versions must be strictly newer by
SemVer precedence; build metadata alone cannot make an upgrade. A channel change
invalidates in-flight results and previously verified downloads, even if changed
away and back while requests are pending.

## Signature and transport policy

`project.json` supplies owner/repository, runtime availability and the public key.
Use the complete base64-wrapped Tauri public-key file; the runtime and CLI decode
that format internally. Initial download URLs must match the configured GitHub
release path; redirects remain HTTPS. Downloads have a 512 MiB cap and show actual
progress. Cancellation/stale-result guards keep rejected bytes out of ready/install.
Never bypass TLS, signature verification or version/channel rechecks.

The private signing key and password belong outside source and reach only the
explicit signed release build. Updater signatures are separate from Windows
Authenticode; unsigned installers may still trigger SmartScreen. A compromised key
requires trusted recovery distribution, not verification bypass.

## Normal builds, version tags and draft releases

Normal `npm run tauri build` removes signing credentials and forces updater artifacts
off while retaining the public runtime updater configuration. It needs no private
key. Only `CHATPLUS_RELEASE_BUILD=1` selects signed packaging, validates signing
configuration and generates updater packages/signatures.

The Windows-only release workflow runs for `v*` tags. It validates synchronized
source versions, Windows x64 host, production signing configuration and required CI,
CodeQL/security checks on the tagged main commit. It builds NSIS, collects actual
artifacts/signatures, creates SBOMs/channel metadata/checksums and public attestations,
then creates a **draft**. Publishing that draft is a separate maintainer action.
Branch development must stay lightweight and never creates release artifacts.
Do not create a tag or publish as part of a reliability pass.

## Artifact names

Published names are URL-safe before upload because GitHub rewrites spaces. Windows
artifacts are `windows-x86_64--ChatPlus-Desktop_<version>_x64.exe` and
`windows-x86_64--ChatPlus-Desktop_<version>_x64-setup.exe`, with the installer's
`.sig`. The updater targets the signed NSIS setup, never the standalone application.
Collection rejects absent/empty or ambiguous package inputs; metadata uses actual
bytes/signatures and checksums are generated after final names are established.
Linux/macOS remain experimental and are outside the current Windows release gate.

## More detail and acceptance

[UPDATER_SIGNING.md](UPDATER_SIGNING.md) retains key-format/signing details,
[WINDOWS_BETA.md](WINDOWS_BETA.md) retains owner setup and historical upgrade steps,
and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) contains the release checklist.
Rust tests use an ephemeral key and locally trusted HTTPS certificate with
non-executable payloads. Production signed install/restart remains a separate
[Windows acceptance](WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07) gate.
