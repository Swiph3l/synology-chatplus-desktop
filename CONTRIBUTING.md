# Contributing

Maintained by Swiph3l. Contributions should preserve the lightweight Tauri 2,
Rust and vanilla TypeScript architecture and the clearly unofficial branding.

By submitting contributions, you understand that accepted contributions become
part of ChatPlus Desktop and are distributed under the current
[GNU GPLv3 (GPL-3.0-only)](LICENSE). You retain your copyright;
submitting a contribution does not transfer it to the maintainer. Submit only
work you have the right to contribute under these terms. Preserve third-party
licenses and required notices. There is currently no contributor license
agreement (CLA).

Install the prerequisites in the README, then run:

```sh
npm ci
npm run format
npm run typecheck
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Keep platform-specific behavior isolated and test changes on the affected system.
Do not add undocumented server API integrations or automatic media permissions.
Use specific ChatPlus selectors and EOS variables for theme adjustments.

Before committing, review `git diff --check`, `git diff --cached` and untracked
files. Search for credentials, tokens, private addresses, authentication headers,
logs, temporary files and personal screenshots. Keep experiments and private
reference material outside the repository. Use concise logical commits and
explain validation and remaining limitations in pull requests.

CI validates Windows, Linux and macOS builds. Cross-platform runtime behavior
still requires testing. Release automation is disabled; do not create tags or
publish packages as part of routine development.
