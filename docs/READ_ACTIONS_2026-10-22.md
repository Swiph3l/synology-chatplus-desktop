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

## Follow-up, 23 October 2026

The preceding sections record the initial implementation boundary. Current service
menus group supported read commands under More and hide unsupported WhatsApp and
Messenger commands. Synology all-read remains explicitly local. Discord now has a
bounded public Inbox/Unreads read flow, scoped to the captured configured instance;
it never iterates channels or calls private APIs. The current Polish control names
were inspected in the authenticated Windows interface and have a dedicated regression.
The helper does not accept a disabled control alone as completed read: fresh complete
provider-zero evidence is required before acknowledging its captured local arrivals.
Ambiguity, provider confirmation, timeout or changed source identity preserves unread.

The latest milestone also removes the intervening exact local toast-click
acknowledgement. A toast click only restores the original instance and delegates
its provider's public click handler. Real provider/view proof or a separate explicit
read action remains necessary. [Current notification rules](NOTIFICATIONS.md) and
[the milestone report](MILESTONE_RELIABILITY_2026-10-23.md) distinguish automated
coverage from account-dependent Windows acceptance.
