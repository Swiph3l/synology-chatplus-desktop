# Windows acceptance checklist

Use this checklist for an actual candidate build. Automated fixtures and a
successful compile do not establish native delivery, authenticated provider
behavior or visual no-flash acceptance.

## Prepare and record

- Record build identity/hash, Windows version, WebView2 version, provider/server
  version and display scaling. Mark each result pass, fail or not tested.
- Use consenting test accounts and controlled conversations. Keep credentials,
  message contents, private URLs, QR/session secrets and private screenshots out
  of the repository and diagnostics.
- Use a fresh application identifier/profile for isolated synthetic tests.
  Confirm the intended executable is running; a second process with the same
  identifier activates the existing instance.
- Enable saved global/service notifications and the provider's browser permission.
  Allow Windows notifications and initially disable Do Not Disturb, then test
  denial and suppression separately.
- Distinguish a debug build's PowerShell toast sender fallback from the installed
  production sender. Synthetic notifications do not prove live provider delivery.

## Startup, profiles and settings

- [ ] First run offers provider-neutral onboarding; Skip and Continue survive restart.
- [ ] Saved selected service opens first. Other enabled services load sequentially
      in rail order without selection, focus or visible-content flashes.
- [ ] An offline/login service does not stall later startup indefinitely. Removing,
      disabling or reconfiguring a queued service cannot revive its old session.
- [ ] Two instances of the same provider keep separate sessions, names, colors,
      permissions and unread state after reload/restart.
- [ ] Reorder, rename, mute and removal persist. Changing URL/provider recreates only
      the intended view. Alternate application identifiers do not change production autostart.
- [ ] Tray open/hide/restore, close/minimize preferences and explicit Quit work.
      A second launch restores the existing instance without duplicate windows.

## Notifications and unread

Repeat for Synology ChatPlus, Synology Chat, Discord and authenticated experimental
providers being evaluated. Record unsupported or unavailable behavior explicitly.

| Main window state | Scenario                                               |
| ----------------- | ------------------------------------------------------ |
| Foreground        | Target service selected; then another service selected |
| Unfocused         | Another application owns foreground                    |
| Minimized         | Target conversation remains loaded                     |
| Hidden to tray    | Process and provider session remain active             |

For each state:

- [ ] Receive a controlled message. Eligible browser events produce one native
      toast; repeated processing cannot duplicate it. Record if the provider emits
      no browser event instead of assuming native delivery was tested.
- [ ] Confirm the correct service becomes unread, including ordinary unread messages
      rather than mentions alone. Rail, title, tray and taskbar agree when enabled.
- [ ] Restore, focus, wait, select a service, click a toast and dismiss a toast in
      separate trials. None acknowledges unread by itself.
- [ ] Click a toast while another service is selected. The existing main window is
      restored/focused and the correct enabled instance activates. A known provider
      callback may open its conversation; unavailable routing is not guessed.
- [ ] A removed, disabled or replaced service cannot be reopened by a stale toast.
- [ ] Receive two distinct messages, including identical previews. Neither is lost;
      replaying the same exact event does not create another toast.
- [ ] Keep two services unread, then read one using genuine scoped evidence. The
      other service and aggregate stay unread. Repeat with two instances of one provider.
- [ ] Historical scroll position, header/sidebar clicks, synthetic input and an
      unrelated conversation do not establish read. New arrivals survive older read proof.
- [ ] Missing, collapsed, filtered or virtualized lists do not manufacture global zero.

Test saved global-off, service mute, provider mute, Windows denial/Do Not Disturb,
sound off and Full/Sender/Generic preview modes. Delivery suppression must not
clear unread or silently disable the saved notification preference. Browser/native
permission disagreement should be diagnosable without message content.

## Explicit read actions

- [ ] Right-click targets the clicked stable service ID, including a second instance.
      Unsupported actions are absent/disabled and do not claim remote success.
- [ ] Discord **Mark as read** affects only the active mapped conversation/channel/
      thread with safe evidence. Unrelated channels and newer arrivals remain unread.
- [ ] Selecting/clicking the Discord service never marks every channel read.
- [ ] Discord **Mark Discord Inbox read** uses the public Inbox/Unreads operation.
      Confirmation, error, unknown DOM, timeout or incomplete provider zero cannot
      report successful read or clear the captured local boundary.
- [ ] Synology local all-read is explicitly labeled local. It affects only that
      service instance and does not claim server-side acknowledgement.
- [ ] Read actions leave the window responsive. Concurrent arrivals, service
      replacement and focus changes do not clear unrelated state.

See [PROVIDERS.md](PROVIDERS.md) and [NOTIFICATIONS.md](NOTIFICATIONS.md) for the
current capability and evidence contracts.

## Dark, Light and System appearance

For ChatPlus Dark mode, repeat incoming messages, conversation switches, opening
threads, loading history, composer focus, message editing and reaction/menu opening.

- [ ] No white/light frame or low-contrast pale message highlight appears.
- [ ] Incoming highlights remain distinct and fade naturally; sender/body/time stay readable.
- [ ] Navigation and recreated content retain the dark fallback without stylesheet churn.
- [ ] Light mode restores provider colors. System follows OS changes; explicit
      Light/Dark remains stable. Independent providers retain their own appearance.

## Provider sessions

- [ ] Official login works with ordinary WebView2. For WhatsApp, check QR and exposed
      phone-number pairing without recording secrets or bypassing security checks.
- [ ] Reload, restart, linked-session retention and logout work for the tested instance.
- [ ] A second instance stays isolated through login/logout and notification routing.
- [ ] Experimental status remains visible; unsupported read operations are not offered.

## Links and downloads

- [ ] External HTTP(S), including `target=_blank`, shows the exact destination warning;
      HTTP has its additional warning. Cancel/Escape opens nothing; Open launches once.
- [ ] Same-provider popups, delayed popup navigation, previews and regular/blob
      attachments preserve the originating provider and native routing policy.
- [ ] Unsafe schemes, credentials, foreign blobs and stale/disabled-origin requests
      do not reach the external opener.
- [ ] Native Save As precedes each download. Chosen destination/status remain visible;
      PDF, archive, text, image and Office test files retain expected bytes/extensions.
- [ ] Spaces, encoded/Unicode and Content-Disposition names are safe. Existing files
      survive duplicate/concurrent downloads from separate instances.
- [ ] Authenticated transfers retain the browser session. Cancel, interruption,
      failure and retry are usable; files never open or execute automatically.

## Desktop and updater

- [ ] Settings, rail, footer, menus and keyboard navigation work at minimum and larger
      windows and actual 100%/125%/150% Windows scaling. Long names remain usable.
- [ ] Check all seven locales: en, pl, es, de, fr, ja and zh-TW, including dialogs,
      read-action labels, notification settings and download status.
- [ ] Include beta updates off/on produces the expected release eligibility.
      Automatic checks remain quiet when offline; manual checks remain available.
- [ ] With an authorized signed package, test download/cancel, signature rejection,
      explicit installation/restart and retained profiles/login data. Follow
      [UPDATER.md](UPDATER.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

Record the tested conditions, expected/observed behavior and privacy-safe evidence
for each failure or untested item. Keep execution records outside this reusable guide.
