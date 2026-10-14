import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import {
  updateHasError,
  isPrereleaseVersion,
  updateStatusText,
  type UpdateSnapshot,
} from "../app/updates";

function icon(path: string) {
  const span = document.createElement("span");
  span.className = "footer-icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return span;
}

export function createFooter(version: string) {
  const element = document.createElement("footer");
  element.className = "app-footer";
  const identity = document.createElement("span");
  identity.className = "footer-version";
  identity.textContent = `ChatPlus ${version}`.trim();
  const versionGroup = document.createElement("div");
  versionGroup.className = "footer-identity";
  const updateButton = document.createElement("button");
  updateButton.type = "button";
  updateButton.className = "footer-update";
  updateButton.dataset.railKey = "footer:update";
  updateButton.hidden = true;
  versionGroup.append(identity, updateButton);
  const status = document.createElement("button");
  status.type = "button";
  status.className = "footer-status";
  status.dataset.railKey = "footer:status";
  status.disabled = true;
  const statusRegion = document.createElement("div");
  statusRegion.id = "rail-status";
  statusRegion.className = "footer-status-region";
  statusRegion.setAttribute("role", "status");
  statusRegion.setAttribute("aria-live", "polite");
  statusRegion.setAttribute("aria-atomic", "true");
  statusRegion.append(status);
  const actions = document.createElement("nav");
  actions.className = "footer-actions";
  let update: UpdateSnapshot | undefined;
  let includeBetaUpdates: boolean | undefined;
  let connection: string | undefined;
  let issue = "";

  const refreshStatus = () => {
    // Availability comes from the updater's resolved target, including one
    // retained after a temporary recheck/download failure. History alone is
    // insufficient: startup and preference changes have no resolved target.
    const matchesPreference =
      includeBetaUpdates !== undefined &&
      update?.includeBetaUpdates === includeBetaUpdates;
    const allowedTarget =
      !!update?.latestVersion &&
      matchesPreference &&
      (update.includeBetaUpdates || !isPrereleaseVersion(update.latestVersion));
    const targetVersion =
      update?.configured &&
      allowedTarget &&
      update.lastSuccessfulCheck != null &&
      ["available", "checking", "downloading", "ready", "installing"].includes(
        update.phase,
      )
        ? update.latestVersion
        : null;
    updateButton.hidden = !targetVersion;
    updateButton.textContent = targetVersion
      ? t("updates.footer.updateTo", { version: targetVersion })
      : "";
    updateButton.title = targetVersion
      ? t("updates.footer.availableTooltip", {
          version: targetVersion,
        })
      : "";
    const text =
      issue ||
      (connection === "offline" ? t("footer.status.offline") : "") ||
      (update &&
      matchesPreference &&
      update.phase !== "idle" &&
      update.phase !== "unconfigured" &&
      !(update.phase === "available" && !allowedTarget) &&
      !(
        targetVersion &&
        update.phase === "available" &&
        !updateHasError(update)
      )
        ? updateStatusText(update)
        : "");
    status.textContent = text;
    status.title = text;
    status.disabled =
      !text ||
      Boolean(issue) ||
      connection === "offline" ||
      !update?.latestVersion;
    status.classList.toggle("actionable", !status.disabled);
  };
  const openSection = (section: string) => {
    void invoke("open_settings", { section }).catch(() => {
      issue = t("rail.settingsError");
      refreshStatus();
    });
  };
  updateButton.addEventListener("click", () => openSection("updates"));
  status.addEventListener("click", () => openSection("updates"));
  const entries = [
    {
      key: "console",
      path: '<path d="m4 6 6 6-6 6m9 0h7"/>',
      enabled: false,
    },
    {
      key: "donate",
      path: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
      enabled: false,
    },
    {
      key: "feedback",
      path: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8Z"/><path d="M7 8h9M7 12h6"/>',
      enabled: true,
    },
    {
      key: "about",
      path: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
      enabled: true,
    },
  ] as const;
  for (const entry of entries) {
    const wrapper = document.createElement("span");
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = !entry.enabled;
    button.dataset.footerAction = entry.key;
    button.dataset.railKey = `footer:${entry.key}`;
    button.append(icon(entry.path), document.createElement("span"));
    if (entry.enabled) {
      button.addEventListener("click", () => {
        if (entry.key === "about") openSection("about");
        else {
          void invoke("open_project_link", { link: "issues" }).catch(() => {
            issue = t("footer.linkError");
            refreshStatus();
          });
        }
      });
    }
    wrapper.append(button);
    actions.append(wrapper);
  }
  element.append(versionGroup, statusRegion, actions);
  const refresh = () => {
    actions.setAttribute("aria-label", t("footer.actions"));
    for (const entry of entries) {
      const button = actions.querySelector<HTMLButtonElement>(
        `[data-footer-action="${entry.key}"]`,
      )!;
      const label = t(`footer.${entry.key}`);
      button.lastElementChild!.textContent = label;
      button.title = entry.enabled ? label : t("footer.comingSoon");
      button.parentElement!.title = button.title;
      button.setAttribute(
        "aria-label",
        entry.enabled ? label : `${label} — ${t("footer.comingSoon")}`,
      );
    }
    refreshStatus();
  };
  refresh();
  return {
    element,
    refresh,
    report(message: string) {
      issue = message;
      refreshStatus();
    },
    setUpdate(snapshot: UpdateSnapshot) {
      update = snapshot;
      issue = "";
      refreshStatus();
    },
    setIncludeBetaUpdates(value: boolean) {
      // A late update event can describe the preference from before Save.
      // Only saved settings can authorize its resolved target for this footer.
      includeBetaUpdates = value;
      refreshStatus();
    },
    setConnection(value: string) {
      connection = value;
      refreshStatus();
    },
  };
}
