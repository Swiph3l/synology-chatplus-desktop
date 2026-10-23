# Signing updates

The Tauri updater verifies packages against the public key embedded in the app.
Updater signatures are separate from Windows Authenticode. Selection, transport
and cancellation contracts are documented in [UPDATER.md](UPDATER.md).

## Public configuration

`project.json` defines `owner`, `repository`, `updaterEnabled` and `updaterPublicKey`.
Store the complete base64-wrapped contents of the Tauri `.pub` file in
`updaterPublicKey`. The CLI and runtime decode that format themselves; do not
substitute the decoded minisign lines or only the key's second line.

The runtime builder and [Tauri wrapper](../scripts/tauri.mjs) use the same public
key. The base Tauri configuration disables updater artifacts. Runtime update
availability does not require a private key to build the application.

## Initial key setup

Generate a production key once, outside the repository, and retain an encrypted
offline backup. Existing installations trust that key, so do not regenerate it
for each version. From the repository root in PowerShell:

```powershell
$signingDirectory = Join-Path $env:LOCALAPPDATA 'ChatPlusDesktopSigning'
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
$signingKey = Join-Path $signingDirectory 'updater.key'
if (Test-Path -LiteralPath $signingKey) { throw 'Signing key already exists.' }
npm run tauri -- signer generate --write-keys "$signingKey"
```

Use the interactive password prompt. Put only the generated public-key text in
`project.json` and enable the runtime updater. Provision these GitHub Actions
secrets for the release workflow:

| Secret                               | Value                                         |
| ------------------------------------ | --------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Private key contents, not its filesystem path |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password                                  |

Never commit private keys, passwords or fixture signing keys. Do not print them
in logs or include them in release assets. See the
[Tauri signing documentation](https://v2.tauri.app/plugin/updater/).

## Build modes

Normal `npm run tauri build` removes signing credentials from the CLI environment
and forces updater artifacts off. It retains the public verification key so the
result can receive signed updates.

The explicit `CHATPLUS_RELEASE_BUILD=1` mode validates the public configuration
and nonempty private-key environment, then enables updater artifacts. Tauri
validates the private key and password and creates package signatures. Supply
credentials only to this build step. The tag workflow sets this mode; branch CI
does not receive signing secrets.

## Verification and recovery

The release collector requires actual nonempty packages and `.sig` files. The
Windows manifest points to the raw signed NSIS setup, with matching version,
source commit and package identity. The release workflow runs
`production_artifact_signature_verifies` against the collected setup before upload.
See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

Unit tests use ephemeral keys and non-executable HTTPS payloads. They verify
signature handling but do not establish installed upgrade or restart behavior.
Test an actual production-key upgrade using the
[Windows acceptance checklist](WINDOWS_ACCEPTANCE.md).

If a signing key is compromised, stop publication and distribute a trusted
recovery installer with a replacement public key. Preserve manual recovery
downloads and corresponding source; never bypass signature verification.
