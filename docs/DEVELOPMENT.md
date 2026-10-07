# Development

ChatPlus Desktop uses Tauri 2, Rust and vanilla TypeScript. Synology ChatPlus is
its primary provider; supported notification integration also covers Synology Chat
and Discord. Keep changes focused and preserve existing working architecture.

## Local setup

Use Windows x64 with Microsoft C++ Build Tools (Desktop development with C++ and a
Windows SDK), the Rust MSVC toolchain and Microsoft Edge WebView2 Runtime. The NSIS
installer can bootstrap WebView2; developers still need an installed runtime.
See [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

CI uses Node.js 22; use Node 22.12 or newer on that line, or a compatible supported
Node 24 installation. Vite 7 requires Node 20.19+ or 22.12+. Install Rust stable
through rustup; the current locked test graph includes rcgen requiring Rust 1.88.
The 2026-10-07 validation toolchain is Rust 1.98.1. A newer native Tauri migration
must explicitly review its MSRV and Windows binding requirements.

From the repository root:

```sh
npm ci
npm run tauri dev
```

Use `npm.cmd` in PowerShell if script execution policy blocks `npm.ps1`.
`tauri dev` builds the provider/theme bootstrap and starts Vite on loopback.
Never commit test accounts, private server URLs, tokens or local profile contents.

## Commands

| Command                                                  | Purpose                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| npm run dev                                              | Frontend Vite server only                                                |
| npm run tauri dev                                        | Native development app with frontend server                              |
| npm run format:check / npm run format                    | Check/apply Prettier formatting                                          |
| npm run typecheck                                        | TypeScript checking without output                                       |
| npm test                                                 | Node test runner, provider DOM fixtures and shell/release regressions    |
| npm run build                                            | Typecheck, production Vite assets and generated provider/theme bootstrap |
| npm run check:release                                    | Check that debug fixture markers stay out of production assets           |
| cargo test --locked --manifest-path src-tauri/Cargo.toml | Rust debug tests                                                         |
| npm run tauri -- build --debug --no-bundle               | Runnable development binary with production frontend; no installer       |
| npm run tauri build                                      | Local package, without updater signing secrets                           |

Full validation commands and the difference between automatic and native checks are
in [TESTING.md](TESTING.md). Normal builds preserve runtime updater public-key
configuration while forcing updater artifacts off. Signed release packaging is a
separate maintainer operation, described in [UPDATER.md](UPDATER.md).

## Project structure

| Path                           | Responsibility                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| src/app                        | Typed settings, service, notification and updater IPC contracts                     |
| src/settings, src/ui, src/i18n | Local Settings, service rail/footer, About, updates and translations                |
| src/theme/providers            | Independent ChatPlus, Synology Chat and Discord DOM adapters                        |
| src/theme/provider-unread.ts   | Shared renderer observation/read lifecycle                                          |
| src-tauri/src                  | Native service sessions, authoritative unread, notifications, downloads and updater |
| src-tauri/capabilities         | Local-view permissions; remote provider views have no capability grants             |
| scripts                        | Bootstrap generation, build/signing separation, release metadata and audit helpers  |
| tests                          | Node/frontend/provider fixtures                                                     |
| docs                           | Current technical guides plus dated investigations and acceptance evidence          |

The child WebViews keep persistent per-service profiles and are created lazily.
Changing a service provider or URL recreates its view: finish drafts/calls before
testing that transition. See [ARCHITECTURE.md](ARCHITECTURE.md) and
[PROVIDERS.md](PROVIDERS.md) before adding an integration.

## Contribution workflow

Read recent Git history and the relevant subsystem before editing. Match concise
commit subjects such as `fix: ...`, `chore: ...` and `docs: ...`, and use small
logical commits with actual development timestamps. Reproduce bugs, add regression
coverage, and test each meaningful subsystem change. Preserve useful maintainer
comments. New non-obvious constraints use `// Swiph3l: <why>` or
`# Swiph3l: <why>`; explain why the guard is necessary.

Keep remote views outside native IPC permissions. Use common semantic adapter
operations with provider-specific selectors, and avoid private APIs or generic
message-text scraping. Notification diagnostics must omit message content,
credentials, tokens, tags and private URLs.

Before review, run `git diff --check`, inspect staged/untracked files and record
actual validation and remaining Windows tests. Do not tag, push, publish or alter
repository settings during routine development. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Documentation map

- [Architecture](ARCHITECTURE.md), [notifications](NOTIFICATIONS.md), [providers](PROVIDERS.md).
- [Updater](UPDATER.md), [testing](TESTING.md), [Windows acceptance](WINDOWS_ACCEPTANCE.md).
- [Dependency policy and current audit](DEPENDENCY_POLICY.md), [release checklist](RELEASE_CHECKLIST.md).
- Dated evidence: [development status](DEVELOPMENT_STATUS.md),
  [maintainer follow-up](MAINTAINER_FOLLOWUP.md), [beta.4 reliability](BETA4_RELIABILITY.md)
  and [minimized notification investigation](MINIMIZED_NOTIFICATION_REVIEW.md).
- Current pass: [2026-10-07 reliability report](RELIABILITY_2026-10-07.md).

Dated reports preserve the behavior and limitations of their original revision;
current subsystem guides describe the latest source.
