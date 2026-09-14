import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import "../scripts/build-theme.mjs";
const script = await readFile("src-tauri/theme-bootstrap.js", "utf8");
const css = await readFile("src/theme/dark.css", "utf8");

test("form surface overrides stay inside dark EOS and scope native textarea fallback", () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const formRules = rules.filter(([, selectors]) =>
    /body\.eos-scope\s+:is\(/.test(selectors),
  );
  assert.ok(
    formRules.length >= 5,
    "surface, text, transparency and focus rules",
  );
  for (const [, selectors] of formRules) {
    // Split top-level selector lists without splitting arguments inside :is().
    for (const selector of selectors.split(/,(?![^()]*\))/)) {
      assert.match(
        selector.trim(),
        /^:root\[data-chatplus-theme="dark"\]\s+body\.eos-scope\s/,
      );
    }
  }
  assert.doesNotMatch(css, /\[class\*=["']textarea/);
  assert.doesNotMatch(css, /body\.eos-scope\s+textarea\s*[{,]/);
  for (const selector of [
    ".v-textfield-wrapper input",
    ".v-textfield-input",
    ".v-textfield-textarea",
    ".v-textarea-wrapper textarea",
    ".v-form-item textarea",
    ".v-form-item-control textarea",
    '[role="dialog"] textarea',
  ]) {
    assert.ok(
      formRules.some(([, selectors]) => selectors.includes(selector)),
      selector,
    );
  }
  assert.match(css, /\.v-checkbox-wrapper[^{}]*\.v-checkbox-icon\s*\{/);
  assert.match(css, /\.v-checkbox-wrapper\.disabled/);
});
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
