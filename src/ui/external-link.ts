import "./external-link.css";
import { listen } from "@tauri-apps/api/event";
import { externalLinks, type ExternalLinkPrompt } from "../app/external-links";
import type { Theme } from "../app/settings";
import { setLanguage, t } from "../i18n";
import { applyTheme } from "../theme/theme";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.7");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M14 4h6v6M20 4l-9 9M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4",
  );
  icon.append(path);
  return icon;
}

function destinationHost(prompt: ExternalLinkPrompt): string | null {
  try {
    const destination = new URL(prompt.url);
    if (
      !["https:", "http:"].includes(destination.protocol) ||
      destination.username ||
      destination.password ||
      destination.origin !== prompt.origin ||
      prompt.insecureHttp !== (destination.protocol === "http:")
    )
      return null;
    return destination.host;
  } catch {
    return null;
  }
}

export async function renderExternalLink() {
  document.body.classList.add("external-link-page");
  const app = document.getElementById("app")!;
  let disposed = false;
  let pending = false;
  let completed = false;
  let observedTheme: Theme | undefined;
  let unlisten: (() => void) | undefined;
  let keydown: ((event: KeyboardEvent) => void) | undefined;
  const dispose = () => {
    disposed = true;
    unlisten?.();
    if (keydown) document.removeEventListener("keydown", keydown);
    window.removeEventListener("pagehide", dispose);
  };
  window.addEventListener("pagehide", dispose);
  try {
    // Swiph3l: This restricted child needs only its retained prompt and a theme
    // event. Fetching general settings would expose unrelated profile details.
    unlisten = await listen<Theme>("theme-changed", ({ payload }) => {
      if (!disposed && ["system", "light", "dark"].includes(payload)) {
        observedTheme = payload;
        applyTheme(payload);
      }
    });
    if (disposed) {
      unlisten();
      return;
    }
    const prompt = await externalLinks.prompt();
    if (disposed) return;
    setLanguage(prompt.language);
    applyTheme(observedTheme ?? prompt.theme);
    const host = destinationHost(prompt);
    const panel = element("section", "external-link-panel");
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "external-link-title");
    panel.setAttribute("aria-describedby", "external-link-description");
    const header = element("header", "external-link-header");
    const icon = element("span", "external-link-icon");
    icon.append(externalIcon());
    const heading = element("div", "external-link-heading");
    const title = element("h1", "external-link-title", t("externalLink.title"));
    title.id = "external-link-title";
    const hostname = element("p", "external-link-host", host ?? prompt.origin);
    hostname.dir = "ltr";
    heading.append(title, hostname);
    header.append(icon, heading);
    const description = element(
      "p",
      "external-link-description",
      t("externalLink.description"),
    );
    description.id = "external-link-description";
    const origin = element("p", "external-link-origin");
    const originLabel = element(
      "span",
      "external-link-label",
      t("externalLink.origin"),
    );
    const originValue = element(
      "span",
      "external-link-origin-value",
      prompt.origin,
    );
    originValue.dir = "ltr";
    origin.append(originLabel, originValue);
    const destination = element(
      "label",
      "external-link-destination",
      t("externalLink.destination"),
    );
    destination.htmlFor = "external-link-url";
    const url = element("textarea", "external-link-url", prompt.url);
    url.id = "external-link-url";
    url.readOnly = true;
    url.rows = 2;
    url.wrap = "soft";
    url.spellcheck = false;
    url.dir = "ltr";
    url.setAttribute("aria-label", t("externalLink.destination"));
    url.setAttribute("autocomplete", "off");
    // Swiph3l: The entire retained URL is selectable text, never HTML or a link.
    // Native approval accepts only requestId; even edited DOM cannot replace it.
    const warning = element(
      "p",
      "external-link-http-warning",
      t("externalLink.httpWarning"),
    );
    warning.id = "external-link-http-warning";
    warning.hidden = !prompt.insecureHttp;
    if (prompt.insecureHttp) {
      panel.setAttribute(
        "aria-describedby",
        "external-link-description external-link-http-warning",
      );
    }
    const status = element("p", "external-link-status");
    status.setAttribute("role", "alert");
    status.hidden = true;
    const actions = element("footer", "external-link-actions");
    const cancel = element(
      "button",
      "external-link-cancel",
      t("common.cancel"),
    );
    cancel.type = "button";
    cancel.autofocus = true;
    const open = element(
      "button",
      "external-link-open",
      t("externalLink.open"),
    );
    open.type = "button";
    open.disabled = host === null;
    actions.append(cancel, open);
    panel.append(
      header,
      description,
      origin,
      destination,
      url,
      warning,
      status,
      actions,
    );
    app.replaceChildren(panel);
    app.removeAttribute("aria-busy");

    const respond = async (accepted: boolean) => {
      if (disposed || pending || completed || (accepted && host === null))
        return;
      pending = true;
      cancel.disabled = open.disabled = true;
      app.setAttribute("aria-busy", "true");
      status.hidden = true;
      try {
        await externalLinks.respond(prompt.requestId, accepted);
        completed = true;
      } catch {
        if (disposed) return;
        status.textContent = t(
          accepted ? "externalLink.failed" : "externalLink.unavailable",
        );
        status.hidden = false;
      } finally {
        pending = false;
        if (!disposed && !completed) {
          app.removeAttribute("aria-busy");
          cancel.disabled = false;
          open.disabled = host === null;
          cancel.focus({ preventScroll: true });
        }
      }
    };
    cancel.addEventListener("click", () => {
      void respond(false);
    });
    open.addEventListener("click", () => {
      void respond(true);
    });
    keydown = (event) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        void respond(false);
      }
    };
    document.addEventListener("keydown", keydown);
    if (host === null) {
      status.textContent = t("externalLink.unavailable");
      status.hidden = false;
    }
    cancel.focus({ preventScroll: true });
    // The native window stays hidden until controls, text and safe default focus
    // are ready. Native code owns showing it and playing its one gentle tone.
    await externalLinks.ready(prompt.requestId);
  } catch {
    if (!disposed) {
      app.replaceChildren(
        element("p", "external-link-status", t("externalLink.unavailable")),
      );
      app.removeAttribute("aria-busy");
    }
    dispose();
  }
}
