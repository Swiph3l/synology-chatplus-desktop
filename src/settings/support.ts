import { invoke } from "@tauri-apps/api/core";
import {
  makeProblemReport,
  type ReportEnvironment,
  type ResourceSnapshot,
} from "../app/problem-report";
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

export function mountSupport(root: HTMLElement) {
  root.innerHTML = `<details class="resource-details">
    <summary>${t("resources.title")}</summary>
    <p class="support-help">${t("resources.scope")}</p>
    <dl class="resource-values"></dl>
    <button type="button" class="secondary" data-refresh>${t("resources.refresh")}</button>
    <span role="status" data-resource-status></span>
  </details>
  <button type="button" class="secondary report-entry" data-report aria-haspopup="dialog"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v12H9l-6 4z"/><path d="M12 8v3m0 3h.01"/></svg>${t("report.title")}</button>`;
  const details = root.querySelector("details")!;
  const refresh = root.querySelector<HTMLButtonElement>("[data-refresh]")!;
  const values = root.querySelector("dl")!;
  const status = root.querySelector<HTMLElement>("[data-resource-status]")!;
  let revision = 0;

  const measure = async () => {
    if (!details.open || refresh.disabled) return;
    const requested = ++revision;
    refresh.disabled = true;
    values.setAttribute("aria-busy", "true");
    status.textContent = "";
    try {
      const sample = await invoke<ResourceSnapshot>("sample_resources");
      if (requested !== revision || !details.open) return;
      values.replaceChildren();
      for (const [key, value] of resourceRows(sample)) {
        const term = document.createElement("dt");
        term.textContent = t(key);
        const definition = document.createElement("dd");
        definition.textContent = value;
        values.append(term, definition);
      }
    } catch {
      if (requested === revision) {
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
    // Swiph3l: An IPC result may arrive after leaving Settings. No refresh timer
    // or worker survives closing the disclosure, changing tab, or unloading.
    revision++;
    details.open = false;
    refresh.disabled = false;
    values.removeAttribute("aria-busy");
    values.replaceChildren();
    status.textContent = "";
  };
  details.addEventListener("toggle", () => {
    if (details.open) void measure();
    else closeResources();
  });
  refresh.addEventListener("click", () => void measure());
  const entry = root.querySelector<HTMLButtonElement>("[data-report]")!;
  entry.addEventListener("click", () => openProblemReport(entry));
  window.addEventListener("pagehide", closeResources, { once: true });
  return closeResources;
}

export function openProblemReport(entry: HTMLButtonElement) {
  const dialog = document.createElement("dialog");
  dialog.className = "service-dialog report-dialog";
  dialog.setAttribute("aria-labelledby", "report-title");
  dialog.innerHTML = `<div class="service-dialog-form">
    <h2 id="report-title">${t("report.title")}</h2>
    <div class="service-dialog-content">
      <p class="support-help">${t("report.privacy")}</p>
      <div data-editor>
        <label for="problem-description">${t("report.description")}</label>
        <textarea id="problem-description" rows="3" maxlength="1200" required autofocus></textarea>
        <label for="problem-steps">${t("report.steps")}</label>
        <textarea id="problem-steps" rows="4" maxlength="4000"></textarea>
        <label class="toggle"><input type="checkbox" id="report-include">${t("report.include")}</label>
      </div>
      <div data-preview hidden><label for="problem-preview">${t("report.preview")}</label>
        <textarea readonly id="problem-preview" rows="12" spellcheck="false"></textarea>
      </div>
      <p role="status" aria-live="polite" data-status></p>
    </div>
    <div class="service-dialog-footer"><div class="actions">
      <button type="button" class="secondary" data-close>${t("common.close")}</button>
      <button type="button" class="secondary" data-edit hidden>${t("services.edit")}</button>
      <button type="button" data-review disabled>${t("report.preview")}</button>
      <button type="button" class="secondary" data-issues hidden>${t("report.issues")}</button>
      <button type="button" data-export hidden>${t("report.export")}</button>
    </div></div></div>`;
  document.body.append(dialog);
  const item = <T extends HTMLElement>(selector: string) =>
    dialog.querySelector<T>(selector)!;
  const description = item<HTMLTextAreaElement>("#problem-description");
  const steps = item<HTMLTextAreaElement>("#problem-steps");
  const include = item<HTMLInputElement>("#report-include");
  const editor = item("[data-editor]");
  const preview = item<HTMLTextAreaElement>("#problem-preview");
  const review = item<HTMLButtonElement>("[data-review]");
  const edit = item<HTMLButtonElement>("[data-edit]");
  const save = item<HTMLButtonElement>("[data-export]");
  const issues = item<HTMLButtonElement>("[data-issues]");
  const status = item("[data-status]");
  let generation = 0;
  const invalidate = () => {
    generation++;
    preview.value = "";
    review.disabled = !description.value.trim();
    status.textContent = "";
  };
  editor.addEventListener("input", invalidate);
  const showPreview = (show: boolean) => {
    editor.hidden = show;
    review.hidden = show;
    item("[data-preview]").hidden = !show;
    edit.hidden = issues.hidden = save.hidden = !show;
    (show ? preview : description).focus();
    if (show) {
      preview.setSelectionRange(0, 0);
      preview.scrollTop = 0;
    }
  };
  review.addEventListener("click", async () => {
    if (!description.value.trim() || review.disabled) return;
    const requested = ++generation;
    review.disabled = true;
    status.textContent = "";
    try {
      const sample = include.checked
        ? await invoke<ReportEnvironment>("get_report_environment")
        : undefined;
      if (requested !== generation || !dialog.open) return;
      preview.value = makeProblemReport(description.value, steps.value, sample);
      showPreview(true);
    } catch {
      if (requested === generation) status.textContent = t("about.infoError");
    } finally {
      if (requested === generation) review.disabled = false;
    }
  });
  edit.addEventListener("click", () => {
    invalidate();
    showPreview(false);
  });
  save.addEventListener("click", async () => {
    if (!preview.value || save.hidden || save.disabled) return;
    const requested = generation;
    save.disabled = true;
    try {
      const file = await invoke<string>("export_problem_report", {
        report: preview.value,
      });
      if (requested === generation)
        status.textContent = t("report.saved", { file });
    } catch {
      if (requested === generation)
        status.textContent = t("report.exportError");
    } finally {
      save.disabled = false;
    }
  });
  issues.addEventListener("click", () => {
    if (!preview.value || issues.hidden) return;
    // Swiph3l: Open the fixed project destination without adding a report body,
    // title, attachment or query string to a public URL.
    void invoke("open_project_link", { link: "issues" }).catch(() => {
      status.textContent = t("about.browserError");
    });
  });
  item("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener(
    "close",
    () => {
      invalidate();
      dialog.remove();
      entry.focus();
    },
    { once: true },
  );
  dialog.showModal();
}
