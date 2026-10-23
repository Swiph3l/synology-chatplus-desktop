# Theme re-audit, 23 October 2026

This records the current transitions at `6618985` before any further theme
behavior changes. The earlier implementation and its original pre-change state
are documented in [the 22 October audit](THEME_RELIABILITY_2026-10-22.md).

## Current transitions

| Event                                                                        | Current behavior                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create a ChatPlus WebView                                                    | Native code supplies a dark `#0f1115` or light white child background before navigation, then a document-start initialization script supplies the saved theme and bundled CSS. |
| No document root yet                                                         | The bootstrap watches document children and installs its fallback as soon as the root exists.                                                                                  |
| Incoming message, conversation/thread/history/composer/edit/menu replacement | Existing selectors match the new surfaces immediately. The stylesheet stays attached to the root; provider subtree mutations require no reinjection.                           |
| Head/root replacement or stylesheet removal/tampering                        | Narrow observers repair the same stylesheet object and resolved root attribute.                                                                                                |
| Bootstrap evaluated again                                                    | The existing singleton accepts the saved preference; no second stylesheet, media listener or observer lifecycle is created.                                                    |
| Explicit Dark/Light setting                                                  | Native backgrounds and the existing page bootstrap update. Every provider CSS override is scoped below the resolved Dark root. Light leaves provider colors available.         |
| System preference                                                            | The bootstrap follows the color-scheme media query; native theme-change handling updates opt-in child backgrounds. Explicit Light/Dark ignores system color changes.           |
| Discord, Synology Chat, WhatsApp or Messenger                                | Their provider definitions do not opt into ChatPlus theming. Unread scripts and their appearance remain independent.                                                           |

Source locations are `src/theme/bootstrap.ts`, `src/theme/dark.css`,
`src-tauri/src/services.rs`, `src-tauri/src/window.rs` and the provider registry in
`src-tauri/src/providers.rs`. Theme code does not acknowledge unread, dispatch
notifications or rewrite provider links.

## Root cause and existing fix

The earlier pale incoming-message screenshot is consistent with the audited
provider's `.jump-highlight` animation: it holds `--eos-bg-fill-theme-light`
through 75% of a three-second animation, then fades to transparent. The original
token is `#ecf3fc`, while message text had already become light. The current dark
stylesheet supplies `#20344f`, matching hover/active/foreground tokens, and keeps
the original animation and transparent target.

The cached unauthenticated public stylesheet was rehashed during this audit:
SHA-256 `9966be37f33819cc57bae7bd94f1abd664ab39db04fce78f23edc6be58fcf2dd`.
It matches the earlier provenance. No private host, account content or session
data is included here. The prior audit's missing native background and duplicate
bootstrap findings describe its original state; those fixes are present now.

The current CSS also covers the audited loading/progress and editable surfaces
inside ChatPlus containers and removes background transitions from controlled
surfaces. It leaves image/attachment content and independent providers alone.
No additional runtime theme defect has been demonstrated in this re-audit, so
there is no reason to introduce broader color overrides.

## Validation and limits

The existing structural suite exercises document-start injection, singleton
reuse, root/head/style repair, all seven requested conversation-surface mutation
scenarios, Dark/Light/System changes, scoped backgrounds, highlight contrast and
link-event preservation. This re-audit additionally checks that Light and
System-resolved Light survive complete root replacement and stylesheet repair
without matching any dark surface overrides.

Focused validation passed: 11 theme tests and six provider-bootstrap tests
(17 total), the theme bundle build used by those tests, and scoped Prettier and
`git diff --check` checks. Repository-wide validation is recorded in the current
milestone report.

The earlier headless installed Edge fixture recorded dark highlight colors at
0/2250/2750/3000 ms and restoration of the provider's light color. Its stored
results are synthetic CSS/animation evidence, not authenticated WebView2 QA.
No browser or native UI was operated for this re-audit. Incoming messages,
conversation/thread/history changes, composer focus, editing and reactions/menus
still require actual Windows visual acceptance in Dark, Light and System modes;
no frame-by-frame no-flash result is claimed here.
