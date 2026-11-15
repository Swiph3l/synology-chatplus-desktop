---
name: chatplus-provider-integration
description: Maintain ChatPlus Desktop provider adapters, unread/read evidence, native notifications or provider navigation. Use for Synology, Discord, WhatsApp, Messenger, Slack and Mattermost integration changes in this repository.
---

Read the affected provider in `docs/PROVIDERS.md` and the relevant transition
contract in `docs/NOTIFICATIONS.md`. Inspect both registries
(`src-tauri/src/providers.rs` and `src/app/providers.ts`) and the adapter under
`src/theme/providers`; follow the existing file layout if it changes.

Rust owns authoritative unread, generation and notification delivery state.
Adapters submit evidence; notification delivery never defines unread. Focus,
selection, restore, toast activation and dismissal cannot acknowledge messages.
Missing, filtered, collapsed or virtualized DOM remains unknown without a proven
complete zero. Keep current-conversation proof scoped to its service, conversation
and arrival generation; newer arrivals revoke stale proof.

Preserve these provider differences instead of applying a shared selector fix:

- Discord unread is scoped to direct messages. Exact current-DM evidence does not
  prove provider-wide zero; Inbox read-all has its separate completeness contract.
- WhatsApp uses its official notification-attention title counter. Zero is scoped
  attention, not account-wide read. Current-chat correlation is unavailable.
- Messenger's adapter reports unknown; browser notification arrivals own unread.
  Its Facebook/Google verification navigation allowance does not establish that
  fresh embedded Google login works.
- Mattermost automatic zero requires the currently supported server/version and
  primary-store metadata contract; other deployments retain explicit local read.
- Slack has no unread or native notification adapter. Preserve Experimental
  status for integrations unless actual acceptance supports a status change.

Remote provider views have no Tauri command capabilities. Validate configured
service identity, exact permitted source origin, packet shape and live generation
at native boundaries. Public provider UI and the existing WebView session own
authentication. Do not extract cookies, tokens, message content or private stores.
Authentication diagnostics retain only their fixed, bounded categories.

An adapter's `observe` returns its cleanup function. Changes to observers, timers,
subscriptions or document replacement must retain disposal and stale-callback
guards. Use synthetic DOM fixtures and observable transition assertions; fixture
operation counts are not whole-application CPU or memory measurements.

Find affected suites in `docs/TESTING.md`. For example:

```sh
node --test tests/discord-unread.test.mjs tests/discord-read.test.mjs
node --test tests/provider-read.test.mjs tests/minimized-notification.test.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml unread::
```

Also exercise the actual provider, two separate account profiles, background
arrival, read races and restart/session persistence for the changed behavior.
Report synthetic tests and authenticated native acceptance separately.
