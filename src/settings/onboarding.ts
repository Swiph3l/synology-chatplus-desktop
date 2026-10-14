import { invoke } from "@tauri-apps/api/core";
import { getSettings, saveSettings, type Settings } from "../app/settings";
import {
  providers,
  type ProviderId,
  type ServiceConfig,
} from "../app/providers";
import { localizeError, t } from "../i18n";
import { normalizeNotificationColor } from "../app/notification-colors";
import { providerIcon } from "../ui/rail-icons";
import { serviceEditor } from "./services";

export function renderOnboarding(
  app: HTMLElement,
  initial: Settings,
  supportsNotifications: (
    service: Pick<ServiceConfig, "id" | "provider" | "url">,
  ) => boolean,
) {
  document.body.classList.add("setup-page", "onboarding-page");
  let saved = structuredClone(initial);
  const services = structuredClone(initial.services);
  let pending = false;
  let dirty = false;
  app.innerHTML = `
    <header class="page-header"><img class="brand" src="/chatplus.png" alt="" width="32" height="32"><h1>${t("onboarding.welcome")}</h1></header>
    <div class="onboarding-content settings-content">
      <section id="onboarding-picker" aria-labelledby="onboarding-heading">
        <h2 id="onboarding-heading" tabindex="-1">${t("onboarding.chooseFirst")}</h2>
        <div class="onboarding-providers"></div>
      </section>
      <section id="onboarding-services" aria-labelledby="onboarding-services-heading" hidden>
        <h2 id="onboarding-services-heading">${t("common.services")}</h2>
        <div id="service-editor"></div>
      </section>
    </div>
    <p id="onboarding-status" role="status" aria-live="polite"></p>
    <div class="form-footer onboarding-footer">
      <button id="onboarding-skip" type="button" class="secondary">${t("onboarding.skip")}</button>
      <button id="onboarding-retry" type="button" class="secondary" hidden>${t("common.save")}</button>
      <button id="add-service" type="button" class="secondary" hidden>${t("onboarding.addAnother")}</button>
      <button id="onboarding-continue" type="button" hidden>${t("onboarding.continue")}</button>
    </div>`;
  const picker = app.querySelector<HTMLElement>("#onboarding-picker")!;
  const heading = app.querySelector<HTMLElement>("#onboarding-heading")!;
  const configured = app.querySelector<HTMLElement>("#onboarding-services")!;
  const status = app.querySelector<HTMLElement>("#onboarding-status")!;
  const skip = app.querySelector<HTMLButtonElement>("#onboarding-skip")!;
  const retry = app.querySelector<HTMLButtonElement>("#onboarding-retry")!;
  const another = app.querySelector<HTMLButtonElement>("#add-service")!;
  const next = app.querySelector<HTMLButtonElement>("#onboarding-continue")!;
  const providerButtons: HTMLButtonElement[] = [];
  const updateControls = () => {
    configured.hidden = services.length === 0;
    skip.hidden = services.length > 0 || dirty;
    retry.hidden = !dirty;
    another.hidden = services.length === 0;
    next.hidden = services.length === 0;
    skip.disabled = pending;
    retry.disabled = pending;
    another.disabled = pending || dirty || services.length >= 12;
    next.disabled = pending || dirty;
    for (const button of providerButtons)
      button.disabled = pending || dirty || services.length >= 12;
  };
  const manager = serviceEditor(
    app.querySelector<HTMLElement>("#service-editor")!,
    services,
    () => {
      dirty = true;
      void persist();
    },
    supportsNotifications,
    {
      saveHelp: t("onboarding.serviceHelp"),
      removalHelp: t("onboarding.serviceHelp"),
    },
  );
  const setPending = (value: boolean) => {
    pending = value;
    manager.setDisabled(value);
    updateControls();
  };
  async function persist() {
    if (pending) return;
    setPending(true);
    status.textContent = "";
    const active =
      services.find(
        (service) => service.enabled && service.id === saved.activeService,
      ) ?? services.find((service) => service.enabled);
    const snapshot: Settings = {
      ...saved,
      services: structuredClone(services),
      serviceSchema: 1,
      activeService: active?.id ?? null,
      serverUrl: active?.url ?? "",
    };
    const serviceKey = (value: Settings) =>
      JSON.stringify({
        activeService: value.activeService,
        serverUrl: value.serverUrl,
        serviceSchema: value.serviceSchema,
        services: value.services.map((service) => [
          service.id,
          service.provider,
          service.name,
          service.url,
          service.enabled,
          service.notifications,
          normalizeNotificationColor(service.notificationColor),
        ]),
      });
    const acceptSaved = (authoritative: Settings) => {
      saved = authoritative;
      services.splice(0, services.length, ...structuredClone(saved.services));
      dirty = false;
      picker.hidden = services.length > 0;
      heading.textContent = t("onboarding.chooseFirst");
    };
    try {
      // The shared editor owns URL validation, UUIDs and isolated service drafts.
      // Persist through the same native transaction as Settings -> Services.
      await saveSettings(snapshot);
      acceptSaved(await getSettings().catch(() => snapshot));
    } catch (error) {
      // Native theme/focus reconciliation can reject after the service transaction
      // commits. Only a matching authoritative snapshot acknowledges this draft.
      const authoritative = await getSettings().catch(() => undefined);
      if (authoritative && serviceKey(authoritative) === serviceKey(snapshot)) {
        acceptSaved(authoritative);
        status.textContent = t("settings.savedWarning", {
          message: localizeError(error),
        });
      } else status.textContent = localizeError(error);
    } finally {
      setPending(false);
      manager.refresh();
    }
    if (!dirty && services.length && document.hasFocus()) next.focus();
  }
  for (const [id, definition] of Object.entries(providers) as [
    ProviderId,
    (typeof providers)[ProviderId],
  ][]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary onboarding-provider";
    button.dataset.provider = id;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-pressed", "false");
    const support = t(
      definition.experimental
        ? "services.experimental"
        : "onboarding.supported",
    );
    button.title = `${definition.name} · ${support}`;
    const icon = providerIcon(id);
    const body = document.createElement("span");
    body.className = "onboarding-provider-body";
    const name = document.createElement("strong");
    name.textContent = definition.name;
    const description = document.createElement("small");
    description.textContent = t(
      definition.urlMode === "fixed"
        ? "onboarding.fixedService"
        : definition.urlMode === "workspace"
          ? "onboarding.workspaceService"
          : "onboarding.serverService",
    );
    const badge = document.createElement("span");
    badge.className = "onboarding-support";
    badge.classList.toggle("experimental-badge", definition.experimental);
    badge.textContent = support;
    body.append(name, description, badge);
    button.append(icon, body);
    button.addEventListener("click", () => {
      if (pending || dirty) return;
      for (const item of providerButtons)
        item.setAttribute("aria-pressed", String(item === button));
      manager.add(id);
    });
    providerButtons.push(button);
    app.querySelector(".onboarding-providers")!.append(button);
  }
  another.addEventListener("click", () => {
    if (pending || dirty) return;
    picker.hidden = false;
    heading.textContent = t("onboarding.addAnother");
    for (const button of providerButtons)
      button.setAttribute("aria-pressed", "false");
    heading.focus();
    heading.scrollIntoView({ block: "nearest" });
  });
  retry.addEventListener("click", () => void persist());
  const complete = async () => {
    if (pending || dirty || manager.isDialogOpen()) return;
    setPending(true);
    status.textContent = "";
    try {
      await invoke<Settings>("complete_onboarding");
    } catch (error) {
      status.textContent = localizeError(error);
      setPending(false);
    }
  };
  skip.addEventListener("click", () => void complete());
  next.addEventListener("click", () => void complete());
  window.addEventListener("pagehide", () => manager.dispose(), { once: true });
  updateControls();
  heading.focus();
}
