# Signed updates

The official Tauri updater 2.11.0 runs behind local Rust commands. Remote ChatPlus
has no updater capability. The service owns metadata, progress, cancellation and
signature-verified bytes. Installation requires explicit restart confirmation.

## Configuration

project.json defines owner/repository, updaterEnabled and the public verification
key. Updates default to disabled until a production public key is configured.
Unconfigured checks show a local message without requesting GitHub. Private signing keys must remain outside the repository.

The base Tauri configuration enables createUpdaterArtifacts, passive Windows
installation and downgrade prevention. The build wrapper explicitly disables
artifact signing for unsigned development builds. An enabled updater build without
TAURI_SIGNING_PRIVATE_KEY fails instead of silently producing unsigned artifacts.

Before the first release, generate and securely back up a Tauri signing key, commit
only the public key, enable updates and supply private key/password through protected
CI secrets. Never put private keys in source, logs or artifacts. Follow the
[official Tauri instructions](https://v2.tauri.app/plugin/updater/). Updater signatures
do not provide Authenticode, Apple notarization or remove SmartScreen warnings.

## Channels and delivery

Stable uses https://github.com/{owner}/{repository}/releases/latest/download/latest.json.
Pre-release lists up to 100 published releases through GitHub's public API, chooses
the highest eligible SemVer with a latest.json asset and includes stable versions.
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

Both jobs in .github/workflows/release.yml are deliberately disabled. After review
and activation, version tags build and sign platform packages, run checks, collect
SBOMs, generate metadata/checksums, attest artifacts and create a draft release.
Publication is a separate maintainer action.

Before enabling, resolve audit findings, verify runner architectures and protected
secrets, exercise platform packages and provide complete corresponding GPL source.
For a compromised key, stop publication and distribute a trusted recovery installer
with a replacement public key; never bypass verification. Keep installers and source
available for manual recovery.

## Local verification

Rust tests exercise the actual official updater with an ephemeral signing key and
localhost HTTPS using an explicitly trusted ephemeral certificate. They cover valid
and invalid signatures, malformed metadata, no update, channels, offline failure and
cancellation. Non-executable payloads never reach installation. A first real signed
update and restart still require a separate installation test.
