# Automatic service startup

ChatPlus opens the saved selected service immediately. It then starts every other
enabled configured service in the saved rail order, with one background startup
worker. The next view starts after the previous document finishes loading, with
a minimum 750 ms between starts. An eight-second limit lets the queue continue
past an offline server or a login page that does not finish. Network activity in
an earlier view can continue after that limit; the queue does not wait for network
idle. Existing sessions are reused.

Background views start unfocused outside the window's client area and are hidden
before returning to their normal bounds. Startup does not select a service, write
preferences, reorder the rail, acknowledge unread messages, or manufacture desktop
notifications. Normal provider notifications still use the existing permission,
notification, and unread policies. Stable service IDs retain their existing profile
directories and authentication sessions.

Each queue step reads the current configuration. Disabled and removed services are
skipped; a changed URL or provider gets a new session identity. Native creation
reserves its stable label without holding the lifecycle lock while waiting on the
UI thread. Clicking that service during creation defers its explicit presentation
until the view is ready. Completion rechecks the current selection and identity;
it cannot focus a service after the user has switched away or left ChatPlus.
Shutdown cancels pending work and wakes the waiting worker.

Native model tests cover order, disabled accounts, separate profile identities,
load completion and timeout, configuration changes, manual activation, stale load
callbacks, failed attempts, shutdown wakeup, and offscreen staging. A Windows smoke
test on 23 October 2026 kept the selected Synology conversation visible while both
configured Discord instances acquired unread dots before either was selected;
opening the first Discord instance showed its already loaded session immediately.
Incoming-message delivery and further focus/paint acceptance remain separate checks.
