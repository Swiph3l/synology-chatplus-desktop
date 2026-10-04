import { listen } from "@tauri-apps/api/event";
import { updates, updateMessage, type UpdateSnapshot } from "../app/updates";
import { t } from "../i18n";
import { initializeLanguage } from "../i18n/runtime";
import { bindShellTheme } from "../theme/theme";

async function confirmInstallation(): Promise<boolean> {
  if (document.querySelector("dialog[open]")) return false;
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "confirmation-dialog";
  dialog.setAttribute("aria-labelledby", "update-confirm-title");
  dialog.setAttribute("aria-describedby", "update-confirm-description");
  const title = document.createElement("h2");
  title.id = "update-confirm-title";
  title.textContent = t("updates.confirmTitle");
  const description = document.createElement("p");
  description.id = "update-confirm-description";
  description.textContent = t("updates.confirmDescription");
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
  dialog.append(title, description, actions);
  document.body.append(dialog);
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (confirmed: boolean) => {
      if (finished) return;
      finished = true;
      dialog.close();
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
): Promise<() => void> {
  container.innerHTML = `
    <h2 id="update-heading"></h2>
    <p id="update-version"></p><p id="update-latest" hidden></p>
    <small id="update-last-check"></small>
    <p id="update-message" role="status" aria-live="polite"></p>
    <div id="download-progress" hidden><progress id="progress" max="100"></progress><p id="download-size"></p></div>
    <div class="update-actions"><button id="check-updates" type="button" class="secondary"></button><button id="release-page" type="button" class="secondary" hidden></button><button id="download-update" type="button" hidden></button><button id="cancel-update" type="button" class="secondary" hidden></button><button id="install-update" type="button" hidden></button></div>
    <section id="release-notes" hidden><h3 id="notes-heading"></h3><pre id="notes" class="release-notes"></pre></section>`;
  const el = (id: string) => container.querySelector<HTMLElement>(`#${id}`)!;
  let lastState: UpdateSnapshot | undefined;
  const render = (state: UpdateSnapshot) => {
    lastState = state;
    el("update-heading").textContent = t(
      state.phase === "ready"
        ? "updates.readyHeading"
        : state.latestVersion
          ? "updates.availableHeading"
          : "updates.heading",
    );
    el("update-version").textContent = t("updates.installed", {
      version: state.currentVersion,
    });
    el("update-latest").hidden = !state.latestVersion;
    el("update-latest").textContent = state.latestVersion
      ? t("updates.latest", { version: state.latestVersion })
      : "";
    el("update-last-check").textContent = state.lastSuccessfulCheck
      ? t("updates.lastCheck", {
          time: new Date(state.lastSuccessfulCheck * 1000).toLocaleString(
            document.documentElement.lang || "en",
          ),
        })
      : t("updates.neverChecked");
    el("update-message").textContent = updateMessage(state);
    // Swiph3l: Release notes come from remote metadata. Text rendering keeps them
    // readable without granting HTML or script access to the desktop shell.
    el("notes").textContent = state.notes || "";
    el("notes-heading").textContent = t("updates.notes");
    el("release-notes").hidden = !state.notes;
    el("download-update").hidden = state.phase !== "available";
    el("install-update").hidden = state.phase !== "ready";
    el("cancel-update").hidden = state.phase !== "downloading";
    (el("check-updates") as HTMLButtonElement).disabled = [
      "checking",
      "downloading",
      "ready",
      "installing",
    ].includes(state.phase);
    el("release-page").hidden = !state.latestVersion;
    el("download-progress").hidden = state.phase !== "downloading";
    el("progress").setAttribute("aria-label", t("updates.status.downloading"));
    const progress = el("progress") as HTMLProgressElement;
    if (state.total && state.total > 0)
      progress.value = Math.min(100, (100 * state.downloaded) / state.total);
    else progress.removeAttribute("value");
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";
    el("download-size").textContent = state.total
      ? `${mb(state.downloaded)} / ${mb(state.total)}`
      : t("updates.downloaded", { size: mb(state.downloaded || 0) });
    el("check-updates").textContent = t("updates.check");
    el("release-page").textContent = t("updates.releasePage");
    el("download-update").textContent = t("updates.download");
    el("cancel-update").textContent = t("updates.cancelDownload");
    el("install-update").textContent = t("updates.install");
  };
  const pendingActions = new Set<string>();
  const action = (id: string, fn: () => Promise<unknown>) =>
    el(id).addEventListener("click", () => {
      const button = el(id) as HTMLButtonElement;
      if (pendingActions.has(id) || button.disabled) return;
      // Swiph3l: Cancellation must remain available while the download promise
      // is pending; serialize each action without locking every update control.
      pendingActions.add(id);
      button.disabled = true;
      void fn()
        .catch(() => {
          el("update-message").textContent = t("updates.failure");
        })
        .finally(() => {
          pendingActions.delete(id);
          button.disabled =
            id === "check-updates" &&
            !!lastState &&
            ["checking", "downloading", "ready", "installing"].includes(
              lastState.phase,
            );
        });
    });
  let eventRevision = 0;
  const unlisten = await listen<UpdateSnapshot>(
    "update-state",
    ({ payload }) => {
      eventRevision++;
      render(payload);
    },
  );
  const refreshLanguage = () => {
    if (lastState) render(lastState);
  };
  const cleanup = () => {
    unlisten();
    window.removeEventListener("language-changed", refreshLanguage);
    window.removeEventListener("pagehide", cleanup);
  };
  window.addEventListener("language-changed", refreshLanguage);
  window.addEventListener("pagehide", cleanup, { once: true });
  const initialRevision = eventRevision;
  try {
    const state = await updates.getState();
    // Swiph3l: A live progress event can overtake the initial IPC response;
    // never replace the newer event with an older fetched snapshot.
    if (eventRevision === initialRevision) render(state);
  } catch {
    el("update-heading").textContent = t("updates.heading");
    el("check-updates").textContent = t("updates.check");
    el("update-message").textContent = t("updates.failure");
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
    if (await confirmInstallation()) await updates.installUpdate(true);
  });
  return cleanup;
}

export async function renderUpdate() {
  await initializeLanguage();
  await bindShellTheme();
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
