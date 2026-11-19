import { invoke } from "@tauri-apps/api/core";
import {
  makeProblemReport,
  type ReportEnvironment,
} from "../app/problem-report";
import { t } from "../i18n";
import { mountResourceUsage } from "../ui/resource-usage";

export function mountSupport(root: HTMLElement) {
  root.classList.add("settings-support");
  root.innerHTML = `<div data-resources></div>
    <button type="button" class="secondary report-entry" data-report aria-haspopup="dialog"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v12H9l-6 4z"/><path d="M12 8v3m0 3h.01"/></svg>${t("report.title")}</button>`;
  const entry = root.querySelector<HTMLButtonElement>("[data-report]")!;
  entry.addEventListener("click", () => openProblemReport(entry));
  return mountResourceUsage(
    root.querySelector<HTMLElement>("[data-resources]")!,
  );
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
      <div data-preview hidden><div class="report-preview-heading">
        <label for="problem-preview">${t("report.preview")}</label>
        <button type="button" class="secondary" data-copy>${t("report.copy")}</button></div>
        <textarea readonly id="problem-preview" rows="12" spellcheck="false"></textarea>
      </div>
      <p role="status" aria-live="polite" data-status></p>
    </div>
    <div class="service-dialog-footer"><div class="actions">
      <button type="button" class="secondary" data-close>${t("common.close")}</button>
      <button type="button" class="secondary" data-edit hidden>${t("services.edit")}</button>
      <button type="button" data-review disabled>${t("report.preview")}</button>
      <button type="button" class="secondary" data-export hidden>${t("report.export")}</button>
      <button type="button" data-issues hidden>${t("report.copyAndOpen")}</button>
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
  const copy = item<HTMLButtonElement>("[data-copy]");
  const issues = item<HTMLButtonElement>("[data-issues]");
  const status = item("[data-status]");
  let generation = 0;
  let sharing = false;
  let issueAction: "copy-and-open" | "open" | "opened" = "copy-and-open";
  const updateShareActions = () => {
    copy.disabled = sharing;
    issues.disabled = sharing || issueAction === "opened";
    issues.textContent = t(
      issueAction === "copy-and-open"
        ? "report.copyAndOpen"
        : issueAction === "open"
          ? "report.openForm"
          : "report.opened",
    );
  };
  const invalidate = () => {
    generation++;
    sharing = false;
    issueAction = "copy-and-open";
    updateShareActions();
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
  const share = async (openIssue: boolean) => {
    if (
      !dialog.open ||
      !editor.hidden ||
      !preview.value ||
      sharing ||
      (openIssue && issueAction === "opened")
    )
      return;
    const requested = generation;
    const current = () => dialog.open && requested === generation;
    let opening = openIssue && issueAction === "open";
    let copied = false;
    sharing = true;
    updateShareActions();
    status.textContent = "";
    try {
      if (!opening) {
        // Swiph3l: Copy the reviewed Markdown verbatim. The browser command
        // receives only a fixed destination, even if the report contains URLs.
        await invoke("copy_problem_report", { report: preview.value });
        if (!current()) return;
        copied = true;
      }
      if (!openIssue) {
        status.textContent = t("report.copied");
        return;
      }
      opening = true;
      await invoke("open_project_link", { link: "bug-report" });
      if (current()) {
        issueAction = "opened";
        status.textContent = t("report.paste");
      }
    } catch {
      if (!current()) return;
      if (issueAction !== "opened") issueAction = "open";
      if (opening) {
        status.textContent =
          (copied ? t("report.copied") + " " : "") + t("about.browserError");
      } else {
        preview.focus();
        preview.setSelectionRange(0, preview.value.length);
        status.textContent = t("report.manualCopy");
      }
    } finally {
      if (current()) {
        sharing = false;
        updateShareActions();
      }
    }
  };
  copy.addEventListener("click", () => void share(false));
  issues.addEventListener("click", () => void share(true));
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
