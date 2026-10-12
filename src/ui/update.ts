import { listen } from "@tauri-apps/api/event";
import {
  updates,
  updateMessage,
  updateHasError,
  updatePhaseText,
  isPrereleaseVersion,
  type UpdateSnapshot,
} from "../app/updates";
import { localizeError, t } from "../i18n";
import { initializeLanguage } from "../i18n/runtime";
import { bindShellTheme } from "../theme/theme";

async function confirmInstallation(version: string): Promise<boolean> {
  if (document.querySelector("dialog[open]")) return false;
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "confirmation-dialog";
  dialog.setAttribute("aria-labelledby", "update-confirm-title");
  dialog.setAttribute(
    "aria-describedby",
    "update-confirm-description update-confirm-help",
  );
  const title = document.createElement("h2");
  title.id = "update-confirm-title";
  title.textContent = t("updates.confirmTitle");
  const description = document.createElement("p");
  description.id = "update-confirm-description";
  description.textContent = t("updates.confirmVersionDescription", { version });
  const help = document.createElement("p");
  help.id = "update-confirm-help";
  help.className = "confirmation-dialog-help";
  help.textContent = t("updates.confirmSettingsHelp");
  const actions = document.createElement("div");
  actions.className = "actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("updates.cancel");
  const install = document.createElement("button");
  install.type = "button";
  install.textContent = t("updates.confirm");
  actions.append(cancel, install);
  const content = document.createElement("div");
  content.className = "confirmation-dialog-content";
  content.append(title, description, help);
  dialog.append(content, actions);
  document.body.append(dialog);
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (confirmed: boolean) => {
      if (finished) return;
      finished = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(confirmed);
    };
    cancel.addEventListener("click", () => finish(false));
    install.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("close", () => finish(false));
    try {
      dialog.showModal();
      cancel.focus();
    } catch (error) {
      dialog.remove();
      reject(error);
    }
  });
}

