# Link and download reliability — 2026-10-22

## Audit and resulting behavior

Previously, external navigation and popup callbacks silently opened permitted
HTTP(S) links in the default browser. Same-provider new windows instead navigated
the original provider view; an initial `about:blank` popup was denied. ChatPlus's
theme bootstrap also rewrote some new-window clicks into same-window navigation.
These paths lost popup/opener behavior used by provider controls. Same-window blob
navigation was rejected, potentially interrupting navigation-style downloads.

The [download audit](DOWNLOAD_RELIABILITY_2026-10-22.md) records the original
download transitions: WebView2 chose a destination and exposed native controls,
but there was no guaranteed Save As picker or destination in the shell status.

External navigation now follows:

1. Validate a credential-free HTTP(S) destination and the originating configured
   service instance, honoring the saved external-browser preference.
2. Cancel embedded external navigation and queue a native warning after the
   WebView callback returns. Show the full ASCII URI and destination origin;
   internationalized hostnames use punycode, and HTTP receives an extra warning.
3. Default to Cancel. Closing/Escape never launches a browser. An explicit Open
   applies only to that retained URL, after rechecking the current preference and
   service configuration. Errors are visible and no approval is cached.

Supported same-provider/blank/attachment popups retain their original browser
environment/profile without replacing the main provider. Every later navigation
is checked; unrelated external destinations still require confirmation. Remote
popup pages receive no desktop IPC permission. Theme injection no longer changes
click, modifier-key, provider-prevented or download-link behavior.
Warnings belong to the actual originating native window, including attachment
popups. Recognized Discord CDN attachment navigation is rerouted through the
originating view's public `window.open` and the same restricted popup policy.

Native downloads now follow:

1. WebView2 raises DownloadStarting in the original authenticated profile.
2. Keep a native deferral on its owning UI thread; queue pickers serially after
   the callback returns, with a bounded pending queue.
3. Show Windows Save As with a safe, noncolliding filename, default extension and
   proposed directory. Cancel completes the deferral without starting a transfer.
4. Use the exact chosen absolute filesystem path, without decoding or renaming it
   afterward. In-flight paths remain reserved across service instances; existing
   file replacement requires the native picker confirmation.
5. Continue the original browser transfer with its native pause/cancel and security
   controls. Show the selected full path in the shell's localized progress/result
   text and title. No file is opened automatically.

Full URLs, cookies and pairing data are not logged. The selected local path is
ephemeral UI state, with no download-history persistence or provider transmission.
The Windows UI changes are translated into all seven application languages.

## Validation and limits

Automated coverage includes URL/origin/scheme boundaries, exact signed URL
preservation, stale confirmation rejection, cancellation without opener calls,
one launch after approval, popup restrictions, queued/reentrant picker scheduling,
exact selected paths, duplicate/in-flight reservations, and safely rendered
localized path/status text. Checks and application build results are recorded below.

Native UI automation could not connect to the installed Computer Use helper
(`native pipe unavailable`, Windows error 2), including its prescribed retry and
session reset. Actual warning/picker appearance and authenticated provider
transfers remain manual acceptance checks; passing unit tests is not that evidence.
The supported target is Windows x64. Linux/macOS remain experimental; these native
dialogs are Windows-only and unconfirmed external links have no silent fallback.

External unknown CDN links follow the confirmed external-browser path. The app
does not guess attachments by extension or re-download them through a separate HTTP
client. Confirming a destination does not scan its content or guarantee its safety.

No release, tag or push is part of this change.

| Final check                          | Result                                                     |
| ------------------------------------ | ---------------------------------------------------------- |
| Frontend formatting and typecheck    | Passed                                                     |
| Full JavaScript suite                | 338 passed, 0 failed                                       |
| Rust formatting and locked check     | Passed                                                     |
| Full locked Rust suite               | 189 passed, 0 failed, 1 existing signature fixture ignored |
| Optimized Windows application build  | Passed, no bundle/release produced                         |
| Native dialog/authenticated transfer | Pending manual acceptance                                  |

The test executable is `src-tauri/target/release/chatplus-desktop.exe`, built with
the existing isolated `reliability-20261022` QA identifier/profile. Exit an older
running ChatPlus instance using File → Quit before launching it; single-instance
activation otherwise restores that older process. Existing profiles were not reset.
Logs are outside Git under
`E:\chatplus_synology_client\validation\links-downloads-2026-10-22`.

Implementation references: [WebView2 threading and deferred modal UI](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model),
[related popup environment/profile requirements](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2newwindowrequestedeventargs),
and [Windows task dialog API](https://learn.microsoft.com/en-us/windows/win32/api/commctrl/nf-commctrl-taskdialogindirect).
