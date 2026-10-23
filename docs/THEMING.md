# Theming

The local shell follows the saved Dark, Light or System preference. Provider theme
injection is an explicit registry capability: only Synology ChatPlus receives
ChatPlus's dark stylesheet. Synology Chat, Discord, WhatsApp, Messenger, Slack and
Mattermost retain their own appearance. Their unread adapters are separate bundles.

## Theme lifecycle

1. Native session creation sets the opt-in child WebView background before
   navigation: `#0f1115` for resolved Dark and white for resolved Light. Window theme
   changes update the same native surfaces.
2. A document-start initialization script supplies the saved preference and bundled
   CSS. If the document root does not exist yet, the bootstrap observes its creation.
3. `bootstrap.ts` creates or reuses `style#chatplus-desktop-theme`, attached directly
   to the document root rather than the provider-owned head/body. Ordinary message,
   thread, composer and loading-node replacement inherits its rules immediately.
4. The singleton `window.__chatplusThemeBootstrap` prevents duplicate styles,
   observers and media listeners. `window.__chatplusSetTheme` changes the saved
   preference without replacing the stylesheet.
5. Narrow observers repair document/root replacement, the resolved theme attribute,
   style removal, disabled/media attributes and stylesheet text changes. Provider
   subtree mutations do not require a whole-document rescan or reinjection.

System resolves through `prefers-color-scheme: dark`; explicit Dark and Light ignore
system changes. The resolved value is stored in `data-chatplus-theme` on the root.
Every provider color override must remain below `:root[data-chatplus-theme="dark"]`.
Light and System-resolved Light leave the provider's original palette available.

## Surfaces and animations

Cover provider containers and their transient loading, editing, menu and reaction
surfaces with scoped selectors. Avoid blanket color replacement on images,
attachments or arbitrary message content. A selector should match recreated nodes
as soon as they are inserted, rather than depend on a later mutation callback.

The provider's `jumphighlight` animation uses `--eos-bg-fill-theme-light` before
fading to transparent. Its pale default conflicts with the dark-mode foreground. The dark
stylesheet supplies the actual EOS base, hover, active and foreground tokens:

| Token                              | Dark value |
| ---------------------------------- | ---------- |
| `--eos-bg-fill-theme-light`        | `#20344f`  |
| `--eos-bg-fill-theme-light-hover`  | `#243b57`  |
| `--eos-bg-fill-theme-light-active` | `#294260`  |
| `--eos-fg-on-fill-theme-light`     | `#a8cdff`  |

Keep the provider's animation timing and transparent fade target. Overriding the
tokens lets new and recreated rows use the corrected contrast immediately.
Controlled surfaces exclude background-color transitions while retaining supported
movement, opacity and foreground transitions.

Theme code must not acknowledge unread, dispatch notifications, intercept clicks,
rewrite link targets or navigate provider pages. Those operations belong to their
native/provider controllers. See [links and downloads](LINKS_AND_DOWNLOADS.md).

## Extending and validating

- Inspect the provider's actual CSS and semantic containers before adding rules.
  Scope new selectors to the opted-in provider and resolved Dark root.
- Preserve the singleton style object through head/root replacement and repeated
  bootstrap evaluation. Limit observers to the surfaces that need repair.
- Exercise incoming messages, conversation switches, threads, history loading,
  composer focus, editing and reactions/menus in Dark, Light and System modes.
- Keep structural coverage for style continuity, selector matching, animation
  contrast, root repair, mode restoration and unmodified link events. Structural
  tests cannot establish that no native Windows frame flashes; visual checks belong
  in [Windows acceptance](WINDOWS_ACCEPTANCE.md).

Source: [`bootstrap.ts`](../src/theme/bootstrap.ts),
[`dark.css`](../src/theme/dark.css),
[`services.rs`](../src-tauri/src/services.rs),
[`window.rs`](../src-tauri/src/window.rs) and
[`build-theme.mjs`](../scripts/build-theme.mjs). Relevant tests are
[`theme.test.mjs`](../tests/theme.test.mjs) and
[`provider-bootstrap.test.mjs`](../tests/provider-bootstrap.test.mjs).
