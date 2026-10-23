# Screenshots

These images are visual references for the native Tauri/WebView2 interface.
They were captured on Windows using synthetic service names and public example
URLs. They exclude the native title/menu frame and do not establish current
provider, notification or DPI acceptance.

## Existing assets

The setup, services and service-rail images were captured on 1 October 2026.
They describe an older interface; review the current application before using
them in release material.

| Assets                                                                                  | Scope                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `setup.png`, `services.png`                                                             | First-run and service settings with synthetic configuration        |
| `service-rail.png`, `service-rail-minimum.png`                                          | Multiple service instances and a 900 × 600 client window           |
| `service-rail-125-render.png`, `service-rail-150-render.png`                            | Emulated WebView2 rendering scale; not native monitor-DPI tests    |
| `service-rail-unread.png`, `service-rail-focus.png`, `service-rail-inactive-unread.png` | Synthetic unread and keyboard-focus states                         |
| `settings.png`, `notifications.png`, `updates.png`, `about.png`                         | Historical settings/dialog appearance; version text is not current |

## Capturing replacements

Use the candidate native build and a dedicated synthetic profile. Show public
example URLs, no account identifiers, provider messages, QR codes or private hosts.
Inspect every image before committing it. Record enough source/version context
to identify what the image illustrates, and distinguish rendered-scale emulation
from actual Windows DPI changes.

Keep temporary captures and test logs outside the checkout. Commit only the
sanitized assets referenced by documentation or release material. Follow
[Windows acceptance](../WINDOWS_ACCEPTANCE.md) for behavioral testing.
