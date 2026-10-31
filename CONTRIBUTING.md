# Contributing

ChatPlus Desktop is maintained by Swiph3l. Contributions to bugs, provider integration,
translations, accessibility, native platform testing and documentation are welcome.

Start with the [documentation index](docs/README.md), [local development](docs/DEVELOPMENT.md)
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
  automatic results and native checks actually performed on each platform in the PR. Keep
  release notes user-readable and technical guides current with the code.
- Keep session notes, raw logs, local build receipts and machine-specific paths
  outside the source checkout. `docs` contains reusable developer documentation;
  see its [conventions](docs/README.md#documentation-conventions).

The `1.0.0` candidate adds native CI for Windows x64, Linux x64 and both macOS
architectures. macOS and Linux remain candidates pending the
[platform acceptance checklist](docs/PLATFORMS.md#native-acceptance-checklist).
Linux distribution is blocked by the upstream glib advisory; do not weaken its
strict target security gate to produce a package. Native runtime acceptance is
separate from a successful build. Tags enter a signed draft release workflow;
routine contributions must not tag, publish or push a release.

By submitting a contribution, you agree that accepted work is distributed under
[GNU GPLv3 (GPL-3.0-only)](LICENSE). You retain your copyright; there is no copyright
transfer or CLA. Contribute only work you have the right to submit and preserve
third-party licenses/notices. See [licensing notes](docs/LICENSING.md) and
[security reporting](SECURITY.md).

Useful issue-label suggestions for maintainers: bug, good first issue, help wanted,
notifications, provider, windows, translations and documentation. These are
recommendations; contribution changes do not create repository labels/settings.

## Contributor credit

Accepted code, translations, testing, documentation and platform ports can all earn
public credit. A maintainer verifies the contribution and the contributor's public
GitHub username before adding it. Credit describes the person's work and includes
contributions developed in community variants. Contributors retain the license
and copyright terms described above.

The shared [contributors.json](contributors.json) registry supplies both About and
the generated README section. To add a person or a community variant:

1. Add a contributor with a stable unique `id`, their preferred public `name`, a
   verified GitHub `username`, and the applicable `contributions` roles. Role labels
   come from the translated `about.contribution.*` resources. General roles include
   `code`, `translations`, `testing`, `documentation` and `port`; established
   platform/integration roles can describe more specific work. For an existing person,
   update the roles rather than creating a duplicate identity.
2. For a community variant, add a `forks` entry with a stable `id`, the credited
   `contributorId`, its GitHub `owner` and `repository`, and the supported `platform`
   value. Do not paste arbitrary URLs or private contact/account information.
3. Run `npm run contributors:update`, then `npm run contributors:check`. Include the
   registry change and regenerated README in the same reviewed contribution.

New people and variants using existing roles need only a registry edit and README
regeneration. Keep the README marker comments intact and avoid editing their
generated content directly. Rebuild the application to include the registry update
in About. Profile and repository links use native allowlisted targets derived from
the registry; opening About never fetches remote contributor or commit statistics.
