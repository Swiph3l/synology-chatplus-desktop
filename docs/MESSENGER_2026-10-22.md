# Messenger provider audit — 2026-10-22

Messenger is an Experimental WebView integration using the official Facebook
messages surface. It is not a Messenger SDK client, a credential manager or an
official Meta product.

## Current entry point and official sources

The integration starts at `https://www.facebook.com/messages/`. A public request
reached Facebook's normal login URL with that messaging destination as its return
target. No account was inspected and no login, cookie, security-checkpoint or
session secret was captured. Facebook's public [Messaging Help Center](https://www.facebook.com/help/1071984682876123)
documents messaging on facebook.com. The official [standalone-Web migration help
reference](https://www.facebook.com/help/messenger-app/804132271957789) was login-gated
in this automated inspection, so its exact retirement wording/date was not
independently read. The implementation does not depend on the legacy messenger.com
endpoint or assert an exact shutdown date.

The default/current supported origin is exactly HTTPS `www.facebook.com` on port 443. Configuration rejects credentials, HTTP, nonstandard ports, bare/mobile
Facebook hosts, lookalikes and messenger.com. Navigation remains same-origin rather
than path-restricted so official login/checkpoint/security flows are not guessed or
blocked. There are no wildcard host allowances or external identity-provider
exceptions. Unknown cross-origin authentication requirements need independent
validation before any policy expansion.

Each service uses its stable service-ID profile, independent of display name and
order; multiple Messenger instances retain separate cookies/storage and mute
preferences. Standard WebView2 compatibility identity remains unchanged. ChatPlus
does not save credentials or use private/reverse-engineered Messenger APIs.

## Unread, read actions and notifications

No authenticated current Messenger DOM was available for an audit. The dedicated
`messenger-dom` adapter therefore reports unknown, without scanning contact labels,
thread IDs, message previews, message bodies or profile/status data. Generic
Facebook badges, title prefixes, selected rows and apparently complete lists are
not accepted. Missing, filtered, archived, virtualized or changed DOM cannot
establish provider-wide zero. Counts and current-conversation identities remain
unavailable. Current/all read capabilities are explicitly unsupported; menu actions
stay disabled until a safe real Web UI operation can be independently verified.

Actual browser `Notification` events are handled by the shared native coordinator:
origin/source validation, per-service unread arrival, deduplication, saved global/
service preference, native permission and send result. Browser delivery is handled
centrally to prevent an extra unfiltered WebView toast. A toast click restores the
correct existing instance and delegates to a retained provider-owned click callback
where available; it neither guesses a chat URL nor acknowledges unread. Dismissal
has no read meaning. ChatPlus cannot manufacture notifications that Facebook never
emits, including when the provider itself suppresses focused events.

Facebook messages shares its entire origin with Facebook. Same-origin navigation
can reach non-messaging content, and Facebook may produce non-Messenger browser
notifications. They cannot reliably be separated solely by the origin. Configure
Facebook's own notification categories as needed; no generic navigation count is
misrepresented as Messenger unread. This limitation is part of the Experimental
status.

## Validation and remaining acceptance

Automated coverage verifies registry/default URL/Experimental status, settings and
onboarding wiring, isolated stable profile persistence, icon mapping and seven
locales; native source pairing validates `messenger-dom` against Messenger only.
Dedicated adapter tests ensure all unaudited DOM remains unknown and private DOM
properties are never inspected. Shared read capability tests explicitly reject
Messenger current/all acknowledgements. Common native tests cover browser-event
deduplication, instance routing and permission scope.

Authenticated Windows acceptance remains pending: Facebook login/checkpoints,
history restoration/PIN UI, reload/restart persistence, logout, actual browser
notification emission, focused/unfocused/minimized/tray-hidden delivery, toast
callback routing and duplicate suppression. DOM unread selectors require a
separate authenticated audit before implementation. No successful login, account
inspection, real notification delivery or remote mark-read is claimed.

## Bundled icon provenance

The current [official Messenger icon guidance](https://www.meta.com/brand/resources/facebook/messenger-icon/)
identifies the primary icon as Facebook Blue (updated February 2025). The official
pack's `Messenger_Icon_Primary_Blue.svg` and `.png` were bundled byte-for-byte as
`public/providers/messenger.svg` and `src-tauri/icons/providers/messenger.png`.
The SVG is excluded from automatic formatting. SHA-256:

| Asset | SHA-256                                                            |
| ----- | ------------------------------------------------------------------ |
| SVG   | `0278c863f568da118d80547ceee6ad0b75381111e72d7c69cdd8859467c7889b` |
| PNG   | `f71f006ffb1ee640b992e1605e694261d22624da254fe15a68756c7a8c990e43` |

The marks retain Meta's brand terms and are not project-code assets. No affiliation,
endorsement or sponsorship is implied; see [NOTICE](../NOTICE).
