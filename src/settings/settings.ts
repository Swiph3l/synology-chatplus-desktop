import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getSettings,
  saveSettings,
  type Settings,
  type Theme,
} from "../app/settings";
import { normalizeServer } from "../app/navigation";
import { applyTheme, bindShellTheme } from "../theme/theme";
import { notifications } from "../app/notifications";
import { updates } from "../app/updates";

export async function renderSettings() {
  const app = document.querySelector<HTMLElement>("#app")!;
  document.body.classList.add("settings-page");
  let original: Settings;
  try {
    original = await getSettings();
    await bindShellTheme();
  } catch {
    app.innerHTML =
      '<h1>Settings</h1><p role="alert">Could not load settings. Restart the application.</p>';
    return;
  }
  const firstRun = !original.serverUrl;
  document.body.classList.toggle("setup-page", firstRun);
  app.innerHTML = `
    <header class="page-header"><img class="brand" src="/chatplus.png" alt="" width="32" height="32"><h1>${firstRun ? "ChatPlus Desktop" : "Settings"}</h1></header>
    ${firstRun ? '<h2 class="connect-heading">Connect to ChatPlus</h2>' : ""}
    <form id="settings">
      ${firstRun ? "" : '<nav class="settings-tabs" aria-label="Settings categories"><button type="button" data-tab="general" aria-pressed="true">General</button><button type="button" data-tab="notifications" aria-pressed="false">Notifications</button><button type="button" data-tab="updates" aria-pressed="false">Updates</button></nav>'}
      <div data-panel="general">
      <fieldset class="server-section">${firstRun ? "" : "<legend>ChatPlus server</legend>"}<label for="server">Server URL</label><input id="server" type="url" required placeholder="https://example.com/chat/" autocomplete="url" spellcheck="false">${firstRun ? "" : "<small>Enter the URL of your ChatPlus installation.</small>"}</fieldset>
      ${
        firstRun
          ? ""
          : `
      <fieldset><legend>Appearance</legend><div class="preference-row"><label for="theme">Theme</label><select id="theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div></fieldset>
      <fieldset><legend>Startup</legend><label class="toggle"><input id="autostart" type="checkbox">${/Windows/i.test(navigator.userAgent) ? "Start with Windows" : "Start at login"}</label></fieldset>
      <fieldset><legend>Window</legend><label class="toggle"><input id="minimize" type="checkbox">Minimize to tray</label><label class="toggle"><input id="close" type="checkbox">Close to tray</label></fieldset>
      <fieldset><legend>Links</legend><label class="toggle"><input id="external" type="checkbox">Open external links in default browser</label></fieldset>`
      }
      </div>
      ${
        firstRun
          ? ""
          : `
      <div data-panel="notifications" hidden>
        <fieldset><legend>Notifications</legend>
          <label class="toggle"><input id="desktop-notifications" type="checkbox">Desktop notifications</label>
          <small id="notification-permission" role="status">Checking notification permission?</small>
          <button id="enable-notifications" type="button" class="secondary">Enable notifications</button>
          <button id="notification-settings" type="button" class="secondary" hidden>Open Windows notification settings</button>
          <label for="notification-preview">Notification preview</label>
          <select id="notification-preview"><option value="full">Full preview</option><option value="sender">Sender/chat only</option><option value="generic">Generic notification</option></select>
          <small>Previews may reveal private information on your lock screen. Sender/chat uses the title supplied by ChatPlus.</small>
        </fieldset>
        <fieldset><legend>Unread indicators</legend>
          <label class="toggle"><input id="unread-title" type="checkbox">Show unread count in title</label>
          <label class="toggle"><input id="unread-tray" type="checkbox">Show unread status in tray</label>
          <label class="toggle"><input id="notification-sound" type="checkbox">Play notification sound</label>
        </fieldset>
        <button id="test-notification" type="button" class="secondary">Send test notification</button>
      </div>
      <div data-panel="updates" hidden>
        <fieldset><legend>Updates</legend>
          <label class="toggle"><input id="automatic-updates" type="checkbox">Check for updates automatically</label>
          <label for="update-channel">Channel</label>
          <select id="update-channel"><option value="stable">Stable</option><option value="pre-release">Pre-release</option></select>
          <small>Automatic checks run after startup, then at most every six hours. Installation always requires confirmation.</small>
        </fieldset>
        <button id="check-updates" class="secondary" type="button">Check for Updates</button>
        <small id="update-configuration"></small>
      </div>`
      }
      <p id="status" role="status" aria-live="polite"></p>
      <div class="form-footer"><button id="save" type="submit">${firstRun ? "Connect" : "Save"}</button></div>
    </form>
    <footer><span>Unofficial community client.</span>${firstRun ? "" : '<button id="about" class="text-button" type="button">About</button>'}</footer>`;
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const theme = document.querySelector<HTMLSelectElement>("#theme");
  const status = document.getElementById("status")!;
  const button = document.querySelector<HTMLButtonElement>("#save")!;
  input("server").value = original.serverUrl;
  applyTheme(original.theme);
  if (theme) {
    theme.value = original.theme;
    input("autostart").checked = original.autostart;
    input("minimize").checked = original.minimizeToTray;
    input("close").checked = original.closeToTray;
    input("external").checked = original.externalLinks;
    input("desktop-notifications").checked = original.desktopNotifications;
    input("notification-sound").checked = original.notificationSound;
    input("unread-title").checked = original.unreadTitle;
    input("unread-tray").checked = original.unreadTray;
    input("automatic-updates").checked = original.automaticUpdates;
    (
      document.getElementById("notification-preview") as HTMLSelectElement
    ).value = original.notificationPreview;
    (document.getElementById("update-channel") as HTMLSelectElement).value =
      original.updateChannel;
    theme.addEventListener("change", () => applyTheme(theme.value as Theme));
  }
  for (const tab of document.querySelectorAll<HTMLButtonElement>(
    "[data-tab]",
  )) {
    tab.addEventListener("click", () => {
      for (const panel of document.querySelectorAll<HTMLElement>(
        "[data-panel]",
      ))
        panel.hidden = panel.dataset.panel !== tab.dataset.tab;
      for (const button of document.querySelectorAll<HTMLElement>("[data-tab]"))
        button.setAttribute("aria-pressed", String(button === tab));
    });
  }
  if (!firstRun) {
    const testButton = document.getElementById(
      "test-notification",
    ) as HTMLButtonElement;
    testButton.addEventListener("click", async () => {
      testButton.disabled = true;
      try {
        await notifications.sendTest(input("notification-sound").checked);
        status.textContent =
          "Test notification sent. Check Windows notifications if no banner appears.";
      } catch (error) {
        status.textContent =
          typeof error === "string"
            ? error
            : "Could not send the test notification.";
      } finally {
        testButton.disabled = false;
      }
    });
    const permission = document.getElementById("notification-permission")!;
    const enableButton = document.getElementById(
      "enable-notifications",
    ) as HTMLButtonElement;
    const systemButton = document.getElementById(
      "notification-settings",
    ) as HTMLButtonElement;
    let lastPermission:
      Awaited<ReturnType<typeof notifications.isPermissionGranted>> | undefined;
    const showPermission = (
      result: Awaited<ReturnType<typeof notifications.isPermissionGranted>>,
    ) => {
      lastPermission = result;
      const enabled =
        result.granted &&
        result.webviewState === "granted" &&
        input("desktop-notifications").checked;
      permission.textContent = `Desktop notifications: ${enabled ? "Enabled" : "Disabled"}. ${result.message}${result.webviewState === "denied" ? " ChatPlus WebView notifications are denied. Use Enable notifications after Windows access is available." : result.webviewState === "unavailable" ? " Open ChatPlus to check browser notification permission." : ""}`;
      systemButton.hidden =
        result.granted || !/Windows/i.test(navigator.userAgent);
      enableButton.hidden = enabled;
    };
    const refreshPermission = async () => {
      try {
        showPermission(await notifications.isPermissionGranted());
      } catch {
        permission.textContent = "Could not check notification permission.";
      }
    };
    const enable = async () => {
      enableButton.disabled = true;
      input("desktop-notifications").disabled = true;
      try {
        const result = await notifications.requestPermission();
        input("desktop-notifications").checked =
          result.granted && result.webviewState === "granted";
        showPermission(result);
        if (input("desktop-notifications").checked)
          status.textContent =
            "Permission is available. Save to enable desktop notifications.";
      } catch (error) {
        input("desktop-notifications").checked = false;
        status.textContent =
          typeof error === "string" ? error : "Could not enable notifications.";
        await refreshPermission();
      } finally {
        enableButton.disabled = false;
        input("desktop-notifications").disabled = false;
      }
    };
    enableButton.addEventListener("click", () => {
      void enable();
    });
    input("desktop-notifications").addEventListener("change", () => {
      if (input("desktop-notifications").checked) void enable();
      else if (lastPermission) showPermission(lastPermission);
    });
    systemButton.addEventListener("click", () => {
      void notifications.openSettings().catch(() => {
        status.textContent = "Could not open Windows notification settings.";
      });
    });
    window.addEventListener("focus", () => {
      void refreshPermission();
    });
    void refreshPermission();
    document.getElementById("check-updates")!.addEventListener("click", () => {
      void updates.checkForUpdates().catch(() => {
        status.textContent = "Unable to check for updates.";
      });
    });
    void updates
      .getState()
      .then((result) => {
        document.getElementById("update-configuration")!.textContent =
          result.configured
            ? "Updates are signature-verified before installation."
            : "Signed updates are not configured for this development build.";
      })
      .catch(() => {
        status.textContent = "Could not read update configuration.";
      });
  }
  const showError = async () => {
    try {
      const message = await invoke<string | null>("get_status");
      if (message) status.textContent = message;
    } catch {
      status.textContent = "Could not read application status.";
    }
  };
  await listen<Settings>("settings-changed", ({ payload }) => {
    original = payload;
    applyTheme(payload.theme);
    if (theme) {
      theme.value = payload.theme;
      input("autostart").checked = payload.autostart;
    }
  });
  await listen("operation-error", () => {
    void showError();
  });
  await showError();
  document.getElementById("about")?.addEventListener("click", () => {
    void invoke("show_about").catch(() => {
      status.textContent = "Could not open About.";
    });
  });
  document.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = "";
    try {
      await saveSettings({
        ...original,
        serverUrl: normalizeServer(input("server").value),
        ...(theme
          ? {
              theme: theme.value as Theme,
              autostart: input("autostart").checked,
              minimizeToTray: input("minimize").checked,
              closeToTray: input("close").checked,
              externalLinks: input("external").checked,
              desktopNotifications: input("desktop-notifications").checked,
              notificationPreview: (
                document.getElementById(
                  "notification-preview",
                ) as HTMLSelectElement
              ).value as Settings["notificationPreview"],
              notificationSound: input("notification-sound").checked,
              unreadTitle: input("unread-title").checked,
              unreadTray: input("unread-tray").checked,
              automaticUpdates: input("automatic-updates").checked,
              updateChannel: (
                document.getElementById("update-channel") as HTMLSelectElement
              ).value as Settings["updateChannel"],
            }
          : {}),
      });
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      button.disabled = false;
    }
  });
  if (firstRun) input("server").focus();
}
