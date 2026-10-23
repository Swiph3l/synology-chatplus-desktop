# Development

ChatPlus Desktop uses Tauri 2, Rust and vanilla TypeScript. The native process owns
service sessions, unread state, Windows notifications and downloads. Local pages
provide Settings and the service rail; remote provider pages have separate
WebView profiles and no native IPC capabilities.

## Prerequisites

For Windows x64 development, install:

- Microsoft C++ Build Tools with Desktop development with C++ and a Windows SDK.
- A stable Rust MSVC toolchain, including rustfmt.
- Microsoft Edge WebView2 Runtime.
- A Node.js version allowed by `package.json`: Node 22.12 or later on the 22 line,
  or Node 24. CI exercises both supported major versions.

See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for native
platform setup. Load the C++ build environment when running Cargo directly.

## Run and build

From the repository root:

```sh
npm ci
npm run tauri -- dev
```

Use `npm.cmd` in PowerShell if execution policy blocks `npm.ps1`. The Tauri
development command builds the provider/theme bootstrap and starts Vite on
loopback. `npm run dev` starts only the frontend server.

To build a runnable debug app with embedded production frontend assets:

```sh
npm run tauri -- build --debug --no-bundle
```

`npm run build` checks TypeScript, builds Vite assets and generates both provider
bootstrap bundles. Run it before direct Cargo builds that embed those assets.
`npm run tauri -- build` creates a normal local package through the build wrapper;
updater signing and publication follow the separate [release checklist](RELEASE_CHECKLIST.md).
See [UPDATER.md](UPDATER.md) for build/signing boundaries.

## Source map

| Path                                           | Responsibility                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/app`                                      | Settings, service, notification, download and updater IPC contracts                   |
| `src/settings`, `src/ui`, `src/i18n`           | Local UI and seven locales                                                            |
| `src/theme/providers`                          | Independent provider DOM adapters and read capabilities                               |
| `src/theme/provider-unread.ts`                 | Renderer observations, trusted read evidence and arrival tokens                       |
| `src/theme/bootstrap.ts`, `src/theme/dark.css` | Opt-in ChatPlus appearance and persistent theme lifecycle                             |
| `src-tauri/src`                                | Native service lifecycle, authoritative unread, notifications, navigation and updater |
| `src-tauri/capabilities`                       | Permissions granted to local views                                                    |
| `scripts`                                      | Bootstrap generation, build validation and release helpers                            |
| `tests`                                        | Node tests and synthetic provider fixtures                                            |

The selected service opens first. Other enabled services start sequentially in
saved rail order; see [SERVICE_STARTUP.md](SERVICE_STARTUP.md). Changing a service
URL or provider recreates its view, so finish drafts and calls before testing
that transition.

## Profiles and isolated testing

Use a separate application identifier and fresh profile directories for tests
that should not affect an installed account. Never copy an authenticated profile
into a fixture. Alternate identifiers use separate autostart entry names; the
canonical production identifier retains its established Windows entry.

Check single-instance behavior when inspecting a build: another process with the
same identifier receives activation instead of opening a second application.
Debug Windows toasts use the existing PowerShell sender fallback, so they do not
establish production sender registration or its notification permission.

Keep credentials, private server URLs, session data and message contents out of
source, fixtures and diagnostics. Remote provider code must remain outside native
IPC permissions. Provider integrations use public UI/browser behavior and scoped
metadata rather than private APIs or message-history scraping.

## Validation and dependencies

Run the checks in [TESTING.md](TESTING.md) before review. Use provider-specific
fixtures for reproduced bugs and record native acceptance separately. Formatting
uses Prettier and rustfmt. Explain non-obvious concurrency, identity and privacy
constraints in maintainer comments.

`npm run check:dependencies` verifies Tauri API/native alignment, Windows/WebView2
interface versions and the Node typing baseline. Keep `@types/node` on the oldest
supported Node major; review `engines.node`, typings and CI together when changing
runtime support. See [DEPENDENCY_POLICY.md](DEPENDENCY_POLICY.md).

Further guides: [architecture](ARCHITECTURE.md), [providers](PROVIDERS.md),
[notifications](NOTIFICATIONS.md), [Windows acceptance](WINDOWS_ACCEPTANCE.md) and
[contributing](../CONTRIBUTING.md).
