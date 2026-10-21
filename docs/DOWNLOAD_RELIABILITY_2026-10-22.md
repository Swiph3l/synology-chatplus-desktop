# Attachment download audit — 2026-10-22

## Behavior inspected before changes

All provider child WebViews attach a native WebView2 `DownloadStarting` listener.
Transfers use the original browser/profile, including authentication and blob
state. The listener sanitizes a browser-proposed destination, reserves a unique
name across instances, and sets `Handled=false` to retain the native download UI.
It then publishes requested/progress/completed/cancelled/paused/failed lifecycle
codes. Those events deliberately contain no destination path.

The native download UI is not an explicit application Save As contract. A
download can use the default Downloads folder without a destination picker, and
the shell cannot show where it was saved because no chosen path is published.

New-window attachment routing recognizes exact same-origin blob URLs and Discord
attachment CDN URLs. Other configured-origin popups currently navigate the opener,
which can replace the provider interface instead of preserving a separate popup.
External links and download routing must remain distinct: downloads stay in the
browser; external web navigation goes through the explicit security confirmation.

The intended transition is browser download event → deferred, queued native Save
As → explicit chosen path or cancellation → original native transfer → visible
completion/error with the chosen local path. No provider API, cookie extraction,
HTTP-client re-download, automatic file opening, or message scraping is involved.
