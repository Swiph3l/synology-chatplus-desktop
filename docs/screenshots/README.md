# Screenshots

The 1.0.4 captures show the running desktop application in English, in isolated
profiles with synthetic services. Windows uses WebView2. Ubuntu uses WebKitGTK.

## Version 1.0.4

- [Windows workspace](desktop-104-workspace.png) includes the native window and
  service rail. The conversation is a local HTML fixture with fictional messages.
- [Windows onboarding](desktop-104-onboarding.png) shows the two supported
  Synology services and the experimental integrations.
- Windows Settings in [Light](desktop-104-settings-light.png),
  [Dark](desktop-104-settings-dark.png) and [Retro](desktop-104-settings-retro.png).
- [Resource usage](desktop-104-resources.png) and [report preview](desktop-104-report.png)
  show the native Windows sample and a user-reviewed Markdown draft.
- [Linux Settings](desktop-104-linux-settings.png) and [resource usage](desktop-104-linux-resources.png)
  show the Ubuntu 24.04 native build. WebKit process metrics are unavailable there.

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
