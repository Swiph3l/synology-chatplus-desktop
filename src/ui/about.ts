import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasSupport, type AboutInfo, type ProjectLink } from "../app/about";
import { updates } from "../app/updates";
import { t, localizeError, type TranslationKey } from "../i18n";
import { initializeLanguage } from "../i18n/runtime";
import { bindShellTheme } from "../theme/theme";

export async function mountAboutPanel(container: HTMLElement) {
  container.classList.add("about-details");
  container.innerHTML = `
    <header class="page-header"><img class="brand" src="/chatplus.png" alt="" width="32" height="32"><div><h2 data-about="name">ChatPlus</h2><p data-about="version" class="subtitle"></p></div></header>
    <p class="about-description">${t("about.description")}</p>
    <p class="credits">${t("about.maintained")} <strong data-about="maintainer"></strong></p>
    <p class="about-notice subtitle">${t("about.notice")}</p>
    <div class="actions"><button type="button" data-link="github" class="secondary">${t("about.github")}</button><button type="button" data-link="issues" class="secondary">${t("about.issues")}</button><button type="button" data-link="star" class="secondary">${t("about.star")}</button><button type="button" data-link="support" class="secondary" hidden>${t("about.support")}</button></div>
    <details class="technical-details"><summary>${t("about.technical")}</summary><dl data-about="build"></dl><dl data-about="runtime"></dl><button type="button" data-action="copy" class="secondary">${t("about.copy")}</button></details>
    <section class="license-section"><h3>${t("about.license")}</h3><p data-about="license" class="subtitle"></p><button data-action="license" class="text-button" type="button">${t("about.viewLicense")}</button></section>
    <p data-about="status" role="status" aria-live="polite"></p>`;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
    container.querySelector<T>(selector)!;
  const status = find('[data-about="status"]');
  const text = (field: string, value: string) => {
    find(`[data-about="${field}"]`).textContent = value;
  };
  const available = (value: string | null) => value || t("common.unavailable");
  const yesNo = (value: boolean | null) =>
    t(
      value === null
        ? "common.unavailable"
        : value
          ? "common.yes"
          : "common.no",
    );
  const rows = (field: string, values: [string, string][]) => {
    const fragment = document.createDocumentFragment();
    for (const [label, value] of values) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dd.title = value;
      fragment.append(dt, dd);
    }
    find(`[data-about="${field}"]`).replaceChildren(fragment);
  };
  const refresh = async () => {
    const info = await invoke<AboutInfo>("get_about_info");
    const build = info.build;
    const runtime = info.runtime;
    const update = await updates.getState();
    text("name", "ChatPlus");
    text("version", t("common.version", { version: build.display_version }));
    text("maintainer", info.project.maintainer);
    text("license", info.project.license);
    rows("build", [
      [t("common.version", { version: "" }).trim(), build.display_version],
      [
        t("about.updateChannel"),
        t(
          update.channel === "pre-release"
            ? "updates.preRelease"
            : "updates.stable",
        ),
      ],
      [t("about.build"), build.build_date_utc],
      [
        t("about.commitBranch"),
        `${available(build.git_commit_short)} / ${available(build.git_branch)}`,
      ],
      [
        t("about.channelDirty"),
        `${build.build_channel} / ${yesNo(build.is_dirty)}`,
      ],
    ]);
    const connectionKey = `common.${info.connection_state.toLowerCase()}`;
    const ownedConnection = [
      "common.connected",
      "common.connecting",
      "common.disconnected",
      "common.offline",
      "common.unknown",
      "common.error",
    ].includes(connectionKey);
    rows("runtime", [
      [t("about.sourceVersion"), build.semantic_version],
      [t("about.gitCommit"), available(build.git_commit_full)],
      [t("about.gitTag"), available(build.git_tag)],
      [t("about.os"), runtime.os],
      [t("about.architecture"), runtime.architecture],
      ["Tauri", runtime.tauri_version],
      ["Rust", available(build.rust_version)],
      [t("about.webview"), runtime.webview_version],
      [t("settings.theme"), t(`settings.${info.theme}`)],
      [t("about.serverConfigured"), yesNo(info.server_configured)],
      [
        t("about.connection"),
        ownedConnection
          ? t(connectionKey as TranslationKey)
          : info.connection_state,
      ],
    ]);
    find<HTMLButtonElement>('[data-link="support"]').hidden = !hasSupport(
      info.project.support_url,
    );
    find<HTMLButtonElement>('[data-link="github"]').disabled =
      !info.project.github_repository_url;
    find<HTMLButtonElement>('[data-link="issues"]').disabled =
      !info.project.github_issues_url;
    find<HTMLButtonElement>('[data-link="star"]').disabled =
      !info.project.github_star_url;
  };
  for (const button of container.querySelectorAll<HTMLButtonElement>(
    "[data-link]",
  )) {
    button.addEventListener("click", () => {
      void invoke("open_project_link", {
        link: button.dataset.link as ProjectLink,
      }).catch(() => {
        status.textContent = t("about.browserError");
      });
    });
  }
  find('[data-action="license"]').addEventListener("click", () => {
    void invoke("show_license").catch(() => {
      status.textContent = t("about.licenseError");
    });
  });
  find('[data-action="copy"]').addEventListener("click", async () => {
    try {
      await invoke("copy_diagnostics");
      status.textContent = t("about.copySuccess");
    } catch (error) {
      status.textContent = localizeError(error, "about.copyError");
    }
  });
  const unlisten = await listen("connection-changed", () => {
    void refresh().catch(() => {
      status.textContent = t("about.infoError");
    });
  });
  try {
    await refresh();
  } catch {
    status.textContent = t("about.infoError");
  }
  return unlisten;
}
export async function renderAbout() {
  await initializeLanguage();
  await bindShellTheme();
  document.body.classList.add("about-page");
  await mountAboutPanel(document.querySelector<HTMLElement>("#app")!);
}
