import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSettings, type Settings } from "../app/settings";
import { providers } from "../app/providers";
import { bindShellTheme } from "../theme/theme";
import { providerIcon, railIcon } from "./rail-icons";
export async function renderServices() {
  document.body.classList.add("services-page");
  const app = document.getElementById("app")!;
  app.replaceChildren();
  await bindShellTheme();
  let unread: Record<string, { hasUnread: boolean }> = {};
  let settings = await getSettings();
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
      document.getElementById("rail-status")!.textContent =
        "Could not open the service menu.";
    } finally {
      // Native menus own arrow keys, Escape, outside-click dismissal and accessibility.
      // Restore a replaced trigger only if focus is still in this rail, not in Settings/content.
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
    const focusKey = app.contains(focused)
      ? focused?.dataset.railKey
      : undefined;
    const rail = document.createElement("nav");
    rail.className = "service-rail";
    rail.setAttribute("aria-label", "ChatPlus Desktop services");
    const brand = document.createElement("div");
    brand.className = "rail-brand";
    brand.title = "ChatPlus Desktop · Application navigation";
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
      button.title = `${service.name} · ${provider.name}${provider.experimental ? " (Experimental)" : ""}`;
      const hasUnread = unread[service.id]?.hasUnread ?? false;
      button.setAttribute(
        "aria-label",
        `${button.title}${hasUnread ? ", unread messages" : ""}`,
      );
      button.setAttribute(
        "aria-pressed",
        String(service.id === settings.activeService),
      );
      button.classList.toggle("has-unread", hasUnread);
      button.addEventListener("click", () => {
        void invoke("activate_service", { id: service.id }).catch(() => {
          document.getElementById("rail-status")!.textContent =
            "Could not open service.";
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
      ["add", "Add service"],
      ["settings", "Settings"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.railKey = kind;
      button.append(railIcon(kind));
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("click", () => {
        void invoke("open_settings").catch(() => {
          document.getElementById("rail-status")!.textContent =
            "Could not open Settings.";
        });
      });
      actions.append(button);
    }
    rail.append(actions);
    const status = document.createElement("p");
    status.id = "rail-status";
    status.setAttribute("role", "status");
    status.className = "rail-status";
    app.replaceChildren(rail, status);
    if (focusKey) {
      const target = [
        ...rail.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.dataset.railKey === focusKey);
      (target ?? actions.querySelector("button"))?.focus({
        preventScroll: true,
      });
    }
  };
  await listen<Settings>("services-changed", ({ payload }) => {
    settings = payload;
    render();
  });
  await listen<typeof unread>("service-unread", ({ payload }) => {
    unread = payload;
    render();
  });
  render();
}
