import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  available,
  hasSupport,
  yesNo,
  type AboutInfo,
  type ProjectLink,
} from "../app/about";
import { updates, type UpdateSnapshot } from "../app/updates";
import { applyTheme, bindShellTheme } from "../theme/theme";
export async function renderAbout() {
  document.body.classList.add("about-page");
  document.querySelector("#app")!.innerHTML = `
    <header class="page-header"><img class="brand" src="/chatplus.png" alt="ChatPlus Desktop icon" width="40" height="40"><div><h1 id="project-name">ChatPlus Desktop</h1><p id="version" class="subtitle"></p></div></header>
    <p id="description" class="subtitle about-description"></p>
    <p class="credits">Maintained by <strong id="maintainer"></strong></p>
    <p class="about-notice subtitle">Independent community project.<br>Not affiliated with Synology Inc.</p>
    <div class="actions"><button type="button" data-link="github" class="secondary">GitHub</button><button type="button" data-link="issues" class="secondary">Report issue</button><button type="button" data-link="star" class="secondary">Star on GitHub</button><button type="button" data-link="support" class="secondary" hidden>Support</button></div>
    <details class="technical-details"><summary>Technical details</summary><dl id="build"></dl><dl id="runtime"></dl><button type="button" id="copy" class="secondary">Copy Diagnostics</button></details>
    <section class="license-section"><h2>License</h2><p id="license" class="subtitle"></p><button id="view-license" class="text-button" type="button">View License</button></section>
    <p id="status" role="status" aria-live="polite"></p>
    `;
  const status = document.querySelector<HTMLElement>("#status")!;
  document.querySelector("#view-license")!.addEventListener("click", () => {
    void invoke("show_license").catch(() => {
      status.textContent = "Could not open the license.";
    });
  });
  const text = (id: string, value: string) => {
    document.getElementById(id)!.textContent = value;
  };
  const rows = (id: string, items: [string, string][]) => {
    const fragment = document.createDocumentFragment();
    for (const [label, value] of items) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dd.title = value;
      fragment.append(dt, dd);
    }
    document.getElementById(id)!.replaceChildren(fragment);
  };
  const refresh = async () => {
    const info = await invoke<AboutInfo>("get_about_info");
    const b = info.build;
    const r = info.runtime;
    text("project-name", info.project.project_name);
    text("version", `Version ${b.display_version}`);
    text("description", info.project.project_description);
    text("maintainer", info.project.maintainer);
    text("license", info.project.license);
    const update = await updates.getState();
    if (update.latestVersion)
      text("status", `Latest version: ${update.latestVersion}`);
    applyTheme(info.theme);
    rows("build", [
      ["Version", b.display_version],
      [
        "Update channel",
        update.channel === "stable" ? "Stable" : "Pre-release",
      ],
      ["Build", b.build_date_utc],
      [
        "Commit / branch",
        `${available(b.git_commit_short)} / ${available(b.git_branch)}`,
      ],
      ["Channel / dirty", `${b.build_channel} / ${yesNo(b.is_dirty)}`],
    ]);
    rows("runtime", [
      ["Source version", b.semantic_version],
      ["Git commit", available(b.git_commit_full)],
      ["Git tag", available(b.git_tag)],
      ["Operating system", r.os],
      ["Architecture", r.architecture],
      ["Tauri", r.tauri_version],
      ["Rust", available(b.rust_version)],
      ["WebView runtime", r.webview_version],
      ["Theme", info.theme],
      ["Server configured", yesNo(info.server_configured)],
      ["Connection", info.connection_state],
    ]);
    document.querySelector<HTMLButtonElement>("[data-link=support]")!.hidden =
      !hasSupport(info.project.support_url);
  };
  try {
    await bindShellTheme();
    await refresh();
    await listen("connection-changed", () => {
      void refresh();
    });
    await listen("theme-changed", () => {
      void refresh();
    });
    await listen<UpdateSnapshot>("update-state", ({ payload }) =>
      text(
        "status",
        payload.latestVersion
          ? `Latest version: ${payload.latestVersion}`
          : payload.message,
      ),
    );
  } catch {
    status.textContent = "Could not read application information.";
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-link]",
  ))
    button.addEventListener("click", () => {
      void invoke("open_project_link", {
        link: button.dataset.link as ProjectLink,
      }).catch(() => {
        status.textContent = "Could not open the default browser.";
      });
    });
  document.querySelector("#copy")!.addEventListener("click", async () => {
    try {
      await invoke("copy_diagnostics");
      status.textContent =
        "Diagnostics copied. No server address or account data is included.";
    } catch {
      status.textContent = "Could not copy diagnostics. Try again.";
    }
  });
}
