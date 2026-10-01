import {
  providers,
  type ProviderId,
  type ServiceConfig,
} from "../app/providers";

export function serviceEditor(
  container: HTMLElement,
  services: ServiceConfig[],
  onUrl: (service: ServiceConfig) => void,
) {
  const render = () => {
    container.replaceChildren();
    for (const service of services) {
      const row = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = service.name || "New service";
      row.append(legend);
      const field = (text: string, control: HTMLElement) => {
        const label = document.createElement("label");
        label.textContent = text;
        label.append(control);
        row.append(label);
      };
      const provider = document.createElement("select");
      for (const [id, definition] of Object.entries(providers)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${definition.name}${definition.experimental ? " (Experimental)" : ""}`;
        provider.append(option);
      }
      provider.value = service.provider;
      provider.addEventListener("change", () => {
        service.provider = provider.value as ProviderId;
        service.notifications = service.provider === "synology-chatplus";
        render();
      });
      field("Provider", provider);
      const name = document.createElement("input");
      name.value = service.name;
      name.maxLength = 60;
      name.addEventListener("input", () => {
        service.name = name.value;
        legend.textContent = name.value || "New service";
      });
      field("Display name", name);
      const url = document.createElement("input");
      url.type = "url";
      url.required = true;
      url.value = service.url;
      url.placeholder =
        service.provider === "slack"
          ? "https://app.slack.com/"
          : "https://example.com/chat/";
      url.addEventListener("input", () => {
        service.url = url.value;
        onUrl(service);
      });
      field("Service URL", url);
      const toggle = (text: string, key: "enabled" | "notifications") => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = service[key];
        checkbox.addEventListener("change", () => {
          service[key] = checkbox.checked;
        });
        const label = document.createElement("label");
        label.className = "toggle";
        label.append(checkbox, text);
        row.append(label);
      };
      toggle("Enabled", "enabled");
      if (service.provider === "synology-chatplus")
        toggle("Allow desktop notifications for this service", "notifications");
      else {
        const note = document.createElement("small");
        note.textContent =
          "Experimental web session. Desktop unread and notifications are unavailable. External SSO may require your browser.";
        row.append(note);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.textContent = "Remove service";
      remove.addEventListener("click", () => {
        services.splice(services.indexOf(service), 1);
        render();
      });
      row.append(remove);
      container.append(row);
    }
  };
  render();
  return () => {
    if (services.length >= 12) return;
    services.push({
      id: `service-${crypto.randomUUID()}`,
      provider: "synology-chatplus",
      name: "ChatPlus",
      url: "",
      enabled: true,
      notifications: true,
    });
    render();
  };
}
