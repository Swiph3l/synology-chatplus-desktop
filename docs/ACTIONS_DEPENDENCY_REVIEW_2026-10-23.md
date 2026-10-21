# GitHub Actions dependency review, 23 October 2026

The open dependency PRs were compared with the current local workflows, including
the existing release/signing fixes. Changes were applied locally using official
release commit IDs. No PR was merged, pushed, commented on or otherwise changed.

| PR  | Action                                          | Reviewed release                                                          | Full commit ID                             |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| #11 | actions/checkout                                | [7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)          | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| #26 | actions/setup-node                              | [7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)        | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| #27 | actions/upload-artifact                         | [7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2)   | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| #28 | actions/download-artifact                       | [8.0.2](https://github.com/actions/download-artifact/releases/tag/v8.0.2) | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |
| #36 | github/codeql-action, init and analyze together | [4.39.0](https://github.com/github/codeql-action/releases/tag/v4.39.0)    | `6f2ac81f5cd81fe351a197ba0b00d91d03cd2aee` |

Official tag references were resolved through GitHub's API, including dereferencing
the annotated CodeQL tag. GitHub reports verified signatures for these release
commits. Action definitions, package manifests and release documentation were
inspected at the exact IDs. The read-only snapshots remain outside the repository
in `validation/pr-review-2026-10-23/actions-*-metadata.json`.

## Findings

- **PR #26 has unrelated history in its comparison.** Its approximately 720 KB
  diff includes existing application, release and documentation work. Only the
  intended setup-node update was carried onto the current workflows; the broad
  historical diff was not replayed.
- **PR #36 fails because it updates only init.** Its public
  [failed JavaScript analysis job](https://github.com/Swiph3l/synology-chatplus-desktop/actions/runs/39215978105/job/117939796513)
  reports that configuration from 4.39.0 was loaded by analyze 4.38.3. Both steps
  now use the same verified 4.39.0 commit, with a regression test enforcing this
  relationship. Checks were retained.
- **All reviewed action definitions run Node 24.** These updates do not migrate
  action execution to Node 26. The separate `node-version` input selects the Node
  executable used by npm/build commands. The published
  [setup-node compatibility guidance](https://github.com/actions/setup-node/tree/949feb2413d6458794dcd2491c4babbbce0c15c1#whats-new-in-v7)
  retains a minimum Node-24-capable Actions runner of 2.327.1. Existing jobs already
  use Node 24 actions on maintained GitHub-hosted runners.
- **Migration changes fit the current inputs.** Checkout's new unsafe fork-code
  opt-in is left disabled, and every checkout retains `persist-credentials: false`.
  The workflows use `pull_request`, not privileged fork-code triggers. Setup-node's
  removed dummy `NODE_AUTH_TOKEN` does not affect these jobs: they set no
  `registry-url`, private registry credentials or legacy `always-auth` input.
  CodeQL's new minimum bundle 2.20.7 is compatible with the existing automatic
  tool selection; no old custom bundle or nondefault checkout path is configured.

## Local workflow changes

The existing Windows Node 22 frontend/native job retains its exact release-gate
name and all native checks. A separate Ubuntu Node 24 job runs frontend install,
format, typecheck, tests, build and production-asset validation. It does not repeat
Rust builds or signing. Both frontend builds check for development-fixture leaks.

The signing/draft jobs disable setup-node package-manager caching. Their exact
event-commit checkouts, tag identity checks, successful-CI gate, production signing
and signature verification are preserved. Artifact upload explicitly keeps
archiving enabled, rejects missing files, excludes hidden files and forbids
overwrite. Download stays within the current run and named artifact, with
[`digest-mismatch: error`](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/action.yml)
so an integrity mismatch fails before updater metadata or draft release creation.

`tests/workflow-policy.test.mjs` checks immutable action references, checkout
credential handling, CodeQL version consistency, the Windows gate alongside
frontend-only Node 24 coverage, and release artifact/signing boundaries. Full
GitHub-hosted action execution still requires a future authorized push; local
policy/format/build tests do not establish a successful remote workflow run.
