# Signed updates

The official Tauri updater 2.11.0 runs behind local Rust commands. Remote ChatPlus
has no updater capability. The service owns metadata, progress, cancellation and
signature-verified bytes. Installation requires explicit restart confirmation.

## Configuration

project.json defines owner/repository, updaterEnabled and the public verification
key. The runtime updater is enabled with the configured production public key.
Unconfigured checks show a local message without requesting GitHub. Private signing keys must remain outside the repository.

The base Tauri configuration disables createUpdaterArtifacts and retains passive
Windows installation and downgrade prevention. `updaterEnabled` controls runtime
availability only; it does not require a private key to compile or package the app.
Normal local and push/PR CI builds force createUpdaterArtifacts to false and remove
signing credentials from the CLI environment. They still embed the runtime public
key and can receive signed updates. Windows NSIS, Linux DEB and macOS app test
packages are built without updater signatures; CI archives the macOS app separately.

Only `CHATPLUS_RELEASE_BUILD=1` selects signed release packaging through
`npm run tauri build`. This mode validates the enabled runtime, public key and
nonempty TAURI_SIGNING_PRIVATE_KEY before starting Tauri, then forces
createUpdaterArtifacts to true. Tauri validates the private key/password and
generates updater packages and `.sig` files. The tag-only release workflow sets
the mode and passes TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD
to its signing step. Ordinary CI never receives these secrets. For an authorized
local release build, set the same mode in an environment already provisioned with
signing credentials; do not use a normal build as a release artifact.

Before the first release, generate and securely back up a Tauri signing key, commit
only the public key, enable updates and supply private key/password through protected
CI secrets. Never put private keys in source, logs or artifacts. Follow the
[official Tauri instructions](https://v2.tauri.app/plugin/updater/). Updater signatures
do not provide Authenticode, Apple notarization or remove SmartScreen warnings.

## Channels and delivery

Stable uses https://github.com/{owner}/{repository}/releases/latest/download/latest.json.
Pre-release lists up to 100 published releases through GitHub's public API, chooses
the highest eligible SemVer with a latest-prerelease.json asset. It never reads
latest.json; stable releases normally supply only the Stable manifest.
Drafts and missing manifests are skipped. Review this bounded policy if retaining
more than 100 recent releases. No token or HTML scraping is used.

Only strictly newer SemVer precedence is accepted; build metadata alone is not an
upgrade. Stable excludes prereleases. Initial download URLs must belong to the
configured GitHub release path. Redirects remain HTTPS; signatures are mandatory.
A channel change during checking discards the result. Download and installation
recheck eligibility. Release notes are plain text.

Automatic checks are opt-in, begin after ten seconds and occur at most once per six
hours. Successful check times persist; failed automatic attempts are rate-limited
in memory. Automatic errors stay quiet; manual checks expose errors and retries.
About reads cached local state without requesting GitHub.

Downloads show actual progress, allow cancellation and are capped at 512 MiB.
Only bytes accepted by the official verifier reach installation. Windows launches
its passive installer after confirmation. Production installation is not yet tested.

## Future release workflow

collect-release.mjs collects actual packages and generated .sig files.
updater-metadata.mjs generates metadata only for supplied targets and rejects absent,
empty or malformed inputs. Cryptographic verification occurs in the updater.
release-metadata.mjs combines the collected platform manifests.

The Windows-only .github/workflows/release.yml accepts version tags, validates
all source versions and production signing configuration, and requires Windows CI,
CodeQL and security checks on the same main commit. It builds NSIS and its updater
signature, collects SBOMs, generates channel-specific metadata/checksums, attests
public-repository artifacts and creates a draft release. Beta tags write only
latest-prerelease.json; stable tags write only latest.json. Linux/macOS do not
participate in this release gate. Missing signing configuration fails closed.
Publication is a separate maintainer action.

Before enabling, resolve audit findings, verify runner architectures and protected
secrets, exercise platform packages and provide complete corresponding GPL source.
For a compromised key, stop publication and distribute a trusted recovery installer
with a replacement public key; never bypass verification. Keep installers and source
available for manual recovery.

See [Windows beta owner steps](WINDOWS_BETA.md) for the key-generation command,
GitHub Secrets, exact Windows assets and beta.1 to beta.2 smoke test.

## Local verification

Rust tests exercise the actual official updater with an ephemeral signing key and
localhost HTTPS using an explicitly trusted ephemeral certificate. They cover valid
and invalid signatures, malformed metadata, no update, channels, offline failure and
cancellation. Non-executable payloads never reach installation. A first real signed
update and restart still require a separate installation test.
