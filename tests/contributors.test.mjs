import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";

const bundle = await build({
  stdin: {
    contents: [
      'export { mountAboutPanel } from "./src/ui/about.ts";',
      'export { mountContributors } from "./src/ui/contributors.ts";',
      'export { community, contributionKeys } from "./src/app/contributors.ts";',
      'export { setLanguage, resources } from "./src/i18n/index.ts";',
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "contributorsUi",
  plugins: [
    {
      name: "desktop-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\// }, ({ path }) => ({
          path,
          namespace: "desktop-fixture",
        }));
        builder.onLoad(
          { filter: /.*/, namespace: "desktop-fixture" },
          ({ path }) => ({
            contents: path.endsWith("core")
              ? "export const invoke = (...args) => globalThis.nativeInvoke(...args)"
              : "export const listen = (...args) => globalThis.nativeListen(...args)",
            loader: "js",
          }),
        );
        builder.onLoad({ filter: /[\\/]theme[\\/]theme\.ts$/ }, () => ({
          contents: "export const bindShellTheme = async () => {}",
          loader: "js",
        }));
      },
    },
  ],
});

function aboutInfo() {
  return {
    project: {
      project_name: "ChatPlus Desktop",
      project_description: "Fixture",
      maintainer: "Swiph3l",
      license: "GNU GPLv3",
      github_repository_url:
        "https://github.com/Swiph3l/synology-chatplus-desktop",
      github_issues_url:
        "https://github.com/Swiph3l/synology-chatplus-desktop/issues",
      github_star_url: "https://github.com/Swiph3l/synology-chatplus-desktop",
      support_url: null,
    },
    build: {
      semantic_version: "1.0.0",
      display_version: "1.0.0 development",
      build_date_utc: "2026-11-04T00:00:00Z",
      git_commit_full: "abc123",
      git_commit_short: "abc123",
      git_branch: "main",
      git_tag: null,
      build_channel: "development",
      is_dirty: false,
      rust_version: null,
    },
    runtime: {
      os: "fixture",
      architecture: "x86_64",
      tauri_version: "2",
      webview_version: "fixture",
    },
    theme: "system",
    server_configured: false,
    connection_state: "Unknown",
  };
}

function fixture({
  page = "about-page",
  language = "en",
  infoError = false,
} = {}) {
  const { window, document } = parseHTML(
    `<html><body class="${page}"><main id="app"><div id="panel"></div></main></body></html>`,
  );
  const calls = [],
    listeners = new Map();
  const context = {
    document,
    window,
    console,
    fetch: () => {
      throw new Error("About must stay offline");
    },
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_about_info") {
        if (infoError) throw new Error("Information unavailable");
        return aboutInfo();
      }
      if (command === "get_settings") return { language };
    },
    nativeListen: async (name, callback) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    },
  };
  runInNewContext(bundle.outputFiles[0].text, context);
  context.contributorsUi.setLanguage(language);
  return {
    document,
    window,
    calls,
    listeners,
    panel: document.getElementById("panel"),
    ui: context.contributorsUi,
    flush: async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
}

test("bundled credits keep human identities, recognized roles and variant references", () => {
  const { ui } = fixture();
  const ids = ui.community.contributors.map((person) => person.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("swiph3l") && ids.includes("turbogizzmo"));
  for (const person of ui.community.contributors) {
    assert.match(person.username, /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
    assert.doesNotMatch(person.username, /\[bot\]$/i);
    assert.ok(person.name.trim() && person.contributions.length);
    for (const role of person.contributions) {
      assert.ok(
        Object.hasOwn(ui.contributionKeys, role),
        `${person.id}: ${role}`,
      );
      for (const [language, resources] of Object.entries(ui.resources)) {
        assert.ok(
          resources[ui.contributionKeys[role]]?.trim(),
          `${language}: ${role}`,
        );
      }
    }
  }
  assert.equal(
    new Set(ui.community.forks.map((fork) => fork.id)).size,
    ui.community.forks.length,
  );
  for (const fork of ui.community.forks)
    assert.ok(ids.includes(fork.contributorId));
});

test("standalone and embedded About show offline credits before technical details and route every community action natively", async () => {
  const expected = [
    "community:contributors",
    "community:person:swiph3l",
    "community:person:turbogizzmo",
    "community:fork:turbogizzmo-windows",
    "community:fork:turbogizzmo-macos",
    "community:contribute",
    "community:fork",
    "community:forks",
  ];
  for (const page of ["about-page", "settings-page"]) {
    const f = fixture({ page, infoError: true });
    const dispose = await f.ui.mountAboutPanel(f.panel);
    const section = f.panel.querySelector(".community-section");
    assert.ok(section);
    assert.equal(section.querySelectorAll(".contributor-card").length, 2);
    assert.match(section.textContent, /Swiph3l/);
    assert.match(section.textContent, /turbogizzmo/);
    assert.equal(section.querySelectorAll("img, iframe, a[href]").length, 0);
    const children = [...f.panel.children];
    assert.ok(
      children.indexOf(f.panel.querySelector('[data-about="community"]')) <
        children.indexOf(f.panel.querySelector(".technical-details")),
    );
    const buttons = [...section.querySelectorAll("button[data-link]")];
    assert.deepEqual(
      buttons.map((button) => button.dataset.link),
      expected,
    );
    for (const button of buttons) {
      assert.ok(button.textContent.trim());
      assert.equal(button.type, "button");
      button.click();
    }
    await f.flush();
    assert.deepEqual(
      f.calls
        .filter(({ command }) => command === "open_project_link")
        .map(({ args }) => args.link),
      expected,
    );
    assert.equal(
      f.panel.querySelector('[data-about="status"]').textContent,
      f.ui.resources.en["about.infoError"],
    );
    dispose();
    assert.equal(f.listeners.size, 0);
  }
});

test("contributor names stay text and future Linux ports use the same native link contract", () => {
  const f = fixture({ language: "pl" });
  const registry = structuredClone(f.ui.community);
  registry.contributors[0].name = '<img src="remote" onerror="unsafe()">';
  registry.forks.push({
    id: "future-linux",
    contributorId: "swiph3l",
    owner: "Swiph3l",
    repository: "example",
    platform: "linux",
  });
  f.ui.mountContributors(f.panel, registry);
  assert.equal(f.panel.querySelectorAll("img, script, [onerror]").length, 0);
  assert.ok(f.panel.textContent.includes(registry.contributors[0].name));
  assert.equal(
    f.panel
      .querySelector('[data-link="community:person:swiph3l"]')
      .getAttribute("aria-label"),
    `${f.ui.resources.pl["about.communityProfile"]}: ${registry.contributors[0].name}`,
  );
  assert.match(
    f.panel.querySelector('[data-link="community:fork:future-linux"]')
      .textContent,
    /Linux/,
  );
});

test("community headings and invitations use the selected language in every supported locale", () => {
  const f = fixture();
  for (const [language, resources] of Object.entries(f.ui.resources)) {
    f.ui.setLanguage(language);
    f.ui.mountContributors(f.panel);
    assert.equal(
      f.panel.querySelector(".community-heading h3").textContent,
      resources["about.contributorsTitle"],
    );
    assert.equal(
      f.panel.querySelector(".community-invitation p").textContent,
      resources["about.communityContributeHelp"],
    );
    assert.doesNotMatch(
      f.panel.textContent,
      /undefined|about\.community|about\.contribution/,
    );
  }
});
