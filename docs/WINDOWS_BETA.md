# Windows public beta preparation

Target: `v0.5.0-beta.2`, Windows x64 NSIS. Public Beta is the intended release
status, not a claim that this working tree has been published. Linux and macOS are
**Experimental**, are excluded from this release and do not block its Windows gate.
ChatPlus Desktop is unofficial, independent from Synology Inc., and GPL-3.0-only.
Windows: **Unsigned / SmartScreen warning possible**. Updater signatures do not
provide Authenticode. Never disable SmartScreen as a workaround.

## Owner: production signing setup

No production key is supplied in this repository. Keep one long-term key across
beta.1, beta.2 and later releases. Generate it yourself, once, outside the repository
using the installed Tauri CLI (PowerShell, run from the repository root):

```powershell
$keyDirectory = Join-Path $env:LOCALAPPDATA 'ChatPlusDesktopSigning'
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
$keyFile = Join-Path $keyDirectory 'updater.key'
if (Test-Path -LiteralPath $keyFile) { throw 'Existing key: do not overwrite it.' }
npm run tauri -- signer generate --write-keys "$keyFile"
```

Use the interactive password prompt. Do not paste the password or private key into
chat, source, logs or release assets. Store an encrypted offline backup securely.
The CLI also writes `updater.key.pub`. Copy only its public text into
`project.json.updaterPublicKey` and set `updaterEnabled` to `true`. Rust embeds this
configuration in the application and supplies the key to the official Tauri
updater builder. The empty static Tauri plugin key is replaced by that builder.

Create these repository GitHub Actions Secrets via GitHub Settings:

- `TAURI_SIGNING_PRIVATE_KEY`: contents of `updater.key`, not its filesystem path.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key's password.

The generation backup remains outside Git; CI receives the private key only through
Secrets. The release preflight rejects a disabled updater, missing/malformed public
key or missing private key. Never use fixture keys for production. Confirm that
the public key matches the signing key by the signed download test below.

Automatic checks remain opt-in, after ten seconds with a configured server, at most
once per six hours. Select **Pre-release** in Settings; the default channel remains
Stable. Manual checking is available in Settings/menu. No preference defaults or
branding are changed by this release preparation.

## Owner: review, commit and tag later

1. Review the working-tree diff, set the production public key, and run validation.
2. Commit and push the reviewed changes to main yourself. Wait for Windows CI,
   CodeQL and Dependency and secret audits to pass on that exact commit.
3. Review Dependabot/security findings. An agent's inability to read Security API
   is not itself a release blocker. Windows dependency policy applies; Linux-only
   issues and lack of Authenticode are not Windows beta blockers.
4. After explicit release approval, create and push `v0.5.0-beta.2` yourself.
   Version validation must match package.json, package-lock.json root entries,
   Cargo.toml, Cargo.lock and tauri.conf.json exactly.
5. The tag workflow requires the matching main checks, signs and builds Windows,
   then creates a **draft prerelease**. No workflow publishes it automatically.
6. Download the draft assets, verify them and smoke-test. Publish manually only
   after the owner accepts the results. Draft assets are not public updater feeds.

The workflow requires no Linux/macOS success. Public-repository attestation is
mandatory when its step runs: any failure stops the draft job. Private repositories
skip it because entitlement is not assumed. Actions must allow contents write,
id-token write and attestations write for the draft job.

## Exact beta assets

The NSIS EXE is also the Tauri v2 Windows updater payload; no second updater archive
is required. The collector gives it a deterministic distribution name:

- `windows-x86_64--ChatPlus-Desktop_0.5.0-beta.2_x64.exe` (standalone application)
- `windows-x86_64--ChatPlus-Desktop_0.5.0-beta.2_x64-setup.exe`
- `windows-x86_64--ChatPlus-Desktop_0.5.0-beta.2_x64-setup.exe.sig`
- `windows-x86_64--target.json`
- `windows-x86_64--npm.cdx.json`
- `windows-x86_64--rust.cdx.json`
- `windows-x86_64--SBOM-NOTES.txt`
- `latest-prerelease.json`
- `SHA256SUMS.txt`

GitHub stores the attestation separately; it is not an extra release asset. All nine
files above are uploaded to the draft. GitHub also offers automatic source archives.
The intermediate Actions artifact is `signed-windows-x86_64`. Its ZIP digest is not
the installer hash. SHA256SUMS is generated after signing/collection from actual
final file bytes, including the EXE, sidecar, manifests and SBOMs.

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\windows-x86_64--ChatPlus-Desktop_0.5.0-beta.2_x64-setup.exe'
Get-AuthenticodeSignature -LiteralPath '.\windows-x86_64--ChatPlus-Desktop_0.5.0-beta.2_x64-setup.exe'
gh attestation verify '.\windows-x86_64--ChatPlus-Desktop_0.5.0-beta.2_x64-setup.exe' -R Swiph3l/synology-chatplus-desktop
```

Compare the EXE hash to its own SHA256SUMS entry. Inspect extracted NSIS contents,
license/NOTICE, architecture, version, and absence of private URLs, credentials,
profiles, debug fixtures and build-machine paths. Record antivirus and signature
results; unavailable checks are NOT TESTED. Do not alter an attested file.

## Windows smoke test record

Record Windows/WebView2 versions, commit, EXE SHA256, date and PASS/FAIL per item.
Use a clean VM and a controlled private server; never publish credentials or captures.

- [ ] Clean install, with WebView2 present and with bootstrap installation needed.
- [ ] Launch application and confirm expected version, name and license notice.
- [ ] Log in to Synology ChatPlus and confirm expected session behavior.
- [ ] Tray icon, menu and restore actions.
- [ ] Close/open window, including close-to-tray setting.
- [ ] Autostart enabled and disabled.
- [ ] Light, Dark and System appearance.
- [ ] Window position and size retained after restart.
- [ ] Windows notifications with a second test user, respecting opt-in/privacy.
- [ ] System restart, login and expected autostart/session behavior.
- [ ] Uninstall; confirm shortcuts/autostart removal and data retention choices.
- [ ] Reinstall and verify the chosen retained/reset preferences.

Camera, microphone and Synology Meet remain unconfirmed until runtime validated.

## Signed beta.1 to beta.2 test

1. Install the final production-key beta.1 EXE. Select Pre-release and check manually.
2. Prepare beta.2 with the same public/private key, synchronized `0.5.0-beta.2`
   versions and passing checks. Build its draft through the reviewed tag workflow.
3. Inspect beta.2 EXE/signature/checksums/SBOM/attestation. Its manifest must be
   `latest-prerelease.json`, version `0.5.0-beta.2`, target `windows-x86_64`, and
   point to that tag's exact EXE with its actual Tauri signature.
4. After separate owner approval, manually publish the beta.2 prerelease. Public
   endpoint discovery intentionally ignores drafts; a draft-only test cannot prove
   public feed delivery.
5. From beta.1, verify manual discovery, download and signature acceptance. Confirm
   installation/restart explicitly; verify version `0.5.0-beta.2`, settings and login.
6. Independently test opt-in startup checking when its six-hour interval permits.
   Stable must not discover beta.2. Rechecking beta.2 must not offer a downgrade.
7. Record results. Unit/HTTPS fixture tests verify signed bytes without installation;
   they do not prove production install/restart. Do not claim a production-working
   updater before this test passes.

A future stable `0.5.0` tag writes only `latest.json`; prereleases write only
`latest-prerelease.json`. Each channel reads only its own manifest. To leave the
beta feed for stable, the user selects Stable.
