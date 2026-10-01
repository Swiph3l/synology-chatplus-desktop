# Screenshot provenance

Fresh images below are actual running Tauri/WebView2 development content captured
on Windows on 2026-10-01. They exclude the native title/menu frame. They are not
DOM fixtures, mockups or edited screenshot text. Only synthetic service names and
public documentation examples are shown; rail captures exclude provider content.
Every new image was visually inspected for private information before committing.

| Image                              | Source and limits                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.png`                        | Isolated first-run setup, pre-Discord acceptance build; empty server field and public placeholder.                                                                                                              |
| `services.png`                     | UI refinement at 8a4d048, light appearance; full-width Provider/Display name/URL controls, removal section and Experimental badge. Public `example.com` is a documentation fixture, not a private/test NAS URL. |
| `service-rail.png`                 | Feature build 5d1d926; ChatPlus and two distinct Discord service configurations.                                                                                                                                |
| `service-rail-minimum.png`         | Same native build; actual 900 × 600 client window, DPI 96.                                                                                                                                                      |
| `service-rail-125-render.png`      | Same build with WebView2 rendering scale emulated at 1.25; **not** an actual Windows monitor DPI transition.                                                                                                    |
| `service-rail-150-render.png`      | Same build with rendering scale emulated at 1.5; **not** an actual Windows monitor DPI transition.                                                                                                              |
| `service-rail-unread.png`          | Native bridge observation from the public fixture; synthetic unread, not real ChatPlus messages.                                                                                                                |
| `service-rail-focus.png`           | Native rail after keyboard focus: active/unread ChatPlus and separately focused Discord.                                                                                                                        |
| `service-rail-inactive-unread.png` | Discord active, inactive ChatPlus retaining the synthetic unread dot.                                                                                                                                           |

`settings.png`, `notifications.png`, `updates.png` and `about.png` remain
**historical visual references**. They are not evidence of the current multi-service
build. About's historical `0.5.0-dev` must not be represented as the current version.
Fresh General, Notifications, Updates and metadata-derived About captures remain due.

Dark/light examples and rendering emulation are supplemental evidence; full System
appearance, native menus and actual Windows DPI changes still need acceptance.
See the [Windows report](../WINDOWS_ACCEPTANCE.md) for observed versus pending checks.
