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
import {
  languageNames,
  localizeError,
  setLanguage,
  t,
  type Language,
} from "../i18n";
import { serviceEditor } from "./services";
import { renderOnboarding } from "./onboarding";
import {
  providers,
  serviceSupportsNotifications,
  type ServiceConfig,
} from "../app/providers";
import { normalizeNotificationColor } from "../app/notification-colors";

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
  const readFixtureServiceIds = async (): Promise<string[] | undefined> => {
    const ids = await invoke<unknown>(
      "get_validation_fixture_service_ids",
    ).catch(() => undefined);
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : undefined;
  };
  const fixtureServiceIds = new Set((await readFixtureServiceIds()) ?? []);
  const supportsNotifications = (
    service: Pick<ServiceConfig, "id" | "provider" | "url">,
  ) => serviceSupportsNotifications(service, fixtureServiceIds);
  setLanguage(original.language);
  if (original.onboardingCompleted === false) {
    applyTheme(original.theme);
    renderOnboarding(app, original, supportsNotifications);
    return;
  }
  const serviceDraft = structuredClone(original.services);
  const notificationDraftEdits = new Set<string>();
  document.body.classList.remove("setup-page", "onboarding-page");
  app.innerHTML = `
    <header class="page-header"><img class="brand" src="/chatplus.png" alt="" width="32" height="32"><h1>${t("common.settings")}</h1></header>
    <form id="settings">
      <nav class="settings-tabs" role="tablist" aria-label="${t("settings.categories")}">${["general", "notifications", "updates", "services", "changelog", "about"].map((section, index) => `<button type="button" id="tab-${section}" role="tab" data-tab="${section}" aria-controls="panel-${section}" aria-selected="${index === 0}" aria-pressed="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${t(`common.${section}` as "common.general")}</button>`).join("")}</nav>
      <div class="settings-content">
      <div data-panel="general">
      <fieldset class="server-section"><legend>${t("settings.server")}</legend><label for="server">${t("settings.serverUrl")}</label><input id="server" type="url" required placeholder="https://example.com/chat/" autocomplete="url" spellcheck="false"><small>${t("settings.serverHelp")}</small></fieldset>
      <fieldset><legend>${t("settings.appearance")}</legend><div class="settings-appearance-controls"><div><label for="theme">${t("settings.theme")}</label><select id="theme"><option value="system">${t("settings.system")}</option><option value="light">${t("settings.light")}</option><option value="dark">${t("settings.dark")}</option></select></div><div><label for="language">${t("settings.language")}</label><select id="language" aria-describedby="language-help">${Object.entries(
        languageNames,
      )
        .map(([code, name]) => `<option value="${code}">${name}</option>`)
        .join(
          "",
        )}</select></div></div><small id="language-help">${t("settings.languageHelp")}</small></fieldset>
      <fieldset><legend>${t("settings.startup")}</legend><label class="toggle"><input id="autostart" type="checkbox">${/Windows/i.test(navigator.userAgent) ? t("settings.startWindows") : t("settings.startLogin")}</label></fieldset>
      <fieldset><legend>${t("settings.window")}</legend><label class="toggle"><input id="minimize" type="checkbox">${t("settings.minimizeTray")}</label><label class="toggle"><input id="close" type="checkbox">${t("settings.closeTray")}</label><label class="toggle"><input id="external" type="checkbox">${t("settings.externalLinks")}</label></fieldset>
      </div>
      <div data-panel="notifications" hidden>
        <fieldset><legend>${t("common.notifications")}</legend>
          <label class="toggle"><input id="desktop-notifications" type="checkbox">${t("notifications.desktop")}</label>
          <small id="notification-permission" role="status">${t("notifications.checkingPermission")}</small>
          <button id="enable-notifications" type="button" class="secondary">${t("notifications.enable")}</button>
          <button id="notification-settings" type="button" class="secondary" hidden>${t("notifications.windowsSettings")}</button>
          <label for="notification-preview">${t("notifications.preview")}</label>
          <select id="notification-preview"><option value="full">${t("notifications.full")}</option><option value="sender">${t("notifications.sender")}</option><option value="generic">${t("notifications.generic")}</option></select>
          <small>${t("notifications.privacyHelp")}</small>
          <small>${t("notifications.serviceMuteHelp")}</small>
        </fieldset>
        <fieldset><legend>${t("notifications.unread")}</legend>
          <label class="toggle"><input id="unread-title" type="checkbox">${t("notifications.title")}</label>
          <label class="toggle"><input id="unread-tray" type="checkbox">${t("notifications.tray")}</label>
          <label class="toggle"><input id="notification-sound" type="checkbox">${t("notifications.sound")}</label>
        </fieldset>
        <button id="test-notification" type="button" class="secondary">${t("notifications.test")}</button>
      </div>
      <div data-panel="services" hidden>
        <div class="services-heading"><div><h2>${t("common.services")}</h2><p>${t("services.description")}</p></div><button id="add-service" class="secondary" type="button"><span aria-hidden="true">+</span> ${t("services.add")}</button></div>
        <div id="service-editor"></div><small class="services-help">${t("services.help")}</small>
      </div>
      <div data-panel="updates" hidden>
        <fieldset><legend>${t("common.updates")}</legend>
          <label class="toggle"><input id="automatic-updates" type="checkbox">${t("updates.automatic")}</label>
          <label class="toggle"><input id="include-beta-updates" type="checkbox" aria-describedby="beta-updates-description">${t("updates.includeBeta")}</label>
          <small id="beta-updates-description">${t("updates.betaHelp")}</small>
          <small>${t("updates.scheduleHelp")}</small>
        </fieldset>
        <div id="update-details"></div>
      </div>
      <div data-panel="changelog" hidden><div id="changelog-content"></div></div>
      <div data-panel="about" hidden><div id="about-content"></div></div>
      </div>
      <p id="status" role="status" aria-live="polite"></p>
      <div class="form-footer"><div class="settings-save-state" role="status" aria-live="polite" aria-atomic="true"><span id="draft-status"></span><p id="save-feedback" hidden></p></div><button id="close-settings" type="button" class="secondary">${t("common.close")}</button><button id="save" type="submit">${t("common.save")}</button></div>
    </form>`;
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const theme = document.querySelector<HTMLSelectElement>("#theme");
  const status = document.getElementById("status")!;
  const button = document.querySelector<HTMLButtonElement>("#save")!;
  const saveFeedback = document.getElementById("save-feedback")!;
  const draftStatus = document.getElementById("draft-status")!;
  const settingsForm = document.querySelector<HTMLFormElement>("#settings")!;
  settingsForm.addEventListener("submit", (event) => event.preventDefault());
  button.disabled = true;
  let readyToSave = false;
  let persistencePending = false;
  let serviceManager: ReturnType<typeof serviceEditor> | undefined;
  let fixtureCapabilityRevision = 0;
  const refreshFixtureCapabilities = async () => {
    const revision = ++fixtureCapabilityRevision;
    const ids = await readFixtureServiceIds();
    if (!ids || fixtureCapabilityRevision !== revision) return;
    const next = new Set(ids);
    if (
      next.size === fixtureServiceIds.size &&
      [...next].every((id) => fixtureServiceIds.has(id))
    )
      return;
    fixtureServiceIds.clear();
    for (const id of next) fixtureServiceIds.add(id);
    serviceManager?.refresh();
  };
  let updateDirty = () => {};
  let pendingSettings: Settings | undefined;
  let settingsEventRevision = 0;
  let permissionPending = false;
  let externalConflict = false;
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
    (document.getElementById("close-settings") as HTMLButtonElement).disabled =
      pending;
    const enableNotifications = document.getElementById(
      "enable-notifications",
    ) as HTMLButtonElement | null;
    if (enableNotifications)
      enableNotifications.disabled = pending || permissionPending;
    serviceManager?.setDisabled(pending);
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
    updateDirty();
  };
  let saveFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const clearSaveFeedback = () => {
    if (saveFeedbackTimer) {
      clearTimeout(saveFeedbackTimer);
      saveFeedbackTimer = undefined;
    }
    saveFeedback.classList.remove("visible");
    saveFeedback.textContent = "";
    saveFeedback.hidden = true;
    draftStatus.hidden = false;
  };
  const showSaveFeedback = (text: string) => {
    clearSaveFeedback();
    saveFeedback.textContent = text;
    saveFeedback.hidden = false;
    draftStatus.hidden = true;
    saveFeedback.classList.add("visible");
    saveFeedbackTimer = setTimeout(() => {
      saveFeedback.classList.remove("visible");
      saveFeedbackTimer = undefined;
      setTimeout(() => {
        if (!saveFeedback.classList.contains("visible")) {
          saveFeedback.textContent = "";
          saveFeedback.hidden = true;
          draftStatus.hidden = false;
        }
      }, 150);
    }, 2400);
  };
  input("server").value = original.serverUrl;
  const configureServerField = (service?: ServiceConfig) => {
    const definition = providers[service?.provider ?? "synology-chatplus"];
    const section = document.querySelector<HTMLElement>(".server-section")!;
    // Swiph3l: Services owns provider URL editing; this hidden legacy field only synchronizes the active URL for migration/save.
    section.hidden = true;
    input("server").required = false;
    {
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
  {
    serviceManager = serviceEditor(
      document.getElementById("service-editor")!,
      serviceDraft,
      (change) => {
        if (change?.notificationServiceId)
          notificationDraftEdits.add(change.notificationServiceId);
        clearSaveFeedback();
        updateDirty();
      },
      supportsNotifications,
    );
    document.getElementById("add-service")!.addEventListener("click", () => {
      if (!persistencePending) serviceManager?.add();
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
    input("include-beta-updates").checked = original.includeBetaUpdates;
    (
      document.getElementById("notification-preview") as HTMLSelectElement
    ).value = original.notificationPreview;
    theme.addEventListener("change", () => applyTheme(theme.value as Theme));
  }
  const preferenceControls = [
    ["theme", "theme"],
    ["language", "language"],
    ["autostart", "autostart"],
    ["minimize", "minimizeToTray"],
    ["close", "closeToTray"],
    ["external", "externalLinks"],
    ["desktop-notifications", "desktopNotifications"],
    ["notification-preview", "notificationPreview"],
    ["notification-sound", "notificationSound"],
    ["unread-title", "unreadTitle"],
    ["unread-tray", "unreadTray"],
    ["automatic-updates", "automaticUpdates"],
    ["include-beta-updates", "includeBetaUpdates"],
  ] as const;
  const hydratePreferences = (settings: Settings) => {
    for (const [id, key] of preferenceControls) {
      const control = document.getElementById(id) as
        HTMLInputElement | HTMLSelectElement | null;
      if (!control) continue;
      if (typeof settings[key] === "boolean")
        (control as HTMLInputElement).checked = settings[key] as boolean;
      else control.value = String(settings[key]);
    }
    applyTheme(settings.theme);
  };
  const readDraft = (): Settings => ({
    ...original,
    services: structuredClone(serviceDraft),
    serverUrl:
      serviceDraft.find((service) => service.id === original.activeService)
        ?.url ?? "",
    ...(theme
      ? {
          theme: theme.value as Theme,
          language: (document.getElementById("language") as HTMLSelectElement)
            .value as Language,
          autostart: input("autostart").checked,
          minimizeToTray: input("minimize").checked,
          closeToTray: input("close").checked,
          externalLinks: input("external").checked,
          desktopNotifications: input("desktop-notifications").checked,
          notificationPreview: (
            document.getElementById("notification-preview") as HTMLSelectElement
          ).value as Settings["notificationPreview"],
          notificationSound: input("notification-sound").checked,
          unreadTitle: input("unread-title").checked,
          unreadTray: input("unread-tray").checked,
          automaticUpdates: input("automatic-updates").checked,
          includeBetaUpdates: input("include-beta-updates").checked,
        }
      : {}),
  });
  const serviceKey = (service: ServiceConfig) =>
    JSON.stringify({
      id: service.id,
      provider: service.provider,
      name: service.name,
      url: service.url,
      enabled: service.enabled,
      notifications: service.notifications,
      notificationColor: normalizeNotificationColor(service.notificationColor),
    });
  const settingsKey = (settings: Settings) =>
    JSON.stringify({
      services: settings.services.map(serviceKey),
      theme: settings.theme,
      language: settings.language,
      autostart: settings.autostart,
      minimizeToTray: settings.minimizeToTray,
      closeToTray: settings.closeToTray,
      externalLinks: settings.externalLinks,
      automaticUpdates: settings.automaticUpdates,
      includeBetaUpdates: settings.includeBetaUpdates,
      desktopNotifications: settings.desktopNotifications,
      notificationPreview: settings.notificationPreview,
      notificationSound: settings.notificationSound,
      unreadTitle: settings.unreadTitle,
      unreadTray: settings.unreadTray,
    });
  updateDirty = () => {
    const dirty = settingsKey(readDraft()) !== settingsKey(original);
    const label = document.getElementById("draft-status")!;
    label.textContent = t(
      dirty ? "settings.unsavedChanges" : "settings.noChanges",
    );
    label.classList.toggle("has-unsaved", dirty);
    const add = document.getElementById(
      "add-service",
    ) as HTMLButtonElement | null;
    if (add) {
      add.disabled = persistencePending || serviceDraft.length >= 12;
      add.title = t(
        serviceDraft.length >= 12 ? "services.limit" : "services.add",
      );
    }
    button.disabled =
      !readyToSave ||
      persistencePending ||
      permissionPending ||
      externalConflict ||
      !dirty;
    window.dispatchEvent(new Event("settings-draft-changed"));
  };
  for (const eventName of ["input", "change"])
    settingsForm.addEventListener(eventName, () => {
      clearSaveFeedback();
      updateDirty();
    });
  updateDirty();
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  let updateSummary: HTMLElement | null = null;
  let updateFocusPending = false;
  const cancelUpdateFocus = () => {
    updateFocusPending = false;
  };
  const focusUpdateSection = () => {
    if (!updateFocusPending || !updateSummary) return;
    updateFocusPending = false;
    if (
      document.getElementById("panel-updates")?.hidden ||
      document.querySelector("dialog[open]")
    )
      return;
    updateSummary.focus({ preventScroll: true });
    updateSummary.scrollIntoView({ block: "nearest" });
  };
  const showSection = (section: string) => {
    cancelUpdateFocus();
    const tab = tabs.find((tab) => tab.dataset.tab === section);
    if (!tab) return;
    tab.click();
    if (section === "updates") {
      updateFocusPending = true;
      focusUpdateSection();
    }
  };
  // Updates mounts asynchronously. A later response must not take focus after
  // someone has started using another control or left this window.
  const focusCancelEvents = ["pointerdown", "keydown", "click", "focusin"];
  for (const event of focusCancelEvents)
    document.addEventListener(event, cancelUpdateFocus, true);
  window.addEventListener("blur", cancelUpdateFocus);
  window.addEventListener(
    "pagehide",
    () => {
      for (const event of focusCancelEvents)
        document.removeEventListener(event, cancelUpdateFocus, true);
      window.removeEventListener("blur", cancelUpdateFocus);
      cancelUpdateFocus();
    },
    { once: true },
  );
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
  const addService = () => {
    if (persistencePending || serviceManager?.isDialogOpen()) return;
    showSection("services");
    serviceManager?.add();
  };
  await listen("settings-add-service-requested", addService);
  if (typeof location !== "undefined")
    showSection(
      new URLSearchParams(location.search).get("section") ?? "general",
    );
  const acceptExternalSettings = (payload: Settings) => {
    // Merge saved menu actions by ID. Never replace an edited draft with an event
    // emitted by another window, or bring a locally removed service back.
    const draftIds = new Set(serviceDraft.map((service) => service.id));
    const originalIds = new Set(original.services.map((service) => service.id));
    const draftOrderEdited =
      JSON.stringify(serviceDraft.map((service) => service.id)) !==
      JSON.stringify([
        ...original.services
          .filter((service) => draftIds.has(service.id))
          .map((service) => service.id),
        ...serviceDraft
          .filter((service) => !originalIds.has(service.id))
          .map((service) => service.id),
      ]);
    if (
      notificationDraftEdits.size === 0 &&
      JSON.stringify(serviceDraft.map(serviceKey)) ===
        JSON.stringify(original.services.map(serviceKey))
    ) {
      serviceDraft.splice(
        0,
        serviceDraft.length,
        ...structuredClone(payload.services),
      );
    } else {
      for (let index = serviceDraft.length - 1; index >= 0; index--) {
        const draft = serviceDraft[index];
        const before = original.services.find(
          (service) => service.id === draft.id,
        );
        if (
          before &&
          !payload.services.some((service) => service.id === draft.id)
        ) {
          if (serviceKey(draft) === serviceKey(before))
            serviceDraft.splice(index, 1);
          else externalConflict = true;
        }
      }
      for (const after of payload.services) {
        const before = original.services.find(
          (service) => service.id === after.id,
        );
        const draft = serviceDraft.find((service) => service.id === after.id);
        if (!before) {
          if (!draft) serviceDraft.push(structuredClone(after));
          else if (serviceKey(draft) !== serviceKey(after))
            externalConflict = true;
          continue;
        }
        if (!draft) continue;
        for (const key of [
          "provider",
          "name",
          "url",
          "enabled",
          "notifications",
          "notificationColor",
        ] as const) {
          const beforeValue =
            key === "notificationColor"
              ? normalizeNotificationColor(before[key])
              : before[key];
          const afterValue =
            key === "notificationColor"
              ? normalizeNotificationColor(after[key])
              : after[key];
          const draftValue =
            key === "notificationColor"
              ? normalizeNotificationColor(draft[key])
              : draft[key];
          if (
            draftValue === beforeValue &&
            !(key === "notifications" && notificationDraftEdits.has(draft.id))
          )
            Object.assign(draft, { [key]: after[key] });
          else if (beforeValue !== afterValue && draftValue !== afterValue)
            externalConflict = true;
        }
      }
      if (!draftOrderEdited) {
        // Swiph3l: Rail ordering is saved immediately; merge it into field edits
        // so a later Settings Save cannot restore an untouched stale order.
        const positions = new Map(
          payload.services.map((service, index) => [service.id, index]),
        );
        serviceDraft.sort(
          (left, right) =>
            (positions.get(left.id) ?? payload.services.length) -
            (positions.get(right.id) ?? payload.services.length),
        );
      }
    }
    for (const [id, key] of preferenceControls) {
      const control = document.getElementById(id) as
        HTMLInputElement | HTMLSelectElement | null;
      if (!control) continue;
      const local =
        control instanceof HTMLInputElement && control.type === "checkbox"
          ? control.checked
          : control.value;
      if (local === original[key]) {
        if (typeof payload[key] === "boolean")
          (control as HTMLInputElement).checked = payload[key] as boolean;
        else control.value = String(payload[key]);
      } else if (original[key] !== payload[key] && local !== payload[key])
        externalConflict = true;
    }
    original = structuredClone(payload);
    input("server").value = payload.serverUrl;
    configureServerField(
      payload.services.find((service) => service.id === payload.activeService),
    );
    serviceManager?.refresh();
    applyTheme(theme ? (theme.value as Theme) : payload.theme);
    if (externalConflict) status.textContent = t("settings.externalConflict");
    updateDirty();
  };
  await listen<Settings>("settings-changed", ({ payload }) => {
    settingsEventRevision++;
    void refreshFixtureCapabilities();
    if (persistencePending) {
      pendingSettings = payload;
      return;
    }
    acceptExternalSettings(payload);
  });
  // Subscribe before asynchronous panels mount, then close the initial-read gap.
  const beforeRefresh = settingsEventRevision;
  const refreshed = await getSettings().catch(() => undefined);
  await refreshFixtureCapabilities();
  if (refreshed && settingsEventRevision === beforeRefresh)
    acceptExternalSettings(refreshed);
  {
    renderChangelog(document.getElementById("changelog-content")!);
    await mountAboutPanel(document.getElementById("about-content")!);
    await mountUpdatePanel(document.getElementById("update-details")!, {
      hasUnsavedChanges: () =>
        settingsKey(readDraft()) !== settingsKey(original),
      isSettingsSaving: () => persistencePending,
      getDraftIncludeBetaUpdates: () => input("include-beta-updates").checked,
    });
    // #update-details uses display: contents, so focus its rendered summary.
    updateSummary = document.querySelector<HTMLElement>(
      "#update-details .update-summary",
    );
    if (updateSummary) {
      updateSummary.id = "update-summary";
      updateSummary.tabIndex = -1;
      updateSummary.setAttribute("role", "region");
      updateSummary.setAttribute("aria-labelledby", "update-heading");
    }
    focusUpdateSection();
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
      if (persistencePending || permissionPending) return;
      permissionPending = true;
      enableButton.disabled = true;
      input("desktop-notifications").disabled = true;
      updateDirty();
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
        permissionPending = false;
        enableButton.disabled = persistencePending;
        input("desktop-notifications").disabled = persistencePending;
        updateDirty();
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
    if (
      !serviceManager ||
      !serviceDraft.some((service) => service.id === target.id)
    ) {
      status.textContent = t("services.unavailableDraft");
      return;
    }
    document.querySelector<HTMLButtonElement>('[data-tab="services"]')?.click();
    document
      .getElementById(`service-${target.id}-settings`)
      ?.scrollIntoView({ block: "start" });
    if (target.field === "remove") await serviceManager.remove(target.id);
    else
      serviceManager.edit(
        target.id,
        target.field === "settings" ? undefined : target.field,
      );
  };
  await listen("service-settings-requested", () => {
    void showServiceSettings().catch(() => {
      status.textContent = t("services.settingsError");
    });
  });
  await showServiceSettings();
  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      !readyToSave ||
      persistencePending ||
      permissionPending ||
      externalConflict ||
      serviceManager?.isDialogOpen()
    )
      return;
    if (settingsKey(readDraft()) === settingsKey(original)) return;
    const restoreSaveFocus = document.activeElement === button;
    const previousLanguage = original.language ?? "en";
    const snapshot = readDraft();
    let expectedSaved: Settings | undefined;
    let committed = false;
    let saveWarning = false;
    setPersistencePending(true);
    pendingSettings = undefined;
    status.textContent = "";
    clearSaveFeedback();
    const acceptSaved = (saved: Settings) => {
      committed = true;
      original = structuredClone(saved);
      serviceDraft.splice(
        0,
        serviceDraft.length,
        ...structuredClone(saved.services),
      );
      notificationDraftEdits.clear();
      input("server").value = saved.serverUrl;
      hydratePreferences(saved);
      serviceManager?.refresh();
    };
    const readSaved = async () => {
      const beforeRead = settingsEventRevision;
      const saved = await getSettings();
      await refreshFixtureCapabilities();
      // An event arriving during the snapshot read may describe a newer menu
      // action. Do not discard it when acknowledging this Save.
      return pendingSettings && settingsEventRevision > beforeRead
        ? pendingSettings
        : saved;
    };
    try {
      // Validate the entire captured draft before IPC. The hidden legacy URL must
      // never be copied onto a different active service after an external switch.
      snapshot.services = snapshot.services.map((service) => ({
        ...service,
        name: service.name.trim(),
        url: normalizeServer(
          service.url || providers[service.provider].defaultUrl,
        ),
        notifications: service.notifications && supportsNotifications(service),
        notificationColor: normalizeNotificationColor(
          service.notificationColor,
        ),
      }));
      expectedSaved = structuredClone(snapshot);
      if (
        !expectedSaved.services.some(
          (service) =>
            service.enabled && service.id === expectedSaved!.activeService,
        )
      )
        expectedSaved.activeService =
          expectedSaved.services.find((service) => service.enabled)?.id ?? null;
      expectedSaved.serverUrl =
        expectedSaved.services.find(
          (service) => service.id === expectedSaved!.activeService,
        )?.url ?? "";
      expectedSaved.serviceSchema = 1;
      await saveSettings(snapshot);
      // Use the authoritative normalized configuration. A missing follow-up reply
      // does not turn an acknowledged successful save into a persistence failure.
      acceptSaved(
        await readSaved().catch(() => pendingSettings ?? expectedSaved!),
      );
      showSaveFeedback(t("settings.savedContinue"));
    } catch (error) {
      // Native reconciliation can fail after the disk transaction succeeded.
      // Report that explicitly; a failed transaction retains all unsaved edits.
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "";
      const saved = expectedSaved
        ? await readSaved().catch(() => pendingSettings)
        : undefined;
      if (
        expectedSaved &&
        (message.startsWith("Settings saved") ||
          (saved && settingsKey(saved) === settingsKey(expectedSaved)))
      ) {
        acceptSaved(saved ?? expectedSaved);
        saveWarning = true;
        status.textContent = t("settings.savedWarning", {
          message: localizeError(error),
        });
      } else {
        status.textContent = localizeError(error);
      }
    } finally {
      setPersistencePending(false);
      if (!committed && pendingSettings)
        acceptExternalSettings(pendingSettings);
      pendingSettings = undefined;
      if (restoreSaveFocus)
        (button.disabled
          ? document.getElementById("close-settings")!
          : button
        ).focus();
    }
    if (
      committed &&
      !saveWarning &&
      theme &&
      previousLanguage !== original.language &&
      typeof location !== "undefined"
    ) {
      const section =
        document.querySelector<HTMLElement>('[data-tab][aria-selected="true"]')
          ?.dataset.tab ?? "general";
      window.history.replaceState(null, "", `?section=${section}`);
      location.reload();
    }
  });
  readyToSave = true;
  updateDirty();
  if (
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("action") === "add"
  )
    addService();
}
