# Updater and release architecture

Rust owns checks, release eligibility, metadata, progress/cancellation and verified
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

## Include beta updates

Settings exposes one preference, **Include beta updates**, which defaults to off.
When off, only published stable GitHub Releases are eligible: both prerelease tags
and releases marked prerelease are excluded. When on, published stable releases
and alpha/beta/RC releases are eligible together. Drafts and unpublished releases
are always excluded. Tags without a published GitHub Release, the changelog and
source package versions are never remote update candidates.

One shared release-selection function chooses the highest compatible version by
normal SemVer precedence, strictly greater than the installed version. Publication
date and GitHub list order do not override version precedence. Thus, with beta
updates enabled, `0.6.0-beta.1` wins over `0.5.1`; `0.5.0` wins over
`0.5.0-beta.6`; and `beta.10` follows `beta.6`. With beta updates off, an installed
`0.5.0-beta.5` never downgrades to stable `0.4.9`, but can upgrade to stable `0.5.0`.
Build metadata alone cannot make an upgrade. Startup, scheduled and manual checks
all use this same selection path.

Pagination is bounded to ten pages of 100 releases; an incomplete query reports an
error instead of declaring the installation current. The saved preference never
changes automatically. The new `includeBetaUpdates` boolean takes precedence over
legacy settings; old `updateChannel: stable` migrates to false and old beta or
pre-release values migrate to true. Missing preferences default to false. Migration
preserves other settings and the last-check timestamp.
No newer eligible release is a successful check, including repositories without a
stable release. A newer eligible release with a missing manifest or package is an
error, rather than a reason to silently select an older release.

Stable tags produce `latest.json`; prerelease tags produce
`latest-prerelease.json`. The selected release version determines the manifest,
while the saved beta preference controls eligibility. A preference change
invalidates in-flight results and previously verified downloads, even if changed
away and back while requests are pending.
The selected tag, full manifest version (including build metadata), published
Windows x64 setup URL and signature asset must agree before an update is offered.
Installation consent is bound to the exact version and beta preference under the updater
lock. Settings blocks restart while its local draft has unsaved changes.
The compact status-bar button uses only a successfully resolved allowed target;
turning beta updates off immediately invalidates a cached beta target. Changing an
unsaved checkbox does not affect checks until Settings is saved.

## Signature and transport policy

`project.json` supplies owner/repository, runtime availability and the public key.
Use the complete base64-wrapped Tauri public-key file; the runtime and CLI decode
that format internally. Initial download URLs must match the configured GitHub
release path; redirects remain HTTPS. Downloads have a 512 MiB cap and show actual
progress. Cancellation/stale-result guards keep rejected bytes out of ready/install.
The installer transfer has an explicit timeout as well as the metadata requests.
Cancellation is rechecked after signature verification, before bytes become ready.
Never bypass TLS, signature verification or version/preference rechecks.

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
Both jobs pin their checkout to the workflow event commit and validate the peeled
tag against it. Collected target metadata carries version/source-commit provenance,
which the manifest job checks before generating updater metadata. The release job
also schedules the existing production signature verifier against the collected
setup before uploading it; this audit has not run that verifier or any workflow.
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
