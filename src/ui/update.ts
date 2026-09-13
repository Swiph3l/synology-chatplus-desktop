import { listen } from "@tauri-apps/api/event";
import { updates, type UpdateSnapshot } from "../app/updates";
import { bindShellTheme } from "../theme/theme";
export async function renderUpdate() {
  await bindShellTheme();
  document.querySelector("#app")!.innerHTML = `
    <header class="page-header"><img class="brand" src="/chatplus.png" width="32" height="32" alt=""><h1 id="update-heading">Updates</h1></header>
    <p id="update-version"></p><p id="update-message" role="status" aria-live="polite"></p>
    <section id="release-notes" hidden><h2>What's new</h2><pre id="notes" class="release-notes"></pre></section>
    <div id="download-progress" hidden><progress id="progress" max="100"></progress><p id="download-size"></p></div>
    <div class="update-actions"><button id="later" class="secondary">Later</button><button id="release-page" class="secondary">View release notes</button><button id="check-update" class="secondary">Check again</button><button id="download-update">Download update</button><button id="cancel-update" class="secondary">Cancel download</button><button id="install-update">Restart and update</button></div>`;
  const el = (id: string) => document.getElementById(id)!;
  const render = (state: UpdateSnapshot) => {
    el("update-heading").textContent =
      state.phase === "ready"
        ? "Update ready"
        : state.latestVersion
          ? "Update available"
          : "Updates";
    el("update-version").textContent = state.latestVersion
      ? `ChatPlus Desktop ${state.latestVersion} is available. You are using ${state.currentVersion}.`
      : `You are using ChatPlus Desktop ${state.currentVersion}.`;
    el("update-message").textContent = state.message;
    el("notes").textContent = state.notes;
    el("release-notes").hidden = !state.notes;
    el("download-update").hidden = state.phase !== "available";
    el("install-update").hidden = state.phase !== "ready";
    el("cancel-update").hidden = state.phase !== "downloading";
    el("check-update").hidden = [
      "checking",
      "downloading",
      "ready",
      "installing",
    ].includes(state.phase);
    el("release-page").hidden = !state.latestVersion;
    el("download-progress").hidden = state.phase !== "downloading";
    const progress = el("progress") as HTMLProgressElement;
    if (state.total && state.total > 0)
      progress.value = Math.min(100, (100 * state.downloaded) / state.total);
    else progress.removeAttribute("value");
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";
    el("download-size").textContent = state.total
      ? `${mb(state.downloaded)} / ${mb(state.total)}`
      : `${mb(state.downloaded)} downloaded`;
  };
  const action = (id: string, fn: () => Promise<unknown>) =>
    el(id).addEventListener("click", () => {
      void fn().catch((error) => {
        el("update-message").textContent =
          typeof error === "string"
            ? error
            : "The update operation failed. Try again.";
      });
    });
  await listen<UpdateSnapshot>("update-state", ({ payload }) =>
    render(payload),
  );
  render(await updates.getState());
  action("later", updates.dismiss);
  action("release-page", updates.openReleasePage);
  action("check-update", updates.checkForUpdates);
  action("download-update", updates.downloadUpdate);
  action("cancel-update", updates.cancelDownload);
  action("install-update", () => updates.installUpdate(true));
}
