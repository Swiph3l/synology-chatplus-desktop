---
name: chatplus-release-engineering
description: Prepare or validate a ChatPlus Desktop version, native installer, updater metadata or GitHub release. Use for this repository's synchronized identity and signed release workflow.
---

Read `docs/RELEASE_CHECKLIST.md`, `docs/UPDATER.md` and the affected workflow before
editing release behavior. `scripts/release-identity.mjs` is the executable source
identity contract. It compares all six version values:

- `package.json` version;
- `package-lock.json` root version and `packages[""].version`;
- `src-tauri/tauri.conf.json` version;
- `src-tauri/Cargo.toml` package version;
- the `chatplus-desktop` entry in `src-tauri/Cargo.lock`.

The tag must be exactly `v<version>`. A stable patch uses a plain SemVer without a
suffix. Write release notes about verified user behavior; do not turn operation
budgets or an installer build into a measured memory or CPU improvement.

`project.json` supplies the production public verification key.
`scripts/tauri-build-config.mjs` strips private signing credentials from ordinary
local builds. Preserve that boundary and the existing application/storage identity.
Never copy signing credentials into source, reports, test fixtures or tool output.

`.github/workflows/release.yml` builds from the exact event commit and checks tag
identity, required CI/security runs and target-specific dependency gates. Its
matrix covers Windows x64, Linux x64, macOS Apple Silicon and Intel. The source
glib backport is required: retain `security/glib-backport.json`, vendor licensing,
provenance/resolution checks and the Linux optimized iterator regression.

Every new GitHub release starts as a prerelease draft, including plain stable
version tags. Publication and clearing the GitHub prerelease flag are separate
maintainer actions after acceptance; that flag does not change SemVer. Preserve
the tested draft workflow. Do not replace a published tag or signed artifact to
repair a release; prepare a higher version when accepted bytes need code changes.

Run the applicable gates in `docs/TESTING.md`, including frontend tests/build and
release-asset checks, native checks and security/dependency gates. There is no
separate frontend lint command; Prettier and TypeScript are the existing checks.
Validate release policy changes with:

```sh
node --test tests/release.test.mjs tests/release-checks.test.mjs tests/workflow-policy.test.mjs
node --test tests/tauri-wrapper.test.mjs tests/updater-metadata.test.mjs tests/collect-release.test.mjs
```

The release-identity CLI requires a real tag-event context and signing input.
For local manifest-only validation, import and call `repositoryIdentity` with the
intended tag; do not manufacture workflow environment variables to claim a signed
release check passed. Record actual artifact paths/hashes and exact commit checks.
Keep Windows native acceptance, Linux/macOS native acceptance and installed signed
update checks pending until they actually run. Preserve experimental platform and
provider status where acceptance is incomplete.
