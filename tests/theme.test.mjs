import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import "../scripts/build-theme.mjs";
const script = await readFile("src-tauri/theme-bootstrap.js", "utf8");
test("bundled bootstrap injects actual CSS before page content and follows system theme", () => {
  const root = {
    dataset: {},
    appendChild(style) {
      style.isConnected = true;
      this.style = style;
    },
  };
  const media = {
    matches: true,
    addEventListener(_, callback) {
      this.change = callback;
    },
  };
  const window = { __chatplusTheme: "system" };
  runInNewContext(script, {
    window,
    document: {
      documentElement: root,
      createElement: () => ({}),
      addEventListener() {},
    },
    matchMedia: () => media,
    MutationObserver: class {
      observe() {}
    },
  });
  assert.match(root.style.textContent, /--eos-bg-surface-z0/);
  assert.equal(root.dataset.chatplusTheme, "dark");
  media.matches = false;
  media.change();
  assert.equal(root.dataset.chatplusTheme, "light");
  window.__chatplusSetTheme("dark");
  assert.equal(root.dataset.chatplusTheme, "dark");
  window.__chatplusSetTheme("light");
  assert.equal(root.dataset.chatplusTheme, "light");
});
