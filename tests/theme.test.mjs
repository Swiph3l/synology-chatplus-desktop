import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import "../scripts/build-theme.mjs";
const script = await readFile("src-tauri/theme-bootstrap.js", "utf8");
const css = await readFile("src/theme/dark.css", "utf8");
const cssRules = [
  ...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
];

test("reaction surfaces cover idle, hover, selected and keyboard focus only in dark ChatPlus", () => {
  const rules = cssRules.filter(([, selector]) =>
    selector.includes('[data-testid="reaction-button"]'),
  );
  assert.equal(rules.length, 4);
  for (const [, selector] of rules) {
    assert.match(
      selector,
      /:root\[data-chatplus-theme="dark"\]\s+body\.eos-scope/,
    );
  }
  assert.match(rules[0][2], /color: #edf1f7 !important/);
  assert.ok(rules.some(([, selector]) => selector.includes(":hover")));
  assert.ok(
    rules.some(([, selector]) => selector.includes('[aria-pressed="true"]')),
  );
  assert.ok(
    rules.some(
      ([, selector, declarations]) =>
        selector.includes(":focus-visible") &&
        declarations.includes("outline:"),
    ),
  );
  assert.ok(
    rules.every(([, , declarations]) => !declarations.includes("fill:")),
  );
});

test("form surface overrides stay inside dark EOS and scope native textarea fallback", () => {
  const formRules = cssRules.filter(([, selectors]) =>
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
function fixture(preference = "system", dark = true, beforeRoot = false) {
  const { window: dom, document } = parseHTML(
    '<html><head></head><body class="eos-scope"></body></html>',
  );
  const detachedRoot = beforeRoot ? document.documentElement : null;
  detachedRoot?.remove();
  const counters = { mediaListeners: 0, observers: 0, observerCalls: 0 };
  const media = {
    matches: dark,
    addEventListener(_, callback) {
      this.change = callback;
      counters.mediaListeners++;
    },
  };
  const navigations = [];
  const location = {
    href: "https://provider.example.test/chat/",
    assign: (url) => navigations.push(url),
  };
  const window = { __chatplusTheme: preference, location };
  const context = {
    window,
    document,
    location,
    URL,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    matchMedia: () => media,
    MutationObserver: class extends dom.MutationObserver {
      constructor(callback) {
        super((...args) => {
          counters.observerCalls++;
          callback(...args);
        });
        counters.observers++;
      }
    },
  };
  const run = () => runInNewContext(script, context);
  run();
  return {
    window,
    document,
    media,
    counters,
    run,
    detachedRoot,
    navigations,
    dom,
  };
}

const settle = () => new Promise(setImmediate);
const themeStyle = (document) =>
  document.querySelector("style#chatplus-desktop-theme");

test("bundled bootstrap injects actual CSS before page content and follows system theme", () => {
  const { window, document, media } = fixture();
  const root = document.documentElement;
  const style = themeStyle(document);
  assert.equal(style.parentNode, root);
  assert.match(style.textContent, /--eos-bg-surface-z0/);
  assert.equal(document.body.childNodes.length, 0, "provider has not rendered");
  assert.equal(root.dataset.chatplusTheme, "dark");
  media.matches = false;
  media.change();
  assert.equal(root.dataset.chatplusTheme, "light");
  window.__chatplusSetTheme("dark");
  assert.equal(root.dataset.chatplusTheme, "dark");
  window.__chatplusSetTheme("light");
  assert.equal(root.dataset.chatplusTheme, "light");
  media.matches = true;
  media.change();
  assert.equal(root.dataset.chatplusTheme, "light", "explicit Light wins");
  window.__chatplusSetTheme("system");
  assert.equal(root.dataset.chatplusTheme, "dark");
  assert.equal(themeStyle(document), style, "theme changes retain the style");
});

test("document-start bootstrap waits for the root and installs the dark fallback before provider content", async () => {
  const { document, detachedRoot } = fixture("dark", false, true);
  assert.equal(document.documentElement, null);
  document.appendChild(detachedRoot);
  await settle();
  assert.equal(document.documentElement.dataset.chatplusTheme, "dark");
  assert.equal(themeStyle(document).parentNode, detachedRoot);
  assert.equal(document.body.childNodes.length, 0);
  assert.match(
    themeStyle(document).textContent,
    /background: #0f1115 !important/,
  );
});

test("incoming messages and recreated conversation surfaces retain the installed stylesheet without observer churn", async () => {
  const { document, counters } = fixture("dark");
  const style = themeStyle(document);
  document.body.innerHTML = '<main id="chat-main-app"></main>';
  await settle();
  const observerCalls = counters.observerCalls;
  const main = document.querySelector("main");
  for (const content of [
    '<section class="message-viewer-scrollbar"><article>Incoming</article></section>',
    '<section class="message-viewer-scrollbar"><article>Another conversation</article></section>',
    '<section data-testid="thread-viewer-comments-section"><div aria-busy="true"></div></section>',
    '<section class="message-viewer-scrollbar"><div role="progressbar"></div></section>',
    '<div data-testid="message-create-box-paste-zone"><div contenteditable="true"></div></div>',
    '<section class="message-viewer-scrollbar"><div contenteditable="true">Edit</div></section>',
    '<div role="menu"><button data-testid="reaction-button">Reaction</button></div>',
  ]) {
    main.innerHTML = content;
    assert.equal(
      themeStyle(document),
      style,
      "CSS exists before observer work",
    );
    assert.equal(document.documentElement.dataset.chatplusTheme, "dark");
    await settle();
    assert.equal(themeStyle(document), style);
    assert.equal(
      document.querySelectorAll("#chatplus-desktop-theme").length,
      1,
    );
  }
  assert.equal(counters.observerCalls, observerCalls);
});

test("root/head replacement, stylesheet removal and provider tampering repair the same style", async () => {
  const { document } = fixture("dark");
  const style = themeStyle(document);
  const original = style.textContent;
  document.head.replaceWith(document.createElement("head"));
  await settle();
  assert.equal(themeStyle(document), style);
  style.remove();
  await settle();
  assert.equal(themeStyle(document), style);
  style.textContent = "body { background: white; }";
  style.setAttribute("media", "not all");
  document.documentElement.dataset.chatplusTheme = "light";
  await settle();
  assert.equal(style.textContent, original);
  assert.equal(style.hasAttribute("media"), false);
  assert.equal(document.documentElement.dataset.chatplusTheme, "dark");
  const root = document.createElement("html");
  root.innerHTML = '<head></head><body class="eos-scope"></body>';
  document.replaceChild(root, document.documentElement);
  await settle();
  assert.equal(style.parentNode, root);
  assert.equal(themeStyle(document), style);
  assert.equal(root.dataset.chatplusTheme, "dark");
});

test("re-evaluating native bootstrap reuses styles, media listeners and observers", async () => {
  const f = fixture("dark");
  const style = themeStyle(f.document);
  await settle();
  const { observers, mediaListeners } = f.counters;
  f.window.__chatplusSetTheme("light");
  f.run();
  await settle();
  assert.equal(f.document.documentElement.dataset.chatplusTheme, "light");
  assert.equal(f.counters.observers, observers);
  assert.equal(f.counters.mediaListeners, mediaListeners);
  assert.equal(themeStyle(f.document), style);
  assert.equal(
    f.document.querySelectorAll("#chatplus-desktop-theme").length,
    1,
  );
});

test("theme bootstrap preserves provider link clicks and browser popup/download semantics", () => {
  for (const scenario of [
    { name: "normal target blank" },
    { name: "Ctrl click", ctrlKey: true },
    { name: "Meta click", metaKey: true },
    { name: "Shift click", shiftKey: true },
    { name: "Alt click", altKey: true },
    { name: "provider-prevented click", providerPrevents: true },
    { name: "download link", download: "report.pdf" },
    { name: "relative same-service link", href: "../conversation/123" },
    { name: "provider popup", href: "about:blank" },
  ]) {
    const { window, document, navigations, dom } = fixture("dark");
    const anchor = document.createElement("a");
    const href = scenario.href ?? "https://outside.example.test/article";
    anchor.setAttribute("href", href);
    anchor.target = "_blank";
    if (scenario.download) anchor.setAttribute("download", scenario.download);
    const label = document.createElement("span");
    label.textContent = "Provider link";
    anchor.append(label);
    document.body.append(anchor);
    let providerCalls = 0;
    let providerSawPrevented;
    let propagationPath;
    let finalPrevented;
    anchor.addEventListener("click", (event) => {
      providerCalls++;
      providerSawPrevented = event.defaultPrevented;
      if (scenario.providerPrevents) event.preventDefault();
    });
    document.addEventListener("click", (event) => {
      propagationPath = event.composedPath();
      finalPrevented = event.defaultPrevented;
    });
    const event = new dom.Event("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    Object.assign(event, {
      button: 0,
      ctrlKey: scenario.ctrlKey ?? false,
      metaKey: scenario.metaKey ?? false,
      shiftKey: scenario.shiftKey ?? false,
      altKey: scenario.altKey ?? false,
    });
    const allowDefault = label.dispatchEvent(event);
    assert.equal(providerCalls, 1, scenario.name);
    assert.equal(
      providerSawPrevented,
      false,
      `${scenario.name}: theme must not preempt provider handlers`,
    );
    assert.equal(
      finalPrevented,
      scenario.providerPrevents ?? false,
      scenario.name,
    );
    assert.equal(allowDefault, !scenario.providerPrevents, scenario.name);
    assert.equal(propagationPath[0], label, scenario.name);
    assert.ok(propagationPath.includes(anchor), scenario.name);
    assert.ok(propagationPath.includes(document), scenario.name);
    assert.deepEqual(
      navigations,
      [],
      `${scenario.name}: provider/native policy owns navigation`,
    );
    assert.equal(
      window.location.href,
      "https://provider.example.test/chat/",
      scenario.name,
    );
    assert.equal(anchor.getAttribute("href"), href, scenario.name);
    assert.equal(anchor.target, "_blank", scenario.name);
    assert.equal(
      anchor.getAttribute("download"),
      scenario.download ?? null,
      scenario.name,
    );
  }
});

test("transient loading, composer, edit and menu surfaces have immediate scoped dark backgrounds with no background transition", () => {
  const { document } = fixture("dark");
  document.body.innerHTML = `<main id="chat-main-app">
    <section class="message-viewer-scrollbar">
      <div aria-busy="true" id="history"></div>
      <div role="progressbar" id="loader"></div>
      <div contenteditable="true" id="editor"></div>
      <img id="attachment" src="about:blank" />
    </section>
    <section data-testid="thread-viewer-comments-section">
      <div aria-busy="true" id="thread-loader"></div>
      <div contenteditable="true" id="thread-editor"></div>
    </section>
    <div data-testid="message-create-box-paste-zone">
      <div contenteditable="true" id="composer"></div>
    </div>
    <div role="menu" id="menu"></div>
  </main>`;
  // Match selectors against real replaced DOM. Computed colors and painting
  // still require Windows/WebView2 visual acceptance.
  const applicable = (node) =>
    cssRules.filter(
      ([, selector]) =>
        !/::|:(?:focus|hover)/.test(selector) && node.matches(selector.trim()),
    );
  for (const id of [
    "history",
    "loader",
    "editor",
    "thread-loader",
    "thread-editor",
    "composer",
    "menu",
  ]) {
    const node = document.getElementById(id);
    const matches = applicable(node);
    assert.ok(
      matches.some(([, , body]) =>
        /background(?:-color)?:[^;]+!important/.test(body),
      ),
      `${id} dark fallback`,
    );
    const transition = matches.find(([, , body]) =>
      body.includes("transition-property:"),
    );
    assert.ok(transition, `${id} transition guard`);
    assert.doesNotMatch(transition[2], /(?:background|\ball\b)/);
    document.documentElement.dataset.chatplusTheme = "light";
    assert.equal(
      applicable(node).length,
      0,
      `${id} provider Light styles remain free`,
    );
    document.documentElement.dataset.chatplusTheme = "dark";
  }
  assert.ok(
    !applicable(document.getElementById("attachment")).some(([, , body]) =>
      /background(?:-color)?:/.test(body),
    ),
  );
});

test("provider new-message highlight tokens stay dark blue with readable sender, body and timestamp and preserve the native fade", () => {
  const { window, document, media } = fixture("system", true);
  document.body.innerHTML = `<main class="message-viewer-scrollbar">
    <article class="jump-highlight" id="new-message"><span>Sender</span><time>12:00</time><p>New message</p></article>
    <article id="ordinary-message">Earlier message</article>
  </main>`;
  const tokens = () => {
    const result = {};
    // Read the inherited tokens from selectors that actually match the provider
    // root/body; the public provider animation consumes theme-light and then
    // fades to transparent. No message-row color inversion or hard-coded row
    // background should replace that animation.
    for (const node of [document.documentElement, document.body]) {
      for (const [, selector, body] of cssRules) {
        if (
          /::|:(?:focus|hover)/.test(selector) ||
          !node.matches(selector.trim())
        )
          continue;
        for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
          result[name] = value.trim();
      }
    }
    return result;
  };
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/gi).map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (a, b) => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };
  const dark = tokens();
  for (const name of [
    "--eos-bg-fill-theme-light",
    "--eos-bg-fill-theme-light-hover",
    "--eos-bg-fill-theme-light-active",
  ]) {
    const background = dark[name];
    assert.match(background, /^#[a-f\d]{6}$/i);
    assert.notEqual(
      background,
      dark["--eos-bg-surface-z0"],
      "highlight remains distinct from the conversation",
    );
    assert.ok(
      luminance(background) < 0.1,
      `${name} never uses the provider's pale-blue light fill`,
    );
    for (const foreground of [
      "--eos-fg-primary",
      "--eos-fg-secondary",
      "--eos-fg-on-fill-theme-light",
    ])
      assert.ok(
        contrast(background, dark[foreground]) >= 4.5,
        `${foreground} is readable on ${name}`,
      );
  }
  assert.doesNotMatch(
    css,
    /(?:animation(?:-name)?\s*:.*jumphighlight|@keyframes\s+jumphighlight|\.jump-highlight[^{}]*\{[^}]*background)/s,
  );
  assert.equal(
    dark["--eos-bg-fill-transparent"],
    undefined,
    "the provider's transparent fade target is preserved",
  );
  document
    .getElementById("new-message")
    .replaceWith(document.createElement("article"));
  assert.equal(
    tokens()["--eos-bg-fill-theme-light"],
    dark["--eos-bg-fill-theme-light"],
    "recreated incoming rows inherit the token immediately",
  );
  window.__chatplusSetTheme("light");
  assert.equal(tokens()["--eos-bg-fill-theme-light"], undefined);
  window.__chatplusSetTheme("system");
  media.matches = false;
  media.change();
  assert.equal(tokens()["--eos-bg-fill-theme-light"], undefined);
  media.matches = true;
  media.change();
  assert.equal(
    tokens()["--eos-bg-fill-theme-light"],
    dark["--eos-bg-fill-theme-light"],
  );
});
