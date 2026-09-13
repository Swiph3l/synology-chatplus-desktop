# ChatPlus Desktop

> Unofficial lightweight desktop client for Synology ChatPlus.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue.svg)](https://www.microsoft.com/windows)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%202-orange.svg)](https://tauri.app)

> ⚠️ **Unofficial project.** ChatPlus Desktop is an independent community project. It is **not** affiliated with, endorsed by, or supported by **Synology Inc.** in any way. Synology and ChatPlus are trademarks of Synology Inc.

---

## What is ChatPlus Desktop?

ChatPlus Desktop is a lightweight, open-source Windows desktop wrapper for **Synology ChatPlus** — the chat application built into Synology NAS devices. It uses the **official Synology ChatPlus web interface** rendered inside a native window powered by **Tauri** and **Microsoft WebView2**.

- **No separate messaging backend.** All communication happens directly between the application and your own Synology NAS. No data is routed through any third-party server.
- **Your credentials never leave your device** (beyond what the Synology ChatPlus web app itself sends to your NAS).

---

## Why?

Synology ChatPlus does not have an official Windows desktop application. This project provides a native desktop experience with features like system tray, notifications, auto-start, and theming — without requiring you to keep a browser tab open.

---

## Planned Features

| Feature | Status |
|---|---|
| Configurable ChatPlus server URL | 🔜 Planned |
| Light / Dark / System theme | 🔜 Planned |
| System tray icon | 🔜 Planned |
| Minimize to tray | 🔜 Planned |
| Windows auto-start on login | 🔜 Planned |
| Native Windows notifications | 🔜 Planned |
| Unread message badge | 🔜 Planned |
| Automatic reconnect | 🔜 Planned |
| Remember window size and position | 🔜 Planned |
| File upload / download | 🔜 Planned |
| External link handling | 🔜 Planned |
| Microphone / camera support (Synology Meet) | 🔜 Planned |
| Automatic updates | 🔜 Planned |
| Multi-server support | 🔜 Future |

---

## Architecture

```
ChatPlus Desktop
      |
      v
    Tauri
      |
      v
   WebView2
      |
      v
Synology ChatPlus
      |
      v
User's Synology NAS
```

The application is a thin native shell. WebView2 loads the Synology ChatPlus web interface. Tauri provides the native integration layer (tray, notifications, window management). All messages go directly to your NAS — there is no relay or intermediary server.

---

## Why Tauri?

| | Tauri | Electron |
|---|---|---|
| Memory usage | ✅ Low | ❌ High |
| Application size | ✅ Small (~5 MB) | ❌ Large (~150 MB+) |
| Bundled browser engine | ✅ No (uses system WebView2) | ❌ Yes (Chromium) |
| Backend language | ✅ Rust | ❌ Node.js |
| Native Windows integration | ✅ Yes | ⚠️ Limited |

---

## Theming

ChatPlus Desktop supports **Light**, **Dark**, and **System** themes. The application injects a theme CSS stylesheet into the WebView before the page is revealed, preventing white flashes on startup.

Synology ChatPlus uses **EOS CSS variables** for its design system. ChatPlus Desktop overrides these variables to apply themes:

| Variable | Usage |
|---|---|
| `--eos-bg-surface-z0` | Background layer 0 |
| `--eos-bg-surface-z1` | Background layer 1 |
| `--eos-bg-surface-z2` | Background layer 2 |
| `--eos-bg-surface-z3` | Background layer 3 |
| `--eos-bg-surface-primary` | Primary surface background |
| `--eos-bg-surface-secondary` | Secondary surface background |
| `--eos-bg-surface-tertiary` | Tertiary surface background |
| `--eos-fg-primary` | Primary foreground / text |
| `--eos-fg-secondary` | Secondary foreground / text |
| `--eos-fg-tertiary` | Tertiary foreground / text |
| `--eos-border-secondary` | Secondary border |
| `--eos-border-tertiary` | Tertiary border |

Theme stylesheets are located in [`src/theme/`](src/theme/).

---

## Requirements

- Windows 10 or Windows 11
- [Microsoft WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (usually pre-installed on Windows 11)
- A Synology NAS with ChatPlus enabled and accessible over your network (local or via DDNS/QuickConnect)

---

## Getting Started

> 🚧 This project is under construction. No releases are available yet.

Once available, download the latest installer from the [Releases](../../releases) page.

---

## Building from Source

> Prerequisites: [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/), [Tauri CLI](https://tauri.app/start/prerequisites/)

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## Security

Please review [SECURITY.md](SECURITY.md) for responsible disclosure guidelines and security considerations specific to this project.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a history of changes.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Disclaimer

ChatPlus Desktop is an **unofficial, independent community project**. It is not affiliated with, sponsored by, or supported by Synology Inc. The Synology and ChatPlus names and logos are trademarks of Synology Inc. Use of these names is for identification purposes only.
