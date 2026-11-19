# Chat+ Desktop artwork

The project-supplied `chat-plus-master.png` is the original 1254 × 1254 RGBA artwork shared with Chat+ Mobile. The transparent `chat-plus-flat.png` crops the same bubble and removes its outer glow so the plus and three dots remain distinct in the tray and at small sizes.

Run `python scripts/export-app-icons.py` with Python 3.10+ and Pillow 13+ from the checkout to rebuild the shell PNG, Tauri PNGs, Windows ICO and macOS ICNS. Native launchers use the clean color mark at 82% of the canvas from 128 px upward. Smaller frames give it more space for legibility.

The shell uses `public/chatplus.png` for its rail, panels and favicon. The native window, taskbar, Dock, Linux launcher and Windows installer use `src-tauri/icons`. The tray uses the 64 px flat image in normal and unread states. Service marks have separate attribution in [NOTICE](../../NOTICE).

The Tauri packaging name `ChatPlus Desktop` identifies existing install directories, NSIS upgrade records and Linux packages. The app displays **Chat+ Desktop**. The [first-run screen](../../docs/screenshots/chat-plus-onboarding.png) shows the integrated icon on Windows. Earlier captures are listed in the [screenshot archive](../../docs/screenshots/README.md).
