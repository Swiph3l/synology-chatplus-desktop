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
import { mountUpdatePanel } from "../ui/update";
import { mountAboutPanel } from "../ui/about";
import { renderChangelog } from "./changelog";
import { localizeError, setLanguage, t, type Language } from "../i18n";
import { serviceEditor } from "./services";
import { providers, type ServiceConfig } from "../app/providers";
import { confirmServiceRemoval } from "../ui/service-removal";

export async function renderSettings() {
  const app = document.querySelector<HTMLElement>("#app")!;
  document.body.classList.add("settings-page");
  let original: Settings;
  try {
    original = await getSettings();
    await bindShellTheme();
  } catch {
    app.innerHTML = `<h1>${t("common.settings")}</h1><p role="alert">${t("settings.loadError")}</p>`;
    return;
  }
  setLanguage(original.language);
  const firstRun = !original.services.length;
  const serviceDraft = structuredClone(original.services);
  const notificationDraftEdits = new Set<string>();
  document.body.classList.toggle("setup-page", firstRun);
  app.innerHTML = `
    <header class="page-header"><img class="brand" src="/chatplus.png" alt="" width="32" height="32"><h1>${firstRun ? "ChatPlus Desktop" : t("common.settings")}</h1></header>
    ${firstRun ? `<h2 class="connect-heading">${t("settings.connectHeading")}</h2>` : ""}
    <form id="settings">
      ${firstRun ? "" : `<nav class="settings-tabs" role="tablist" aria-label="${t("settings.categories")}">${["general", "notifications", "updates", "services", "changelog", "about"].map((section, index) => `<button type="button" id="tab-${section}" role="tab" data-tab="${section}" aria-controls="panel-${section}" aria-selected="${index === 0}" aria-pressed="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${t(`common.${section}` as "common.general")}</button>`).join("")}</nav>`}
      <div class="settings-content">
      <div data-panel="general">
      <fieldset class="server-section">${firstRun ? "" : `<legend>${t("settings.server")}</legend>`}<label for="server">${t("settings.serverUrl")}</label><input id="server" type="url" required placeholder="https://example.com/chat/" autocomplete="url" spellcheck="false">${firstRun ? "" : `<small>${t("settings.serverHelp")}</small>`}</fieldset>
      ${
        firstRun
          ? ""
          : `
      <fieldset><legend>${t("settings.appearance")}</legend><div class="preference-row"><label for="theme">${t("settings.theme")}</label><select id="theme"><option value="system">${t("settings.system")}</option><option value="light">${t("settings.light")}</option><option value="dark">${t("settings.dark")}</option></select></div></fieldset>
      <fieldset><legend>${t("settings.language")}</legend><label for="language">${t("settings.language")}</label><select id="language"><option value="en">English</option><option value="pl">Polski</option><option value="es">Español</option></select><small>${t("settings.languageHelp")}</small></fieldset>
      <fieldset><legend>${t("settings.startup")}</legend><label class="toggle"><input id="autostart" type="checkbox">${/Windows/i.test(navigator.userAgent) ? t("settings.startWindows") : t("settings.startLogin")}</label></fieldset>
      <fieldset><legend>${t("settings.window")}</legend><label class="toggle"><input id="minimize" type="checkbox">${t("settings.minimizeTray")}</label><label class="toggle"><input id="close" type="checkbox">${t("settings.closeTray")}</label></fieldset>
      <fieldset><legend>${t("settings.links")}</legend><label class="toggle"><input id="external" type="checkbox">${t("settings.externalLinks")}</label></fieldset>`
      }
      </div>
      ${
        firstRun
          ? ""
          : `
      <div data-panel="notifications" hidden>
        <fieldset><legend>${t("common.notifications")}</legend>
          <label class="toggle"><input id="desktop-notifications" type="checkbox">${t("notifications.desktop")}</label>
          <small id="notification-permission" role="status">${t("notifications.checkingPermission")}</small>
          <button id="enable-notifications" type="button" class="secondary">${t("notifications.enable")}</button>
          <button id="notification-settings" type="button" class="secondary" hidden>${t("notifications.windowsSettings")}</button>
          <label for="notification-preview">${t("notifications.preview")}</label>
          <select id="notification-preview"><option value="full">${t("notifications.full")}</option><option value="sender">${t("notifications.sender")}</option><option value="generic">${t("notifications.generic")}</option></select>
          <label for="notification-cooldown">${t("notifications.cooldown")}</label>
          <select id="notification-cooldown"><option value="0">${t("notifications.noCooldown")}</option>${[30, 60, 90].map((seconds) => `<option value="${seconds}">${t("notifications.seconds", { seconds })}</option>`).join("")}</select>
          <small>${t("notifications.cooldownHelp")}</small>
          <small>${t("notifications.privacyHelp")}</small>
        </fieldset>
        <small>${t("notifications.serviceMuteHelp")}</small>
        <fieldset><legend>${t("notifications.unread")}</legend>
          <label class="toggle"><input id="unread-title" type="checkbox">${t("notifications.title")}</label>
          <label class="toggle"><input id="unread-tray" type="checkbox">${t("notifications.tray")}</label>
          <label class="toggle"><input id="notification-sound" type="checkbox">${t("notifications.sound")}</label>
        </fieldset>
        <button id="test-notification" type="button" class="secondary">${t("notifications.test")}</button>
      </div>
      <div data-panel="services" hidden><div id="service-editor"></div><button id="add-service" class="secondary" type="button">${t("services.add")}</button><small>${t("services.help")}</small></div>
      <div data-panel="updates" hidden>
        <fieldset><legend>${t("common.updates")}</legend>
          <label class="toggle"><input id="automatic-updates" type="checkbox">${t("updates.automatic")}</label>
          <label for="update-channel">${t("updates.channel")}</label>
          <select id="update-channel"><option value="stable">${t("updates.stable")}</option><option value="pre-release">${t("updates.preRelease")}</option></select>
          <small id="channel-description"></small>
          <small>${t("updates.scheduleHelp")}</small>
        </fieldset>
        <div id="update-details"></div>
      </div>
      <div data-panel="changelog" hidden><div id="changelog-content"></div></div>
      <div data-panel="about" hidden><div id="about-content"></div></div>`
      }
      </div>
      <p id="status" role="status" aria-live="polite"></p>
      <div class="form-footer"><button id="close-settings" type="button" class="secondary">${t("common.close")}</button><button id="save" type="submit">${firstRun ? t("settings.connect") : t("common.save")}</button></div>
      <p id="save-feedback" aria-live="polite"></p>
    </form>
    <footer><span>${t("settings.community")}</span></footer>`;
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const theme = document.querySelector<HTMLSelectElement>("#theme");
  const status = document.getElementById("status")!;
  const button = document.querySelector<HTMLButtonElement>("#save")!;
  const saveFeedback = document.getElementById("save-feedback")!;
  let persistencePending = false;
  const lockedControls = new Map<
    HTMLInputElement | HTMLSelectElement,
    boolean
  >();
  const setPersistencePending = (pending: boolean) => {
    persistencePending = pending;
    button.disabled = pending;
    const add = document.getElementById(
      "add-service",
    ) as HTMLButtonElement | null;
    if (add) add.disabled = pending;
    for (const remove of document.querySelectorAll<HTMLButtonElement>(
      ".service-removal button",
    ))
      remove.disabled = pending;
    // Swiph3l: IPC captures the saved draft before awaiting persistence; lock edits so a successful language reload cannot discard newer input.
    if (pending) {
      for (const control of app.querySelectorAll<
        HTMLInputElement | HTMLSelectElement
      >("input, select")) {
        if (!lockedControls.has(control))
          lockedControls.set(control, control.disabled);
        control.disabled = true;
      }
    } else {
      for (const [control, disabled] of lockedControls)
        if (control.isConnected) control.disabled = disabled;
      lockedControls.clear();
    }
  };
  let saveFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const clearSaveFeedback = () => {
    if (saveFeedbackTimer) {
      clearTimeout(saveFeedbackTimer);
      saveFeedbackTimer = undefined;
    }
    saveFeedback.classList.remove("visible");
    saveFeedback.textContent = "";
  };
  const showSaveFeedback = (text: string) => {
    clearSaveFeedback();
    saveFeedback.textContent = text;
    saveFeedback.classList.add("visible");
    saveFeedbackTimer = setTimeout(() => {
      saveFeedback.classList.remove("visible");
      saveFeedbackTimer = undefined;
      setTimeout(() => {
        if (!saveFeedback.classList.contains("visible")) {
          saveFeedback.textContent = "";
        }
      }, 150);
    }, 2400);
  };
  input("server").value = original.serverUrl;
  const configureServerField = (service?: ServiceConfig) => {
    const definition = providers[service?.provider ?? "synology-chatplus"];
    const section = document.querySelector<HTMLElement>(".server-section")!;
    // Swiph3l: Services owns provider URL editing; this hidden legacy field only synchronizes the active URL for migration/save.
    section.hidden = !firstRun;
    input("server").required = firstRun;
    if (!firstRun) {
      section.querySelector("label")!.textContent = t(
        definition.urlMode === "workspace"
          ? "settings.workspaceUrl"
          : "settings.serverUrl",
      );
      section.querySelector("legend")!.textContent = t(
        definition.urlMode === "workspace"
          ? "settings.providerWorkspace"
          : "settings.providerServer",
        { provider: definition.name },
      );
      section.querySelector("small")!.textContent =
        definition.urlMode === "workspace"
          ? t("settings.workspaceHelp")
          : t("settings.installationHelp");
    }
  };
  configureServerField(
    original.services.find((s) => s.id === original.activeService),
  );
  document.getElementById("close-settings")!.addEventListener("click", () => {
    void invoke("close_settings");
  });
  if (!firstRun) {
    const add = serviceEditor(
      document.getElementById("service-editor")!,
      serviceDraft,
      (service) => {
        if (service.id === original.activeService) {
          input("server").value = service.url;
          configureServerField(service);
        }
      },
      async (service) => {
        if (persistencePending) return false;
        setPersistencePending(true);
        try {
          if (!(await confirmServiceRemoval(service.name))) return false;
          if (original.services.some((item) => item.id === service.id)) {
            await invoke("remove_service", { id: service.id, confirmed: true });
          }
          status.textContent = t("services.removed");
          return true;
        } catch (error) {
          status.textContent = localizeError(error, "services.removeError");
          // Swiph3l: Persistence can succeed while closing a native view fails. Reflect the
          // saved configuration and retain the restart warning rather than resurrecting it.
          try {
            const saved = await getSettings();
            if (!saved.services.some((item) => item.id === service.id))
              return true;
          } catch {
            /* Keep the draft if the persisted state cannot be verified. */
          }
          return false;
        } finally {
          setPersistencePending(false);
        }
      },
    );
    document.getElementById("add-service")!.addEventListener("click", () => {
      if (!persistencePending) add();
    });
    document
      .getElementById("service-editor")!
      .addEventListener("change", (event) => {
        const control = event.target as HTMLInputElement;
        const service = serviceDraft.find(
          (item) => control.id === `service-${item.id}-notifications`,
        );
        if (service) notificationDraftEdits.add(service.id);
        // Provider changes can replace the row while a save is in flight.
        if (persistencePending) setPersistencePending(true);
      });
    input("server").addEventListener("input", () => {
      const active = serviceDraft.find((s) => s.id === original.activeService);
      if (active) active.url = input("server").value;
    });
  }
  applyTheme(original.theme);
  if (theme) {
    theme.value = original.theme;
    (document.getElementById("language") as HTMLSelectElement).value =
      original.language ?? "en";
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
    (
      document.getElementById("notification-cooldown") as HTMLSelectElement
    ).value = String(original.notificationCooldown);
    (document.getElementById("update-channel") as HTMLSelectElement).value =
      original.updateChannel;
    const channel = document.getElementById(
      "update-channel",
    ) as HTMLSelectElement;
    const describeChannel = () => {
      document.getElementById("channel-description")!.textContent =
        channel.value === "stable"
          ? t("updates.stableHelp")
          : t("updates.preReleaseHelp");
    };
    channel.addEventListener("change", describeChannel);
    describeChannel();
    theme.addEventListener("change", () => applyTheme(theme.value as Theme));
  }
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  const showSection = (section: string) =>
    tabs.find((tab) => tab.dataset.tab === section)?.click();
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const panel of document.querySelectorAll<HTMLElement>(
        "[data-panel]",
      ))
        panel.hidden = panel.dataset.panel !== tab.dataset.tab;
      for (const button of document.querySelectorAll<HTMLElement>(
        "[data-tab]",
      )) {
        button.setAttribute("aria-pressed", String(button === tab));
        button.setAttribute("aria-selected", String(button === tab));
        button.tabIndex = button === tab ? 0 : -1;
      }
    });
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      const next =
        event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : -1;
      if (next < 0) return;
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    });
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.id = `panel-${panel.dataset.panel}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${panel.dataset.panel}`);
  }
  await listen<string>("settings-section-requested", ({ payload }) =>
    showSection(payload),
  );
  if (typeof location !== "undefined")
    showSection(
      new URLSearchParams(location.search).get("section") ?? "general",
    );
  if (!firstRun) {
    renderChangelog(document.getElementById("changelog-content")!);
    await mountAboutPanel(document.getElementById("about-content")!);
    await mountUpdatePanel(document.getElementById("update-details")!);
    const testButton = document.getElementById(
      "test-notification",
    ) as HTMLButtonElement;
    testButton.addEventListener("click", async () => {
      testButton.disabled = true;
      try {
        await notifications.sendTest(input("notification-sound").checked);
        status.textContent = t("notifications.testSent");
      } catch (error) {
        status.textContent = localizeError(error, "notifications.testError");
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
      const desktopState =
        result.state === "enabled"
          ? t("common.enabled")
          : result.state === "not-registered"
            ? t("notifications.notRegistered")
            : result.state === "blocked"
              ? t("common.blocked")
              : t("common.unavailable");
      const webviewState =
        result.webviewState === "granted"
          ? t("common.allowed")
          : result.webviewState === "denied"
            ? t("common.blocked")
            : result.webviewState === "unavailable"
              ? t("common.unavailable")
              : t("common.unknown");
      permission.textContent = t("notifications.permissionSummary", {
        desktop: desktopState,
        message: localizeError(result.message),
        webview: webviewState,
      });
      systemButton.hidden =
        result.state === "enabled" || !/Windows/i.test(navigator.userAgent);
      enableButton.hidden =
        result.state === "enabled" && result.webviewState === "granted";
    };
    const refreshPermission = async () => {
      try {
        showPermission(await notifications.isPermissionGranted());
      } catch {
        permission.textContent = t("notifications.permissionError");
      }
    };
    const enable = async () => {
      enableButton.disabled = true;
      input("desktop-notifications").disabled = true;
      try {
        const result = await notifications.requestPermission();
        input("desktop-notifications").checked = result.granted;
        showPermission(result);
        if (input("desktop-notifications").checked)
          status.textContent = t("notifications.permissionAvailable");
      } catch (error) {
        input("desktop-notifications").checked = false;
        status.textContent = localizeError(error, "notifications.enableError");
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
        status.textContent = t("notifications.windowsError");
      });
    });
    window.addEventListener("focus", () => {
      void refreshPermission();
    });
    void refreshPermission();
  }
  const showError = async () => {
    try {
      const message = await invoke<string | null>("get_status");
      if (message) status.textContent = localizeError(message);
    } catch {
      status.textContent = t("settings.statusError");
    }
  };
  await listen<Settings>("settings-changed", ({ payload }) => {
    setLanguage(payload.language);
    window.dispatchEvent(new window.Event("language-changed"));
    // Swiph3l: Context-menu mute updates persisted state; untouched drafts follow it,
    // but retain a user's explicit unsaved checkbox edit.
    for (const draft of serviceDraft) {
      const before = original.services.find(
        (service) => service.id === draft.id,
      );
      const after = payload.services.find((service) => service.id === draft.id);
      if (
        before &&
        after &&
        draft.provider === after.provider &&
        !notificationDraftEdits.has(draft.id) &&
        draft.notifications === before.notifications
      )
        draft.notifications = after.notifications;
      const checkbox = document.getElementById(
        `service-${draft.id}-notifications`,
      ) as HTMLInputElement | null;
      if (checkbox) checkbox.checked = draft.notifications;
    }
    if (payload.activeService !== original.activeService) {
      input("server").value =
        serviceDraft.find((service) => service.id === payload.activeService)
          ?.url ?? payload.serverUrl;
    }
    configureServerField(
      payload.services.find((s) => s.id === payload.activeService),
    );
    if (theme) {
      // Swiph3l: Immediate service actions must not discard unrelated unsaved General preferences.
      if (theme.value === original.theme) theme.value = payload.theme;
      if (input("autostart").checked === original.autostart)
        input("autostart").checked = payload.autostart;
      applyTheme(theme.value as Theme);
    } else applyTheme(payload.theme);
    original = payload;
  });
  await listen("operation-error", () => {
    void showError();
  });
  await showError();
  const showServiceSettings = async () => {
    const target = await invoke<{
      id: string;
      field: "settings" | "name" | "notifications" | "remove";
    } | null>("take_service_settings_target");
    if (!target) return;
    const control = document.getElementById(
      `service-${target.id}-${target.field}`,
    );
    if (!control) {
      status.textContent = t("services.unavailableDraft");
      return;
    }
    document.querySelector<HTMLButtonElement>('[data-tab="services"]')?.click();
    document
      .getElementById(`service-${target.id}-settings`)
      ?.scrollIntoView({ block: "start" });
    control.focus({ preventScroll: true });
    if (target.field === "name") (control as HTMLInputElement).select();
    if (target.field === "remove") (control as HTMLButtonElement).click();
  };
  await listen("service-settings-requested", () => {
    void showServiceSettings().catch(() => {
      status.textContent = t("services.settingsError");
    });
  });
  await showServiceSettings();
  document.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (persistencePending) return;
    const restoreSaveFocus = document.activeElement === button;
    const previousLanguage = original.language ?? "en";
    setPersistencePending(true);
    status.textContent = "";
    clearSaveFeedback();
    try {
      await saveSettings({
        ...original,
        services: serviceDraft,
        serviceSchema: firstRun ? 0 : original.serviceSchema,
        serverUrl: input("server").value
          ? normalizeServer(input("server").value)
          : "",
        ...(theme
          ? {
              theme: theme.value as Theme,
              language: (
                document.getElementById("language") as HTMLSelectElement
              ).value as Language,
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
              notificationCooldown: Number(
                (
                  document.getElementById(
                    "notification-cooldown",
                  ) as HTMLSelectElement
                ).value,
              ) as Settings["notificationCooldown"],
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
      notificationDraftEdits.clear();
      // Swiph3l: Saving no longer closes this page, so users can tweak several sections without reopening Settings.
      showSaveFeedback(
        firstRun ? t("settings.saved") : t("settings.savedContinue"),
      );
      if (
        theme &&
        previousLanguage !==
          (document.getElementById("language") as HTMLSelectElement).value &&
        typeof location !== "undefined"
      ) {
        // Swiph3l: Reload translations only after the complete draft is persisted, so changing language cannot discard unsaved services or preferences.
        const section =
          document.querySelector<HTMLElement>(
            '[data-tab][aria-selected="true"]',
          )?.dataset.tab ?? "general";
        window.history.replaceState(null, "", `?section=${section}`);
        location.reload();
      }
    } catch (error) {
      status.textContent = localizeError(error);
    } finally {
      setPersistencePending(false);
      if (restoreSaveFocus) button.focus();
    }
  });
  if (firstRun) input("server").focus();
}
