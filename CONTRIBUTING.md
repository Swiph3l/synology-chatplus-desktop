# Contributing

ChatPlus Desktop is maintained by Swiph3l. Contributions to bugs, provider integration,
translations, accessibility, Windows testing and documentation are welcome.

Start with [local development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md)
and [testing](docs/TESTING.md). The lightweight Tauri 2, Rust and vanilla TypeScript
architecture and clearly unofficial branding should remain intact.

- Use focused changes and small logical commits matching recent history. Reproduce
  bugs and add regression coverage; run tests after each meaningful subsystem change.
- Preserve useful maintainer comments. New non-obvious project constraints use
  `// Swiph3l: <why>` or `# Swiph3l: <why>`; avoid restating obvious code.
- Add provider-specific semantic adapters and fixtures; inspect the actual provider
  DOM. Keep shared lifecycle/state logic outside adapters and remote views outside
  native capabilities. Do not add undocumented private APIs or automatic media grants.
- Notification diagnostics must omit message content, credentials/tokens, tags and
  private URLs. Never commit test accounts, profiles, keys, logs or private screenshots.
- Before review, run `git diff --check`, inspect staged/untracked files and record
  automatic results and native Windows checks actually performed. Keep release notes
  user-readable; investigations belong in docs.

Current development CI validates Windows; Linux/macOS are experimental. Native
runtime acceptance is separate from a successful build. Tags enter a signed draft
release workflow; routine contributions must not tag, publish or push a release.

By submitting a contribution, you agree that accepted work is distributed under
[GNU GPLv3 (GPL-3.0-only)](LICENSE). You retain your copyright; there is no copyright
transfer or CLA. Contribute only work you have the right to submit and preserve
third-party licenses/notices. See [licensing notes](docs/LICENSING.md) and
[security reporting](SECURITY.md).

Useful issue-label suggestions for maintainers: bug, good first issue, help wanted,
notifications, provider, windows, translations and documentation. These are
recommendations; contribution changes do not create repository labels/settings.
