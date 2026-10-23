# Autostart isolation audit, 23 October 2026

Preparing a fresh synthetic QA profile exposed an application integration gap:
all identifiers used the Windows Run/StartupApproved entry `ChatPlus Desktop`.
The autostart plugin checked that shared entry at startup, and enabled-state
reconciliation could repair its command to the current executable. A separate
Tauri identifier and fresh settings/profile directories did not isolate this
Windows setting. The existing entry was checked read-only; the QA application
was not launched and no registry value was changed by the preparation tools.

The plugin and Windows reconciliation now derive the same entry name from the
application identifier. The exact production identifier keeps `ChatPlus Desktop`
to preserve existing settings. Alternate identifiers use
`ChatPlus Desktop (<identifier>)`, isolating their enabled checks and both Run and
StartupApproved reads/writes. The synthetic profile can therefore retain its
saved disabled autostart state without adopting production's enabled entry.

The pure regression checks production-name compatibility, distinct alternate
identifiers and production-looking identifiers that must not use the legacy
name. This is not a registry-write integration test or authenticated provider
acceptance. The isolated QA artifact must be rebuilt with this source before it
is launched; its build receipt records the configuration and executable hash.

The focused native regression passed (one test, zero failures), as did the
isolated debug rebuild, scoped Rust formatting, documentation formatting and
diff checks. Preparation did not launch either QA executable. The original
pre-fix artifact is retained separately and must not be used for QA.
