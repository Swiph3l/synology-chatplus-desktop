import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
const result = await build({
  entryPoints: ["src/settings/changelog.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "changelog",
  loader: { ".md": "text" },
});
const { document } = parseHTML(
  '<html><body><div id="notes"></div></body></html>',
);
const context = { document };
runInNewContext(result.outputFiles[0].text, context);
test("bundled release parsing retains version/date, categories and multiline entries", () => {
  const releases = context.changelog.parseChangelog(
    "# Changelog\n## 0.5.0-beta.4 — 2026-10-04\n### Added\n- New feature\n  continued.\n### Changed\n- Improved navigation.\n### Fixed\n- Read acknowledgement.",
  );
  assert.equal(releases[0].version, "0.5.0-beta.4");
  assert.equal(releases[0].detail, "2026-10-04");
  assert.equal(releases[0].sections[0].items[0], "New feature continued.");
  assert.equal(releases[0].sections[2].heading, "Fixed");
});
test("release notes render as safe text and use the repository source without network", () => {
  const container = document.getElementById("notes");
  context.changelog.renderChangelog(
    container,
    '## 0.5.0\n### Added\n- <img src=x onerror="alert(1)">',
  );
  assert.equal(container.querySelector("img"), null);
  assert.match(container.textContent, /<img/);
  context.changelog.renderChangelog(container);
  assert.match(container.textContent, /0\.5\.0-beta\.3/);
  assert.ok(container.querySelectorAll("article").length > 1);
});
