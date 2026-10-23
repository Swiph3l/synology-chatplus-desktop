# Links and downloads

Provider navigation, external browser links and attachment transfers have separate
policies. Provider authentication and blob state stay in the originating browser
profile. Downloads are never reissued through a desktop HTTP client with extracted
cookies, and completed files are never opened automatically.

## Navigation and external confirmation

| Destination                                                 | Handling                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Allowed provider document                                   | Keep the configured provider's navigation policy.                                                    |
| Exact configured-origin blob                                | Allow the browser attachment path; reject opaque, foreign-origin or credential-bearing blob targets. |
| Allowed provider, attachment or initial `about:blank` popup | Create a related popup using the opener's environment/profile.                                       |
| Other credential-free HTTP(S) URL                           | Cancel embedded navigation and request local confirmation if external links are enabled.             |
| Other scheme or URL credentials                             | Reject the provider link; never pass it to the operating-system opener.                              |

On Windows, a document-start capture handler forwards a trusted, unmodified
primary click on an external anchor directly to the native confirmation path.
This runs before provider handlers that may cancel or defer browser navigation.
It does not intercept downloads, editable or disabled links, provider routes,
Slack workspace navigation or authenticated Discord attachments. Modified clicks
and ordinary navigation retain the native navigation/popup fallback. The bridge
is separate from provider theming and checks the exact live document, configured
service and WebView registration before requesting a prompt.

The bundled `external-link` window uses the saved shell theme and language. It displays
the complete serialized ASCII URI as selectable, read-only text, the destination
origin and an additional warning for HTTP. Internationalized hostnames use punycode
and percent escapes remain intact. Do not decode or reconstruct signed query
strings. Full destinations may contain sensitive values and must not be logged or
placed in the local page's query string.

Rust retains the exact URL, originating service/view and a fresh one-time request
ID. The frontend receives only the display payload and returns the request ID plus
an approval or cancellation; it cannot choose a replacement URL. The prompt's IPC
commands accept only the bundled local `external-link` view, and provider pages gain
no native permissions.

Creation is queued after the WebView callback returns. The owned window stays hidden
until its controls and safe default focus are ready, then disables its parent while
leaving the event loop responsive. Cancel is the default; closing or Escape never
opens a browser. An optional gentle chime plays once after display and respects the
saved notification-sound mute preference, without a stock warning-sound fallback.

Retire the completed request's exact window without sending another close request.
A fresh click may wait for native destruction and label removal before creating
its own prompt. Late close/destruction callbacks must affect only the matching
request; they must never cancel or approve the successor's destination.

Open requires the active, visible prompt. Recheck the external-link preference,
enabled service identity and original source document before opening the retained
destination. A changed source document, hidden parent, stale response or bounded
timeout cancels the request and restores the parent. Consume approval once; never
cache it for another click. Failures are reported in the local shell. Confirmation
does not scan or guarantee the safety of the destination.

## Related popups and attachments

A popup must preserve the opener's WebView2 environment and isolated profile.
Replacing the main provider view or opening a fresh profile breaks opener,
authentication and blob semantics. Validate every later navigation against the
captured service configuration; remote popup pages receive no Tauri capabilities.
Nested allowed windows reuse the attachment view instead of recursively creating
blank windows. Unrelated external targets still require confirmation.

Attachment windows use the shell theme for their native frame and default loading
canvas, with a localized title and no inherited desktop menu. Configure these
surfaces before showing the initial blank view, while preserving the opener's
explicit size/position. Live appearance updates target only app-owned chrome and
the default background; do not inject theme CSS into remote attachments or PDF
documents.

Discord attachment exceptions are limited to credential-free HTTPS on port 443 at
`cdn.discordapp.com` or `media.discordapp.net`, under a populated
`/attachments/<channel>/<attachment>/<filename>` path. Do not classify arbitrary CDN
URLs by extension. Recognized same-window CDN navigation is cancelled and queued
through the originating provider's public `window.open` with an exact JSON-serialized
URL, allowing the same related-popup path to retain its session. No arbitrary URL
or external-opener fallback is allowed for this operation.

## Windows Save As and transfer lifecycle

1. `DownloadStarting` retains the original WebView2 transfer and an owning-apartment
   deferral. A bounded queue serializes native pickers, including downloads that
   arrive while another modal picker is open.
2. Dispatch the picker after the WebView callback returns. COM references remain on
   their original UI apartment; workers carry scheduling data only. Tauri may run
   main-thread dispatch inline, so posting from inside the callback is insufficient.
3. Sanitize the provider-suggested filename, preserving a valid extension. Handle
   encoded separators, invalid Windows/device names, bidi controls and UTF-16 length.
   Propose a noncolliding destination and supply the extension as the picker's default.
4. Cancel aborts the transfer and completes the deferral. An accepted selection must
   be an absolute filesystem path. Use that exact chosen path without subsequent
   decoding, sanitization or renaming; the native picker owns overwrite confirmation.
5. Reserve in-flight paths across service instances to prevent parallel downloads
   from overwriting one another. Revalidate the service after the picker, set the
   destination, and retain native browser pause/cancel and security controls.
6. Publish requested, in-progress, paused, cancelled, completed or failed state with
   the chosen full local path where available. The shell renders localized status
   text and a title using text-safe APIs. Release reservations on terminal states;
   resumable interrupted transfers retain theirs.

The event shape is `{ serviceId, state, path? }`. The local destination is ephemeral
display state, not download-history persistence or provider data. Signed URLs,
cookies, message content and pairing information do not enter download events or
logs. Hook setup failure is reported as unavailable. A download already intercepted
is cancelled when its picker or deferral fails; do not fall back to a second transfer
or a different destination.

## Platform and validation boundaries

The owned confirmation and native Save As integrations target Windows. Linux/macOS
remain experimental; these integrations are unavailable and external links have no
unconfirmed fallback. Provider behavior still determines whether a click creates a
browser download, popup or notification; a public `window.open` override can also
prevent an attachment popup.

Maintain regression coverage for exact URL preservation, rejected schemes/origins,
stale/cancelled confirmations, related popup policy, modal queue reentrancy, selected
path integrity, collision reservations and text-safe status rendering. Native dialog
appearance, authenticated transfers and provider popup behavior also require
[Windows acceptance](WINDOWS_ACCEPTANCE.md).

Source: [`navigation.rs`](../src-tauri/src/navigation.rs),
[`external_links.rs`](../src-tauri/src/external_links.rs),
[`downloads.rs`](../src-tauri/src/downloads.rs),
[`services.rs`](../src-tauri/src/services.rs),
[`platform.rs`](../src-tauri/src/platform.rs) and
[`external-link.ts`](../src/ui/external-link.ts). Theme injection must preserve these
navigation semantics; see [theming](THEMING.md).
