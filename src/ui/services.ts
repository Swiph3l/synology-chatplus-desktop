import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSettings, type Settings } from "../app/settings";
import { providers } from "../app/providers";
import { bindShellTheme } from "../theme/theme";
import { providerIcon, railIcon } from "./rail-icons";
import { setLanguage, t } from "../i18n";
import { updates, type UpdateSnapshot } from "../app/updates";
import { createFooter } from "./footer";
import { acceptUnreadSnapshot, type UnreadSnapshot } from "../app/unread";
export async function renderServices() {
  document.body.classList.add("services-page");
  const app = document.getElementById("app")!;
  app.replaceChildren();
  await bindShellTheme();
  let unread: UnreadSnapshot = {
    revision: -1,
    services: {},
    aggregate: { hasUnread: false },
  };
  let settings = await getSettings();
  setLanguage(settings.language ?? "en");
  const version = await invoke<string>("get_current_version").catch(() => "");
  const footer = createFooter(version ?? "");
  app.append(footer.element);
  let contextRequest = 0;
  const openContextMenu = async (
    button: HTMLButtonElement,
    id: string,
    x: number,
    y: number,
  ) => {
    const request = ++contextRequest;
    button.focus({ preventScroll: true });
    try {
      await invoke("show_service_context_menu", { id, x, y });
    } catch {
      footer.report(t("rail.menuError"));
    } finally {
      // Swiph3l: A native popup can outlive a rail refresh; only restore its trigger
      // if no newer popup or other window has taken the user's focus.
      if (request === contextRequest && document.hasFocus()) {
        const trigger = [
          ...app.querySelectorAll<HTMLButtonElement>("button"),
        ].find((item) => item.dataset.railKey === id);
        trigger?.focus({ preventScroll: true });
      }
    }
  };
  const render = () => {
    const focused = document.activeElement as HTMLElement | null;
    // Swiph3l: An inactive shell retains activeElement while a provider WebView
    // owns input; unread refreshes must not steal focus back from that provider.
    const focusKey =
      app.contains(focused) && document.hasFocus()
        ? focused?.dataset.railKey
        : undefined;
    const rail = document.createElement("nav");
    rail.className = "service-rail";
    rail.setAttribute("aria-label", t("rail.services"));
    const brand = document.createElement("div");
    brand.className = "rail-brand";
    brand.title = t("rail.navigation");
    brand.setAttribute("aria-label", "ChatPlus Desktop");
    brand.append(railIcon("desktop"));
    rail.append(brand);
    const services = document.createElement("div");
    services.className = "rail-services";
    for (const service of settings.services.filter((s) => s.enabled)) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.railKey = service.id;
      button.setAttribute("aria-haspopup", "menu");
      const provider = providers[service.provider];
      button.append(providerIcon(service.provider));
      button.title = `${service.name} · ${provider.name}${provider.experimental ? ` (${t("rail.experimental")})` : ""}`;
      const hasUnread = unread.services[service.id]?.hasUnread ?? false;
      button.setAttribute(
        "aria-label",
        `${button.title}${hasUnread ? `, ${t("rail.unread")}` : ""}`,
      );
      button.setAttribute(
        "aria-pressed",
        String(service.id === settings.activeService),
      );
      button.classList.toggle("has-unread", hasUnread);
      button.addEventListener("click", () => {
        void invoke("activate_service", { id: service.id }).catch(() => {
          footer.report(t("rail.openError"));
        });
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const rect = button.getBoundingClientRect();
        const keyboard = event.clientX === 0 && event.clientY === 0;
        void openContextMenu(
          button,
          service.id,
          keyboard ? rect.right : event.clientX,
          keyboard ? rect.top : event.clientY,
        );
      });
      button.addEventListener("keydown", (event) => {
        if (
          event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10")
        )
          return;
        event.preventDefault();
        const rect = button.getBoundingClientRect();
        void openContextMenu(button, service.id, rect.right, rect.top);
      });
      services.append(button);
    }
    rail.append(services);
    const actions = document.createElement("div");
    actions.className = "rail-actions";
    for (const [kind, title] of [
      ["add", t("rail.add")],
      ["settings", t("rail.settings")],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.railKey = kind;
      button.append(railIcon(kind));
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("click", () => {
        void invoke("open_settings", {
          section: kind === "add" ? "services" : "general",
        }).catch(() => {
          footer.report(t("rail.settingsError"));
        });
      });
      actions.append(button);
    }
    rail.append(actions);
    // Swiph3l: Unread changes can be frequent; replacing only the rail keeps
    // footer status and keyboard focus intact while native service views stay alive.
    const previous = app.querySelector(".service-rail");
    if (previous) previous.replaceWith(rail);
    else app.prepend(rail);
    if (focusKey) {
      const target = [
        ...app.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.dataset.railKey === focusKey);
      (target ?? actions.querySelector("button"))?.focus({
        preventScroll: true,
      });
    }
  };
  let settingsObserved = false;
  await listen<Settings>("services-changed", ({ payload }) => {
    settingsObserved = true;
    settings = payload;
    setLanguage(settings.language ?? "en");
    footer.refresh();
    render();
  });
  let unreadObserved = false;
  await listen<typeof unread>("service-unread", ({ payload }) => {
    unreadObserved = true;
    unread = acceptUnreadSnapshot(unread, payload);
    render();
  });
  let updateObserved = false;
  let connectionObserved = false;
  await listen<UpdateSnapshot>("update-state", ({ payload }) => {
    updateObserved = true;
    footer.setUpdate(payload);
  });
  await listen<string>("connection-changed", ({ payload }) => {
    connectionObserved = true;
    footer.setConnection(payload);
  });
  await listen("notification-issue", () => {
    footer.report(t("footer.status.notification"));
  });
  render();
  // Swiph3l: Subscribe before reading snapshots so startup checks and transport
  // events cannot disappear between mounting the footer and its first refresh.
  // A later event also takes precedence over an older in-flight snapshot reply.
  const [update, connection, initialUnread, initialSettings] =
    await Promise.allSettled([
      updates.getState(),
      invoke<string>("get_connection_state"),
      invoke<typeof unread>("get_unread_state"),
      getSettings(),
    ]);
  if (!updateObserved && update.status === "fulfilled" && update.value)
    footer.setUpdate(update.value);
  if (
    !connectionObserved &&
    connection.status === "fulfilled" &&
    connection.value
  )
    footer.setConnection(connection.value);
  if (!settingsObserved && initialSettings.status === "fulfilled") {
    settings = initialSettings.value;
    setLanguage(settings.language ?? "en");
    footer.refresh();
    render();
  }
  if (
    !unreadObserved &&
    initialUnread.status === "fulfilled" &&
    initialUnread.value
  ) {
    unread = acceptUnreadSnapshot(unread, initialUnread.value);
    render();
  }
}
