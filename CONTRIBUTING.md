# Contributing to ChatPlus Desktop

Thank you for your interest in contributing! ChatPlus Desktop is an independent community project, and contributions of all kinds are welcome.

## Code of Conduct

Please be respectful and constructive in all interactions. This project follows the [Contributor Covenant](https://www.contributor-covenant.org/) code of conduct.

## How to Contribute

### Reporting Bugs

Open a [Bug Report](../../issues/new?template=bug_report.yml) using the issue template. Please include as much detail as possible.

> ⚠️ **Never include your Synology credentials, SynoToken, or private NAS URLs in issue reports.**

### Requesting Features

Open a [Feature Request](../../issues/new?template=feature_request.yml) using the issue template.

### Submitting Pull Requests

1. Fork the repository.
2. Create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. Make your changes.
4. Ensure no credentials, tokens, or private URLs are included in your changes.
5. Open a pull request against `main` with a clear description of your changes.

## Development Setup

> Prerequisites: [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/), [Tauri CLI](https://tauri.app/start/prerequisites/)

```bash
# Install Node.js dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Coding Guidelines

- Keep the application a thin shell. Business logic belongs on the Synology NAS.
- Do not introduce third-party analytics, telemetry, or data collection.
- CSS theme overrides must only affect visual properties — no JavaScript injection.
- Follow Rust and TypeScript best practices for their respective parts of the codebase.

## Security

Please read [SECURITY.md](SECURITY.md) before contributing. Never commit credentials, session tokens, or SynoToken values.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
