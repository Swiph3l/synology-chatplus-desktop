import { invoke } from "@tauri-apps/api/core";
import type { ResourceSnapshot } from "../app/problem-report";
import { currentLanguage, t, type TranslationKey } from "../i18n";

function resourceRows(sample: ResourceSnapshot): [TranslationKey, string][] {
  const number = new Intl.NumberFormat(currentLanguage(), {
    maximumFractionDigits: 1,
  });
  const value = (n: number | null, scale = 1, suffix = "") =>
    n === null ? t("common.unavailable") : number.format(n / scale) + suffix;
  const duration = (value: number, unit: string) =>
    new Intl.NumberFormat(currentLanguage(), {
      style: "unit",
      unit,
      unitDisplay: "short",
    }).format(value);
  const seconds = sample.uptimeSeconds;
  const uptime = [
    ...(seconds >= 3600 ? [duration(Math.floor(seconds / 3600), "hour")] : []),
    ...(seconds >= 60
      ? [duration(Math.floor(seconds / 60) % 60, "minute")]
      : []),
    duration(seconds % 60, "second"),
  ].join(" ");
  return [
    [
      "resources.mainMemory",
      value(sample.mainResidentBytes, 1024 ** 2, " MiB"),
    ],
    [
      "resources.mainCpu",
      sample.mainCpuPercent === null
        ? t("common.unavailable")
        : new Intl.NumberFormat(currentLanguage(), {
            style: "percent",
            maximumFractionDigits: 1,
          }).format(sample.mainCpuPercent / 100),
    ],
    ["resources.services", value(sample.activeServices)],
    ["resources.processes", value(sample.webviewProcesses)],
    [
      "resources.webviewMemory",
      value(sample.webviewResidentBytes, 1024 ** 2, " MiB"),
    ],
    ["resources.uptime", uptime],
    ["resources.version", sample.version],
    ["about.webview", sample.webviewVersion || t("common.unavailable")],
  ];
}

export function mountResourceUsage(root: HTMLElement) {
  root.innerHTML = `<details class="resource-details">
    <summary>${t("resources.title")}</summary>
    <p class="support-help">${t("resources.scope")}</p>
    <dl class="resource-values"></dl>
    <button type="button" class="secondary" data-refresh>${t("resources.refresh")}</button>
    <span role="status" data-resource-status></span>
  </details>`;
  const details = root.querySelector("details")!;
  const refresh = root.querySelector<HTMLButtonElement>("[data-refresh]")!;
  const values = root.querySelector("dl")!;
  const status = root.querySelector<HTMLElement>("[data-resource-status]")!;
  let revision = 0;

  const visible = () =>
    details.open &&
    details.isConnected &&
    !document.hidden &&
    !details.closest("[hidden]");
  const measure = async () => {
    if (!visible() || refresh.disabled) return;
    const requested = ++revision;
    refresh.disabled = true;
    values.setAttribute("aria-busy", "true");
    status.textContent = "";
    try {
      const sample = await invoke<ResourceSnapshot>("sample_resources");
      if (requested !== revision || !visible()) return;
      values.replaceChildren();
      for (const [key, value] of resourceRows(sample)) {
        const term = document.createElement("dt");
        term.textContent = t(key);
        const definition = document.createElement("dd");
        definition.textContent = value;
        values.append(term, definition);
      }
    } catch {
      if (requested === revision && visible()) {
        values.replaceChildren();
        status.textContent = t("about.infoError");
      }
    } finally {
      if (requested === revision) {
        refresh.disabled = false;
        values.removeAttribute("aria-busy");
      }
    }
  };
  const closeResources = () => {
    // Discard any native sample that finishes after this view was closed.
    revision++;
    details.open = false;
    refresh.disabled = false;
    values.removeAttribute("aria-busy");
    values.replaceChildren();
    status.textContent = "";
  };
  details.addEventListener("toggle", () => {
    if (!details.open) closeResources();
  });
  refresh.addEventListener("click", () => void measure());
  root
    .closest("[data-panel]")
    ?.addEventListener("settings-panel-hidden", closeResources);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) closeResources();
  });
  window.addEventListener("pagehide", closeResources);
  return closeResources;
}
