# Read lifecycle audit and implementation

## Before changes

Rust `unread::Tracking` owns the per-service state. Browser notification arrivals
latch unread before native delivery; mute, send success, dismissal and activation
are independent. The rail mirrors revisioned snapshots. `services::activate` saves
the stable service ID, shows/focuses its existing view and projects native foreground;
it does not directly invoke a clear operation.

The common renderer requires trusted conversation input and current native
foreground generation for acknowledgements. Exact message proofs retire individual
arrival tokens. A `provider-zero` proof can instead retire all completed arrivals.
Discord's selected/hovered guild branch inferred read from equality between the
guild accessible label and its name. That equality does not establish the read
state of every hidden channel/thread. Together with provider-zero retirement this
is a structural path to an overly broad clear. An authenticated reproduction of
the reported Windows symptom is still required; no private Discord API is used.

Native service context menus already target stable instance IDs, but contain only
open/mute/settings/rename/remove actions. There is no explicit read controller.
Synology ChatPlus and Synology Chat each have their own conversation viewport,
composer and provider-zero rules. Notification lifecycle is not unread lifecycle;
service activation is not mark-all-read.

## Read action boundaries

Read actions use provider controllers outside the generic rail. Explicit current
acknowledgement requires a mapped latest viewport and retires only exact visible
notification arrivals. It never falls back to provider-zero retirement. Unsupported
or unidentifiable conversations produce no clear. Explicit global acknowledgement
is local to ChatPlus, labelled accordingly, and never claims remote success.
WhatsApp global acknowledgement is disabled until a safe official UI action is
verified. New arrivals must restore unread after a local acknowledgement.

Discord documents Escape for the current channel and an Inbox-wide UI action:
[Windows hotkeys](https://support.discord.com/hc/en-us/articles/225977308--Windows-Discord-Hotkeys),
[Inbox FAQ](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ).
Escape can also dismiss editing/dialogs and Inbox markup is not authenticated in
this environment. Consequently no synthetic hotkey, guessed menu label, mass
sidebar click or private API is used to claim remote acknowledgement.
