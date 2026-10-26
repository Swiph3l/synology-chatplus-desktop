import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const built = await build({
  entryPoints: ["src/ui/external-link.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "externalLinkUi",
  plugins: [
    {
      name: "native-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\// }, ({ path }) => ({
          path,
          namespace: "native-fixture",
        }));
        builder.onLoad(
          { filter: /.*/, namespace: "native-fixture" },
          ({ path }) => ({
            contents: path.endsWith("core")
              ? "export const invoke = (...args) => globalThis.nativeInvoke(...args)"
              : "export const listen = (...args) => globalThis.nativeListen(...args)",
            loader: "js",
          }),
        );
        builder.onLoad({ filter: /\.css$/ }, () => ({
          contents: "",
          loader: "js",
        }));
      },
    },
  ],
});
const defaults = {
  requestId: "request-17",
  url: "https://example.test/report?q=one&value=two",
  origin: "https://example.test",
  insecureHttp: false,
  theme: "dark",
  language: "en",
};
const settle = () => new Promise(setImmediate);

async function fixture(overrides = {}, behavior = {}) {
  const { window, document } = parseHTML(
    '<html><body><main id="app" aria-busy="true"></main></body></html>',
  );
  let focused = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  const calls = [];
  const listeners = new Map();
  const pending = [];
  let readySawCancelFocus = false;
  const context = {
    window,
    document,
    URL,
    nativeListen: async (name, callback) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    },
    nativeInvoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "get_external_link_prompt") {
        if (behavior.promptError)
          throw new Error("private prompt detail must not leak");
        if (behavior.themeDuringPrompt) {
          listeners.get("theme-changed")({
            payload: behavior.themeDuringPrompt,
          });
        }
        return { ...defaults, ...overrides };
      }
      if (command === "external_link_prompt_ready") {
        readySawCancelFocus =
          focused === document.querySelector(".external-link-cancel") &&
          document.querySelector(".external-link-url").textContent ===
            (overrides.url ?? defaults.url);
      }
      if (command === "respond_external_link_prompt") {
        if (behavior.deferred)
          await new Promise((resolve) => pending.push(resolve));
        if (behavior.responseError)
          throw new Error("private browser error must not leak");
      }
    },
  };
  runInNewContext(built.outputFiles[0].text, context);
  await context.externalLinkUi.renderExternalLink();
  const responses = () =>
    calls.filter(({ command }) => command === "respond_external_link_prompt");
  const key = (value, target = document, composing = false) => {
    const event = new window.Event("keydown", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "key", { value });
    Object.defineProperty(event, "isComposing", { value: composing });
    target.dispatchEvent(event);
    return event;
  };
  return {
    window,
    document,
    calls,
    listeners,
    pending,
    responses,
    key,
    readySawCancelFocus,
  };
}

test("prompt is ready only after safe default focus; external URLs remain selectable text without HTML/navigation", async () => {
  const url =
    'https://example.test/<img src=x onerror="globalThis.leaked=1">?q=<script>bad()</script>&value="quoted"';
  const f = await fixture({ url });
  assert.equal(f.readySawCancelFocus, true);
  assert.equal(f.document.activeElement.className, "external-link-cancel");
  assert.equal(f.document.querySelector(".external-link-url").textContent, url);
  assert.equal(f.document.querySelector(".external-link-url").readOnly, true);
  assert.equal(
    f.document.querySelector(".external-link-url").getAttribute("dir"),
    "ltr",
  );
  assert.equal(
    f.document.querySelector(".external-link-host").textContent,
    "example.test",
  );
  assert.equal(
    f.document.querySelectorAll("a, form, img, script, [onclick], [onerror]")
      .length,
    0,
  );
  assert.deepEqual(
    f.calls.map(({ command }) => command),
    ["get_external_link_prompt", "external_link_prompt_ready"],
  );
  assert.equal(f.responses().length, 0);
});

test("approval sends only retained request identity and a boolean, even when displayed URL is altered", async () => {
  const f = await fixture({}, { deferred: true });
  f.document.querySelector(".external-link-url").textContent =
    "https://replacement.invalid/";
  const open = f.document.querySelector(".external-link-open");
  open.click();
  open.click();
  f.document.querySelector(".external-link-cancel").click();
  f.key("Escape");
  assert.equal(
    f.responses().length,
    1,
    "concurrent clicks cannot approve/cancel the same request twice",
  );
  assert.equal(
    JSON.stringify(f.responses()[0].args),
    JSON.stringify({ requestId: "request-17", accepted: true }),
  );
  assert.equal(open.disabled, true);
  f.pending.shift()();
  await settle();
  open.click();
  assert.equal(f.responses().length, 1, "completed request is single-use");
});

test("Cancel and Escape reject; Enter on page/URL cannot approve and IME Escape is left alone", async () => {
  const keyboard = await fixture();
  keyboard.key("Enter");
  keyboard.key("Enter", keyboard.document.querySelector(".external-link-url"));
  keyboard.key("Escape", keyboard.document, true);
  assert.equal(keyboard.responses().length, 0);
  assert.equal(keyboard.key("Escape").defaultPrevented, true);
  await settle();
  assert.equal(keyboard.responses()[0].args.accepted, false);
  const click = await fixture();
  click.document.querySelector(".external-link-cancel").click();
  await settle();
  assert.equal(click.responses()[0].args.accepted, false);
});

