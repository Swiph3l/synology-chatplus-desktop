# Provider theme reliability audit, 22 October 2026

## State before implementation

This audit records the existing lifecycle before changing theme behavior.

1. `src-tauri/src/services.rs` supplies the saved `system`, `light` or `dark`
   preference in a WebView initialization script. Only the Synology ChatPlus
   provider opts into ChatPlus CSS. Synology Chat, Discord and other providers
   have independent unread scripts and retain their own appearance.
2. `src/theme/bootstrap.ts` bundles the actual CSS into that initialization
   script. It creates one style element per execution, appends it directly to
   `documentElement` as soon as the element exists, and sets
   `data-chatplus-theme` to the resolved preference. System follows the media
   query; live native setting changes call `__chatplusSetTheme`.
3. The observer watches all descendant child-list mutations. The same style
   object survives ordinary message, composer and conversation replacement,
   and is reattached if removed. Normal message delivery does **not** explicitly
   remove and recreate the stylesheet.
4. The dark stylesheet scopes overrides to the resolved dark root. It provides
   root/body fallback colors, EOS variables, main and thread surfaces, composer
   textarea/paste-zone colors, form controls, menus and reaction controls. Light
   mode deliberately lets the provider's original styles apply.
5. Native code colors the parent window; it does not currently set a separate
   provider WebView background in `services.rs`. A document initialization
   script cannot prove the color of the native surface before a document exists.

## Findings and scope

The initial audit did not reproduce the incoming-message flash against an
authenticated provider. It established exposure to light transient surfaces,
rather than a stylesheet-removal root cause. The subsequent screenshot and
primary static CSS audit below identify a concrete pale-blue highlight mechanism.
Additional lifecycle gaps found during that initial review were:

- the persistent CSS does not explicitly cover recreated loading/editable
  surfaces within the message viewer;
- provider background transitions/animations can run even when the final dark
  background is overridden;
- re-executing the bootstrap installs duplicate styles, observers and handlers;
- root theme-attribute changes and modifications to the persistent stylesheet
  are not watched by the existing child-list-only repair logic.

The implementation keeps one persistent stylesheet and bootstrap instance,
repairs only relevant document/root/style changes, adds scoped transient surface
and transition coverage, and verifies Dark/Light/System transitions. ChatPlus
styles remain restricted to providers that opt in; images, attachments and
arbitrary message content retain their original appearance.

## New-message highlight root cause

The user supplied a screenshot showing a very pale blue whole-message highlight
with low-contrast light sender/body text. The configured provider's public,
unauthenticated static stylesheet was inspected without cookies, credentials,
message requests or profile-cache access. Its path is
`/chat/webman/3rdparty/ChatPlus/style.css`; the audited SHA-256 is
`9966be37f33819cc57bae7bd94f1abd664ab39db04fce78f23edc6be58fcf2dd`.
The private host name and vendor source are excluded from the repository.

That provider CSS defines `.jump-highlight` with a three-second `jumphighlight`
animation. Its background holds `--eos-bg-fill-theme-light` through 75% of the
animation, then fades to `--eos-bg-fill-transparent`. The former resolves through
`--eos-color-blue-100` to **`#ecf3fc`**, while the existing ChatPlus dark stylesheet
changes message text to light colors but never overrides that background token.
This is a verified source-level cause of pale-blue highlighting in Dark mode,
consistent with the screenshot. The screenshot's actual authenticated row class
has not been inspected; that remaining DOM/Windows acceptance boundary is explicit.

The fix overrides the actual EOS base/hover/active highlight tokens only below a
resolved Dark root: `#20344f`, `#243b57` and `#294260`, with a compatible foreground
token `#a8cdff`. All retain at least 4.5:1 contrast with primary message text,
secondary sender/timestamp text and the paired foreground. The highlight remains
distinct from the conversation background. Provider animation timing and its
transparent fade target are preserved; recreated rows inherit the corrected
token immediately. Light and System-resolved Light retain provider colors.

## Implementation and automated validation

- `src-tauri/src/services.rs` now sets the opt-in provider WebView's native
  background before navigation/document creation. `src-tauri/src/window.rs`
  updates that child background for saved theme changes and System theme events,
  using the same dark `#0f1115` or light white as the main window. This closes the
  pre-document gap that JavaScript/CSS alone cannot cover.
- `src/theme/bootstrap.ts` reuses an existing style/bootstrap, installs the
  document-root fallback at initialization, and repairs root replacement,
  stylesheet removal/text changes and unexpected theme-attribute changes. It
  watches the document, direct root children and its own style instead of all
  provider message mutations. Theme changes keep the same style object.
  The old capture-click navigation shim has been removed: theming no longer
  rewrites `target="_blank"` links or calls `location.assign`. Provider handlers
  and the native NewWindow/navigation policy own popup, external-link and
  attachment behavior, including modifier clicks and prevented provider events.
- `src/theme/dark.css` immediately styles semantic loading/progress nodes and
  editable nodes within existing ChatPlus viewer/thread/composer containers.
  Controlled content, menu, form and reaction surfaces exclude background
  transitions while retaining opacity/movement/foreground transitions.
- `tests/theme.test.mjs` has ten passing tests. Coverage includes absent initial
  document root, System/Light/Dark changes, repeated bootstrap evaluation,
  head/root replacement, style removal/tampering, and incoming-message,
  conversation, thread, history, composer, edit and menu DOM replacement without
  stylesheet churn. Selector matching verifies scoped dark background and
  transition coverage; Light has no matching dark override. Images are excluded.
  The highlight regression checks all three token states, text contrast,
  immediate inheritance after row replacement and Light/System restoration.
  Link-event regression coverage verifies ordinary/modifier/provider-prevented,
  download, relative and `about:blank` clicks propagate through their original
  composed path without theme-triggered navigation or event cancellation.
- A separate headless installed Microsoft Edge check used the actual audited
  provider animation with the bundled ChatPlus bootstrap loaded first, then
  provider CSS loaded later. Computed Dark colors were `rgb(32, 52, 79)` at 0 and
  2250 ms, the same color at one-third opacity during the fade at 2750 ms, and
  transparent at 3000 ms. Light retained `rgb(236, 243, 252)`. Synthetic fixture
  results and a visually inspected screenshot are outside Git in
  `validation/milestone-2026-10-22/theme-highlight-browser-results.json` and
  `theme-highlight-dark-fixture.png`. This verifies CSS cascade/animation behavior,
  not the authenticated provider's native WebView2 presentation.
- Focused Prettier validation, `npm run typecheck` and `git diff --check` passed
  after these changes. Full repository/native validation is recorded in the
  milestone's main report.

## Required visual acceptance

Structural tests cannot establish that no frame flashes on Windows/WebView2.
Actual authenticated Windows acceptance must exercise incoming messages,
conversation switches, opening threads, history loading, composer focus, message
editing and reaction/menu opening in Dark mode, then verify Light and System
mode. Until those observations exist, these remain unverified visual scenarios.
