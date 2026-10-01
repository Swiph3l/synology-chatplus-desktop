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
      row.className = "service-config";
      const legend = document.createElement("legend");
      const heading = document.createElement("span");
      heading.textContent = service.name || "New service";
      legend.append(heading);
      const definition = providers[service.provider];
      if (definition.experimental) {
        const badge = document.createElement("span");
        badge.className = "experimental-badge";
        badge.textContent = "Experimental";
        legend.append(badge);
      }
      row.append(legend);
      const field = (key: string, text: string, control: HTMLElement) => {
        const field = document.createElement("div");
        field.className = "service-field";
        control.id = `service-${service.id}-${key}`;
        control.classList.add("service-control");
        const label = document.createElement("label");
        label.textContent = text;
        label.setAttribute("for", control.id);
        field.append(label, control);
        row.append(field);
      };
      const provider = document.createElement("select");
      for (const [id, definition] of Object.entries(providers)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = definition.name;
        provider.append(option);
      }
      provider.value = service.provider;
      provider.addEventListener("change", () => {
        const previous = providers[service.provider];
        service.provider = provider.value as ProviderId;
        const next = providers[service.provider];
        if (next.urlMode === "fixed" || previous.urlMode === "fixed") {
          service.url = next.defaultUrl;
          onUrl(service);
        }
        service.notifications = service.provider === "synology-chatplus";
        render();
        document.getElementById(`service-${service.id}-provider`)?.focus();
      });
      field("provider", "Provider", provider);
      const name = document.createElement("input");
      name.value = service.name;
      name.maxLength = 60;
      name.addEventListener("input", () => {
        service.name = name.value;
        heading.textContent = name.value || "New service";
      });
      field("name", "Display name", name);
      if (definition.urlMode !== "fixed") {
        const url = document.createElement("input");
        url.type = "url";
        url.required = true;
        url.value = service.url;
        url.placeholder =
          definition.urlMode === "workspace"
            ? definition.defaultUrl
            : "https://example.com/chat/";
        url.addEventListener("input", () => {
          service.url = url.value;
          onUrl(service);
        });
        field("url", definition.urlLabel, url);
      }
      const options = document.createElement("div");
      options.className = "service-options";
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
        options.append(label);
      };
      toggle("Enabled", "enabled");
      if (service.provider === "synology-chatplus")
        toggle("Allow desktop notifications for this service", "notifications");
      row.append(options);
      if (definition.experimental) {
        const info = document.createElement("div");
        info.className = "service-provider-info";
        const title = document.createElement("h3");
        title.textContent = "Experimental provider";
        const description = document.createElement("p");
        description.textContent =
          "Web session support is available. Desktop unread and notifications are not yet supported.";
        const sso = document.createElement("p");
        sso.className = "service-secondary-help";
        sso.textContent = "External SSO may open in your default browser.";
        info.append(title, description, sso);
        row.append(info);
      }
      const removal = document.createElement("div");
      removal.className = "service-removal";
      const removalTitle = document.createElement("h3");
      removalTitle.textContent = "Remove service";
      const removalHelp = document.createElement("small");
      removalHelp.id = `service-${service.id}-removal-help`;
      removalHelp.textContent =
        "Removes this service from the configuration when you save. Its stored profile is retained.";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary danger";
      remove.textContent = "Remove service";
      remove.setAttribute("aria-label", `Remove ${service.name || "service"}`);
      remove.setAttribute("aria-describedby", removalHelp.id);
      remove.addEventListener("click", () => {
        if (
          !window.confirm(
            `Remove ${service.name || "this service"} from the configuration? Changes take effect when you save.`,
          )
        )
          return;
        services.splice(services.indexOf(service), 1);
        render();
      });
      removal.append(removalTitle, removalHelp, remove);
      row.append(removal);
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