test("language, explicit theme and live theme updates use the narrow prompt/event contract", async () => {
  for (const [language, cancel] of [
    ["en", "Cancel"],
    ["pl", "Anuluj"],
    ["de", "Abbrechen"],
    ["es", "Cancelar"],
    ["fr", "Annuler"],
    ["ja", "キャンセル"],
    ["zh-TW", "取消"],
  ]) {
    for (const theme of ["dark", "light", "system"]) {
      const f = await fixture({ language, theme });
      assert.equal(f.document.documentElement.lang, language);
      assert.equal(f.document.documentElement.dataset.theme, theme);
      assert.equal(
        f.document.querySelector(".external-link-cancel").textContent,
        cancel,
      );
      assert.ok(!f.document.body.textContent.includes("{url}"));
      f.listeners.get("theme-changed")({ payload: "light" });
      assert.equal(f.document.documentElement.dataset.theme, "light");
      f.listeners.get("theme-changed")({
        payload: { theme: "dark", private: "ignored" },
      });
      assert.equal(f.document.documentElement.dataset.theme, "light");
      assert.ok(
        f.calls.every(
          ({ command }) =>
            command !== "get_settings" && command !== "get_shell_theme",
        ),
      );
      f.window.dispatchEvent(new f.window.Event("pagehide"));
      assert.equal(f.listeners.size, 0);
      f.key("Escape");
      assert.equal(f.responses().length, 0);
    }
  }
});

test("HTTP warning is explicit; unsafe/mismatched destinations cannot be approved", async () => {
  const http = await fixture({
    url: "http://example.test/file",
    origin: "http://example.test",
    insecureHttp: true,
  });
  assert.equal(
    http.document.querySelector(".external-link-http-warning").hidden,
    false,
  );
  assert.equal(
    http.document.querySelector(".external-link-protocol").textContent,
    "HTTP",
  );
  assert.equal(
    http.document.querySelector(".external-link-address").dataset.insecure,
    "true",
  );
  assert.ok(
    http.document
      .querySelector('[role="alertdialog"]')
      .getAttribute("aria-describedby")
      .includes("external-link-http-warning"),
  );
  const secure = await fixture();
  assert.equal(
    secure.document.querySelector(".external-link-http-warning").hidden,
    true,
  );
  assert.equal(
    secure.document.querySelector(".external-link-protocol").textContent,
    "HTTPS",
  );
  assert.equal(
    secure.document.querySelector(".external-link-address").dataset.insecure,
    "false",
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///private.txt",
    "https://user:secret@example.test/",
    "https://different.test/",
  ]) {
    const f = await fixture({ url });
    assert.equal(
      f.document.querySelector(".external-link-open").disabled,
      true,
    );
    assert.equal(
      f.document.querySelector(".external-link-protocol").hidden,
      true,
      "inconsistent destinations cannot receive a transport indicator",
    );
    f.document.querySelector(".external-link-open").click();
    assert.equal(f.responses().length, 0);
  }
});

test("destination summary exposes exact punycode host and port separately from URL paths and queries", async () => {
  const origin = "https://xn--bcher-kva.example:8443";
  const url = `${origin}/trusted.example/file?next=https%3A%2F%2Fother.example&signature=a%2Fb#part`;
  const f = await fixture({ url, origin });
  const host = f.document.querySelector(".external-link-host");
  assert.equal(host.textContent, "xn--bcher-kva.example:8443");
  assert.equal(host.getAttribute("dir"), "ltr");
  assert.equal(
    f.document.querySelector(".external-link-origin-value").textContent,
    origin,
  );
  const address = f.document.querySelector(".external-link-url");
  assert.equal(address.textContent, url);
  assert.equal(
    address.getAttribute("aria-describedby"),
    f.document.querySelector(".external-link-origin").id,
  );
  assert.equal(f.document.querySelector(".external-link-open").disabled, false);
});

test("a theme event received during the prompt fetch wins over its older snapshot", async () => {
  const f = await fixture({ theme: "light" }, { themeDuringPrompt: "dark" });
  assert.equal(f.document.documentElement.dataset.theme, "dark");
  assert.deepEqual([...f.listeners.keys()], ["theme-changed"]);
});

test("IPC failures use fixed localized text and return focus to Cancel without leaking error detail", async () => {
  const f = await fixture({}, { responseError: true });
  f.document.querySelector(".external-link-open").click();
  await settle();
  assert.equal(f.document.querySelector(".external-link-status").hidden, false);
  assert.equal(f.document.activeElement.className, "external-link-cancel");
  assert.doesNotMatch(f.document.body.textContent, /private browser error/);
  const unavailable = await fixture({}, { promptError: true });
  assert.equal(unavailable.document.querySelectorAll("button").length, 0);
  assert.doesNotMatch(
    unavailable.document.body.textContent,
    /private prompt detail/,
  );
  assert.equal(unavailable.calls.length, 1);
});

test("long addresses stay intact and layout provides wrapping/scrolling and narrow-window fallback", async () => {
  const url = `https://example.test/${"long-address/".repeat(700)}?value=complete`;
  const f = await fixture({ url });
  assert.equal(f.document.querySelector(".external-link-url").textContent, url);
  assert.equal(
    f.document.querySelector(".external-link-url").hasAttribute("maxlength"),
    false,
  );
  const css = await readFile("src/ui/external-link.css", "utf8");
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /overflow:\s*auto/);
  assert.match(css, /white-space:\s*pre-wrap/);
  assert.match(css, /flex-wrap:\s*wrap/);
  assert.match(css, /@media\s*\(max-width:\s*460px\)/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /:root:not\(\[data-theme="light"\]\)/);
});
