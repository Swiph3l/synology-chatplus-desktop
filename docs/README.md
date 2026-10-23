# Developer documentation

Start with [Development](DEVELOPMENT.md) to build and run ChatPlus Desktop.
Read [Architecture](ARCHITECTURE.md) before changing native state, provider sessions
or IPC boundaries. User installation and feature information is in the
[project README](../README.md).

## Build and contribute

| Guide                                       | Contents                                                  |
| ------------------------------------------- | --------------------------------------------------------- |
| [Development](DEVELOPMENT.md)               | Prerequisites, local setup, commands and source layout    |
| [Testing](TESTING.md)                       | Automated checks, regression suites and test fixtures     |
| [Windows acceptance](WINDOWS_ACCEPTANCE.md) | Reusable native and authenticated-provider test checklist |
| [Contributing](../CONTRIBUTING.md)          | Review, coding and contribution conventions               |

## Understand the application

| Guide                                         | Contents                                                  |
| --------------------------------------------- | --------------------------------------------------------- |
| [Architecture](ARCHITECTURE.md)               | State ownership, storage, sessions and trust boundaries   |
| [Service startup](SERVICE_STARTUP.md)         | Sequential background loading and lifecycle guards        |
| [Providers](PROVIDERS.md)                     | Supported origins, capabilities and adding an integration |
| [Notifications and unread](NOTIFICATIONS.md)  | Arrival, read proof, permissions and native delivery      |
| [Theming](THEMING.md)                         | Theme bootstrap, scoped styles and appearance validation  |
| [Links and downloads](LINKS_AND_DOWNLOADS.md) | Navigation confirmation and authenticated file transfers  |

## Maintain and release

| Guide                                     | Contents                                                  |
| ----------------------------------------- | --------------------------------------------------------- |
| [Dependency policy](DEPENDENCY_POLICY.md) | Compatibility, audit gates and target-specific exceptions |
| [Updater](UPDATER.md)                     | Release selection, transport and installation lifecycle   |
| [Signing updates](UPDATER_SIGNING.md)     | Key setup, build modes and package verification           |
| [Release checklist](RELEASE_CHECKLIST.md) | Candidate validation, packaging and publication           |
| [Licensing](LICENSING.md)                 | Project license and third-party distribution obligations  |
| [Screenshots](screenshots/README.md)      | Asset provenance and capture conventions                  |
| [Security](../SECURITY.md)                | Trust boundaries and vulnerability reporting              |

## Documentation conventions

Keep these guides current with the code. Explain behavior, constraints and
reproducible steps using paths relative to the repository root. Use synthetic
accounts and public example URLs.

Put change-specific validation in the PR and user-facing changes in
[CHANGELOG.md](../CHANGELOG.md). Keep local session notes, raw logs, build receipts,
machine-specific paths and account test records outside the source checkout.
Do not commit credentials, provider profiles or private screenshots.