export async function mountUpdatePanel(
  container: HTMLElement,
  options: {
    hasUnsavedChanges?: () => boolean;
    isSettingsSaving?: () => boolean;
    getDraftIncludeBetaUpdates?: () => boolean;
  } = {},
): Promise<() => void> {
  container.innerHTML = `
    <div class="update-summary">
    <div class="update-summary-heading"><h2 id="update-heading"></h2><span id="update-phase" class="update-phase"></span></div>
    <dl class="update-metadata">
      <div><dt id="update-version-label"></dt><dd id="update-version"></dd></div>
      <div><dt id="update-release-type-label"></dt><dd id="update-release-type"></dd></div>
      <div><dt id="update-last-check-label"></dt><dd id="update-last-check"></dd></div>
      <div id="update-latest-row" hidden><dt id="update-latest-label"></dt><dd id="update-latest"></dd></div>
    </dl>
    <small id="update-preference-help"></small>
    <small id="update-preference-draft" hidden></small>
    <p id="update-message" role="status" aria-live="polite"></p>
    <small id="update-settings-warning" hidden></small>
    <div id="download-progress" hidden><progress id="progress" max="100"></progress><p id="download-size"></p></div>
    </div>
    <div class="update-actions"><button id="check-updates" type="button" class="secondary"></button><button id="release-page" type="button" class="secondary" hidden></button><button id="download-update" type="button" hidden></button><button id="cancel-update" type="button" class="secondary" hidden></button><button id="install-update" type="button" hidden></button></div>
    <section id="release-notes" hidden><h3 id="notes-heading"></h3><pre id="notes" class="release-notes" tabindex="0" aria-labelledby="notes-heading"></pre></section>`;
  // Swiph3l: Settings places actions above flowing notes; the standalone window keeps them below, so DOM order must follow the visible keyboard order too.
  if (container.closest(".update-page"))
    container.append(container.querySelector(".update-actions")!);
  const el = (id: string) => container.querySelector<HTMLElement>(`#${id}`)!;
  let lastState: UpdateSnapshot | undefined;
  let disposed = false;
  let subscriptionFailed = false;
  let localError: string | null = null;
  const pendingActions = new Set<string>();
  const busy = (state?: UpdateSnapshot) =>
    !!state &&
    ["checking", "downloading", "ready", "installing"].includes(state.phase);
  const unsavedSettings = () =>
    !!options.hasUnsavedChanges?.() || !!options.isSettingsSaving?.();
  const render = (state = lastState) => {
    if (disposed) return;
    if (state) lastState = state;
    el("update-heading").textContent = t("updates.heading");
    el("update-version-label").textContent = t("updates.currentVersion");
    el("update-release-type-label").textContent = t("updates.releaseType");
    el("update-last-check-label").textContent = t("updates.lastCheckedLabel");
    el("update-latest-label").textContent = t("updates.availableVersion");
    el("update-version").textContent = state?.currentVersion ?? "—";
    el("update-release-type").textContent = state
      ? t(
          isPrereleaseVersion(state.currentVersion)
            ? "updates.preRelease"
            : "updates.stable",
        )
      : "—";
    el("update-preference-help").hidden = !state;
    el("update-preference-help").textContent = state
      ? t(
          state.includeBetaUpdates
            ? "updates.stableAndBetaHelp"
            : "updates.stableOnlyHelp",
        )
      : "";
    el("update-latest-row").hidden = !state?.latestVersion;
    el("update-latest").textContent = state?.latestVersion ?? "";
    el("update-last-check").textContent = state?.lastSuccessfulCheck
      ? new Date(state.lastSuccessfulCheck * 1000).toLocaleString(
          document.documentElement.lang || "en",
        )
      : t("updates.neverChecked");
    el("update-message").textContent =
      localError ??
      (subscriptionFailed
        ? t("updates.subscriptionFailed")
        : state
          ? updateMessage(state)
          : "");
    el("update-phase").textContent =
      localError || subscriptionFailed
        ? t("updates.phase.error")
        : state
          ? updatePhaseText(state)
          : t("updates.phase.idle");
    el("update-phase").dataset.phase =
      localError || subscriptionFailed || (state && updateHasError(state))
        ? "error"
        : (state?.phase ?? "idle");
    const draftIncludeBetaUpdates = options.getDraftIncludeBetaUpdates?.();
    el("update-preference-draft").hidden =
      !state ||
      draftIncludeBetaUpdates === undefined ||
      draftIncludeBetaUpdates === state.includeBetaUpdates;
    el("update-preference-draft").textContent = t(
      "updates.preferencesDraftHelp",
    );
    el("update-settings-warning").hidden =
      state?.phase !== "ready" || !unsavedSettings();
    el("update-settings-warning").textContent = t("updates.unsavedSettings");
    // Swiph3l: Release notes come from remote metadata. Text rendering keeps them
    // readable without granting HTML or script access to the desktop shell.
    el("notes").textContent = state?.notes || "";
    el("notes-heading").textContent = t("updates.notes");
    el("release-notes").hidden = !state?.notes;
    el("download-update").hidden = state?.phase !== "available";
    el("install-update").hidden = state?.phase !== "ready";
    el("cancel-update").hidden = state?.phase !== "downloading";
    (el("check-updates") as HTMLButtonElement).disabled =
      (!subscriptionFailed && busy(state)) ||
      pendingActions.has("check-updates");
    (el("download-update") as HTMLButtonElement).disabled =
      subscriptionFailed || pendingActions.has("download-update");
    (el("install-update") as HTMLButtonElement).disabled =
      subscriptionFailed ||
      pendingActions.has("install-update") ||
      unsavedSettings();
    if (state?.phase === "ready" && unsavedSettings())
      el("install-update").setAttribute(
        "aria-describedby",
        "update-settings-warning",
      );
    else el("install-update").removeAttribute("aria-describedby");
    (el("cancel-update") as HTMLButtonElement).disabled =
      pendingActions.has("cancel-update");
    (el("release-page") as HTMLButtonElement).disabled =
      pendingActions.has("release-page");
    el("release-page").hidden = !state?.latestVersion;
    el("download-progress").hidden = state?.phase !== "downloading";
    el("progress").setAttribute("aria-label", t("updates.status.downloading"));
    const progress = el("progress") as HTMLProgressElement;
    if (state?.total && state.total > 0)
      progress.value = Math.min(100, (100 * state.downloaded) / state.total);
    else progress.removeAttribute("value");
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";
    el("download-size").textContent = state?.total
      ? `${mb(state.downloaded)} / ${mb(state.total)}`
      : t("updates.downloaded", { size: mb(state?.downloaded || 0) });
    el("check-updates").textContent = t("updates.check");
    el("release-page").textContent = t("updates.releasePage");
    el("download-update").textContent = t("updates.download");
    el("cancel-update").textContent = t("updates.cancelDownload");
    el("install-update").textContent = t("updates.install");
  };
  const action = (id: string, fn: () => Promise<unknown>) =>
    el(id).addEventListener("click", () => {
      const button = el(id) as HTMLButtonElement;
      if (pendingActions.has(id) || button.disabled) return;
      const restoreFocus = document.activeElement === button;
      // Swiph3l: Cancellation must remain available while the download promise
      // is pending; serialize each action without locking every update control.
      pendingActions.add(id);
      const startedRevision = eventRevision;
      const startedIncludeBetaUpdates = lastState?.includeBetaUpdates;
      const startedVersion = lastState?.latestVersion;
      localError = null;
      render();
      void fn()
        .catch((error) => {
          if (disposed) return;
          if (
            ["check-updates", "download-update", "install-update"].includes(
              id,
            ) &&
            eventRevision !== startedRevision
          ) {
            const matchingFailure =
              lastState &&
              updateHasError(lastState) &&
              (id === "check-updates" ||
                (id === "download-update" &&
                  lastState.messageCode === "download-failed") ||
                (id === "install-update" &&
                  lastState.messageCode === "install-failed"));
            const changedIdentity =
              lastState?.includeBetaUpdates !== startedIncludeBetaUpdates ||
              (id !== "check-updates" &&
                lastState?.latestVersion !== startedVersion);
            if (changedIdentity || !matchingFailure) return;
          }
          localError =
            lastState && updateHasError(lastState)
              ? updateMessage(lastState)
              : localizeError(error, "updates.failure");
          render();
        })
        .finally(() => {
          pendingActions.delete(id);
          render();
          if (
            !disposed &&
            restoreFocus &&
            document.hasFocus() &&
            document.activeElement === document.body &&
            !document.querySelector("dialog[open]")
          ) {
            const fallback = el("check-updates") as HTMLButtonElement;
            const target =
              !button.hidden && !button.disabled
                ? button
                : !fallback.disabled
                  ? fallback
                  : null;
            target?.focus({ preventScroll: true });
          }
        });
    });
  let eventRevision = 0;
  let unlisten = () => {};
  try {
    unlisten = await listen<UpdateSnapshot>("update-state", ({ payload }) => {
      eventRevision++;
      localError = null;
      render(payload);
    });
  } catch {
    subscriptionFailed = true;
  }
  const refreshLanguage = () => {
    render();
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unlisten();
    window.removeEventListener("language-changed", refreshLanguage);
    window.removeEventListener("settings-draft-changed", refreshLanguage);
    window.removeEventListener("pagehide", cleanup);
  };
  window.addEventListener("language-changed", refreshLanguage);
  window.addEventListener("settings-draft-changed", refreshLanguage);
  window.addEventListener("pagehide", cleanup, { once: true });
  const initialRevision = eventRevision;
  render();
  try {
    const state = await updates.getState();
    // Swiph3l: A live progress event can overtake the initial IPC response;
    // never replace the newer event with an older fetched snapshot.
    if (eventRevision === initialRevision) render(state);
  } catch {
    if (eventRevision === initialRevision) {
      localError = t("updates.failure");
      render();
    }
  }
  action("release-page", updates.openReleasePage);
  action("check-updates", async () => {
    const revision = eventRevision;
    const state = await updates.checkForUpdates();
    if (revision === eventRevision) render(state);
  });
  action("download-update", updates.downloadUpdate);
  action("cancel-update", updates.cancelDownload);
  action("install-update", async () => {
    // Swiph3l: A verified download is not installation consent; asking here also
    // prevents a background availability event from ever initiating a restart.
    const consent =
      lastState?.phase === "ready" && lastState.latestVersion
        ? {
            version: lastState.latestVersion,
            includeBetaUpdates: lastState.includeBetaUpdates,
          }
        : null;
    if (!consent || unsavedSettings()) return;
    if (!(await confirmInstallation(consent.version)) || disposed) return;
    if (unsavedSettings()) {
      localError = t("updates.unsavedSettings");
      render();
      return;
    }
    if (
      lastState?.phase !== "ready" ||
      lastState.latestVersion !== consent.version ||
      lastState.includeBetaUpdates !== consent.includeBetaUpdates
    ) {
      localError = t("updates.confirmChanged");
      render();
      return;
    }
    await updates.installUpdate(
      true,
      consent.version,
      consent.includeBetaUpdates,
    );
  });
  return cleanup;
}

export async function renderUpdate() {
  await initializeLanguage();
  await bindShellTheme();
  document.body.classList.add("update-page");
  const app = document.querySelector<HTMLElement>("#app")!;
  app.innerHTML =
    '<header class="page-header"><img class="brand" src="/chatplus.png" width="32" height="32" alt=""><h1 id="update-title"></h1></header><div id="update-details"></div><div class="actions"><button id="later" type="button" class="secondary"></button></div>';
  const refreshLanguage = () => {
    document.getElementById("update-title")!.textContent = t("updates.heading");
    document.getElementById("later")!.textContent = t("updates.later");
  };
  refreshLanguage();
  window.addEventListener("language-changed", refreshLanguage);
  document.getElementById("later")!.addEventListener("click", () => {
    void updates.dismiss();
  });
  await mountUpdatePanel(document.getElementById("update-details")!);
  window.addEventListener(
    "pagehide",
    () => window.removeEventListener("language-changed", refreshLanguage),
    { once: true },
  );
}
