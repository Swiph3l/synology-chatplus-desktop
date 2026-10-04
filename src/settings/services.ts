import {
  providers,
  type ProviderId,
  type ServiceConfig,
} from "../app/providers";
import { t } from "../i18n";

export function serviceEditor(
  container: HTMLElement,
  services: ServiceConfig[],
  onUrl: (service: ServiceConfig) => void,
  onRemove: (service: ServiceConfig) => Promise<boolean>,
) {
  const render = () => {
    container.replaceChildren();
    for (const service of services) {
      const row = document.createElement("fieldset");
      row.className = "service-config";
      row.id = `service-${service.id}-settings`;
      row.tabIndex = -1;
      const legend = document.createElement("legend");
      const heading = document.createElement("span");
      heading.textContent = service.name || t("services.new");
      legend.append(heading);
      const definition = providers[service.provider];
      if (definition.experimental) {
        const badge = document.createElement("span");
        badge.className = "experimental-badge";
        badge.textContent = t("services.experimental");
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
      field("provider", t("services.provider"), provider);
      const name = document.createElement("input");
      name.value = service.name;
      name.maxLength = 60;
      name.addEventListener("input", () => {
        service.name = name.value;
        heading.textContent = name.value || t("services.new");
      });
      field("name", t("services.name"), name);
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
        field(
          "url",
          t(
            definition.urlMode === "workspace"
              ? "settings.workspaceUrl"
              : "settings.serverUrl",
          ),
          url,
        );
      }
      const options = document.createElement("div");
      options.className = "service-options";
      const toggle = (text: string, key: "enabled" | "notifications") => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `service-${service.id}-${key}`;
        checkbox.checked = service[key];
        checkbox.addEventListener("change", () => {
          service[key] = checkbox.checked;
        });
        const label = document.createElement("label");
        label.className = "toggle";
        label.append(checkbox, text);
        options.append(label);
      };
      toggle(t("services.enabled"), "enabled");
      if (service.provider === "synology-chatplus")
        toggle(t("services.allowNotifications"), "notifications");
      row.append(options);
      if (definition.experimental) {
        const info = document.createElement("div");
        info.className = "service-provider-info";
        const title = document.createElement("h3");
        title.textContent = t("services.experimentalProvider");
        const description = document.createElement("p");
        description.textContent = t("services.experimentalHelp");
        const sso = document.createElement("p");
        sso.className = "service-secondary-help";
        sso.textContent = t("services.ssoHelp");
        info.append(title, description, sso);
        row.append(info);
      }
      const removal = document.createElement("div");
      removal.className = "service-removal";
      const removalTitle = document.createElement("h3");
      removalTitle.textContent = t("services.remove");
      const removalHelp = document.createElement("small");
      removalHelp.id = `service-${service.id}-removal-help`;
      removalHelp.textContent = t("services.removalHelp");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.id = `service-${service.id}-remove`;
      remove.className = "secondary danger";
      remove.textContent = t("services.remove");
      remove.setAttribute(
        "aria-label",
        t("services.removeLabel", {
          name: service.name || t("services.service"),
        }),
      );
      remove.setAttribute("aria-describedby", removalHelp.id);
      remove.addEventListener("click", async () => {
        if (remove.disabled) return;
        const restoreFocus = document.activeElement === remove;
        remove.disabled = true;
        try {
          if (!(await onRemove(service))) return;
          const index = services.indexOf(service);
          if (index >= 0) services.splice(index, 1);
          render();
          const next = services[Math.min(index, services.length - 1)];
          (next
            ? document.getElementById(`service-${next.id}-provider`)
            : document.getElementById("add-service")
          )?.focus();
        } finally {
          if (remove.isConnected) {
            remove.disabled = false;
            if (restoreFocus && document.hasFocus())
              remove.focus({ preventScroll: true });
          }
        }
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
