import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSettings, type Settings } from "../app/settings";
import { providers } from "../app/providers";
import { bindShellTheme } from "../theme/theme";
export async function renderServices() {
  document.body.classList.add("services-page");
  await bindShellTheme();
  let unread: Record<string, { hasUnread: boolean }> = {};
  let settings = await getSettings();
  const render = () => {
    const app = document.getElementById("app")!;
    const rail = document.createElement("nav");
    rail.className = "service-rail";
    rail.setAttribute("aria-label", "Services");
    for (const service of settings.services.filter((s) => s.enabled)) {
      const button = document.createElement("button");
      const provider = providers[service.provider];
      button.textContent = provider.icon;
      button.title = `${service.name}${provider.experimental ? " (Experimental)" : ""}`;
      button.setAttribute("aria-label", button.title);
      button.setAttribute(
        "aria-pressed",
        String(service.id === settings.activeService),
      );
      button.classList.toggle(
        "has-unread",
        unread[service.id]?.hasUnread ?? false,
      );
      button.addEventListener("click", () => {
        void invoke("activate_service", { id: service.id }).catch(() => {
          document.getElementById("rail-status")!.textContent =
            "Could not open service.";
        });
      });
      rail.append(button);
    }
    for (const [text, title] of [
      ["+", "Add service"],
      ["⚙", "Settings"],
    ]) {
      const button = document.createElement("button");
      button.textContent = text;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("click", () => {
        void invoke("open_settings").catch(() => {
          document.getElementById("rail-status")!.textContent =
            "Could not open Settings.";
        });
      });
      rail.append(button);
    }
    const status = document.createElement("p");
    status.id = "rail-status";
    status.setAttribute("role", "status");
    app.replaceChildren(rail, status);
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
