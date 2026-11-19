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

test("bundled unread cues match only ChatPlus row titles and follow recycled row state", () => {
  const { document, window } = fixture("light");
  const row = (id, titleClass, action = "") =>
    `<div id="${id}"><div class="module-item-option-wrapper">
      <li class="module-item-option" role="menuitem" tabindex="-1">
        <div class="avatar weight-prominent">A</div>
        <div class="body-m truncate"><div class="${titleClass}">Name</div></div>
        <div class="action-wrapper"><div class="hide-on-hover-action">${action}</div></div>
      </li></div></div>`;
  document.body.innerHTML = `<aside data-testid="sidebar-layout-content">
    <div class="chat-list-scrollbar">
      ${row("chat-channel-1", "weight-prominent opacity-100")}
      ${row("chat-channel-2", "", '<b class="bg-bg-fill-error-thick">2</b>')}
      ${row("sidebar-tab-item-all", "weight-prominent")}
    </div>
    <div class="channel-list-scrollbar">
      ${row("channel-starred-3", "weight-prominent", '<i class="v-icon icn_channeltype_bell_slash_fill"></i>')}
      ${row("team-starred-4", "weight-prominent")}
    </div></aside>
    <main class="chat-list-scrollbar">${row("chat-channel-5", "weight-prominent")}</main>`;
  const rules = Array.from(themeStyle(document).sheet.cssRules);
  assert.ok(
    !rules.some(
      (rule) =>
        rule.selectorText?.includes(".weight-prominent") &&
        rule.selectorText.includes("::before"),
    ),
    "the provider owns the row's leading decoration",
  );
  const underline = rules.find(
    (rule) =>
      rule.selectorText?.endsWith(".truncate::after") &&
      rule.style?.getPropertyValue("block-size") === "2px",
  );
  const muted = rules.find((rule) =>
    rule.selectorText?.includes(".icn_channeltype_bell_slash_fill"),
  );
  assert.equal(
    underline.style.getPropertyValue("inline-size"),
    "min(20px, 100%)",
  );
  const matched = (selector) =>
    Array.from(
      document.querySelectorAll(selector),
      (element) => element.closest("[id]").id,
    );
  for (const theme of ["light", "dark", "retro"]) {
    window.__chatplusSetTheme(theme);
    assert.deepEqual(matched(underline.selectorText.replace(/::after$/, "")), [
      "chat-channel-1",
      "channel-starred-3",
    ]);
    assert.deepEqual(matched(muted.selectorText), ["channel-starred-3"]);
  }
  const label = document.querySelector("#chat-channel-1 .body-m > div");
  label.classList.remove("weight-prominent");
  assert.deepEqual(matched(underline.selectorText.replace(/::after$/, "")), [
    "channel-starred-3",
  ]);
  label.classList.add("weight-prominent");
  document.body.classList.remove("eos-scope");
  assert.deepEqual(matched(underline.selectorText.replace(/::after$/, "")), []);
});

test("dark ChatPlus pairs a pale unread underline with a cyan tint and preserves keyboard focus", () => {
  const { document } = fixture("dark");
  const sidebar = document.createElement("aside");
  sidebar.dataset.testid = "sidebar-layout-content";
  document.body.append(sidebar);
  const rules = Array.from(themeStyle(document).sheet.cssRules);
  const palette = rules.find(
    (rule) =>
      rule.style?.getPropertyValue("--chatplus-row-accent") &&
      sidebar.matches(rule.selectorText),
  );
  assert.equal(
    palette.style.getPropertyValue("--chatplus-row-accent"),
    "#78bfda",
  );
  assert.equal(
    palette.style.getPropertyValue("--chatplus-row-underline"),
    "#e0e8ee",
  );
  assert.equal(
    palette.style.getPropertyValue("--chatplus-row-idle-tint"),
    "14%",
  );
  const mute = rules.find((rule) =>
    rule.selectorText?.includes(".icn_channeltype_bell_slash_fill"),
  );
  assert.equal(
    mute.style.getPropertyValue("--chatplus-row-underline"),
    "var(--chatplus-row-muted)",
  );
  assert.equal(mute.style.getPropertyValue("--chatplus-row-hover-tint"), "6%");
  assert.equal(
    mute.style.getPropertyValue("--chatplus-row-selected-tint"),
    "9%",
  );
  const focus = rules.find(
    (rule) =>
      rule.selectorText?.includes(".weight-prominent") &&
      rule.selectorText.endsWith(":focus-visible"),
  );
  assert.equal(
    focus.style.getPropertyPriority("outline"),
    "important",
    "takes precedence over the upstream :focus reset",
  );
  const highContrast = rules.find(
    (rule) =>
      rule.media?.mediaText === "(forced-colors: active)" &&
      rule.cssRules[0]?.selectorText.includes(".weight-prominent"),
  );
  assert.equal(
    highContrast.cssRules[0].style.getPropertyValue("background-color"),
    "CanvasText",
  );
});

test("Retro read titles and keyboard focus contrast with the navy active or hovered row", () => {
  const { document, window } = fixture("retro");
  document.body.innerHTML = `<aside data-testid="sidebar-layout-content">
    <div class="chat-list-scrollbar"><div id="chat-channel-1"><div class="module-item-option-wrapper">
      <li role="menuitem" class="module-item-option activated"><div class="body-m truncate text-fg-primary"><div>Read</div></div></li>
    </div></div></div></aside>`;
  const rules = Array.from(themeStyle(document).sheet.cssRules);
  const read = document.querySelector("li");
  const interaction = rules.find(
    (rule) =>
      rule.style?.getPropertyValue("--eos-fg-primary") === "#fff" &&
      rule.selectorText?.includes(".activated"),
  );
  const focus = rules.find(
    (rule) =>
      rule.selectorText?.includes(".activated") &&
      rule.selectorText.endsWith(":focus-visible"),
  );
  const background = rules.find(
    (rule) =>
      rule.selectorText?.includes(".module-item-option.activated") &&
      rule.style?.getPropertyValue("background-color") &&
      read.matches(rule.selectorText),
  );
  assert.equal(
    background.style.getPropertyValue("background-color"),
    "#000080",
  );
  assert.ok(read.matches(interaction.selectorText));
  read.classList.remove("activated");
  assert.ok(!read.matches(interaction.selectorText));
  // linkedom has no pointer or keyboard input. Apply the two pseudo-states to
  // this row explicitly while exercising the rest of the shipped selectors.
  read.classList.add("hovered", "keyboard");
  const withInput = (selector) =>
    selector
      .replaceAll(":hover", ".hovered")
      .replaceAll(":focus-visible", ".keyboard");
  assert.ok(read.matches(withInput(interaction.selectorText)));
  assert.ok(read.matches(withInput(focus.selectorText)));
  assert.equal(
    focus.style.getPropertyValue("outline"),
    "1px dotted var(--eos-fg-primary)",
  );
  window.__chatplusSetTheme("light");
  assert.ok(!read.matches(withInput(interaction.selectorText)));
});

test("explicit Retro survives dark-system changes and reuses the existing provider style", () => {
  const { window, document, media } = fixture("retro", true);
  const style = themeStyle(document);
  assert.equal(document.documentElement.dataset.chatplusTheme, "retro");
  assert.match(style.textContent, /data-chatplus-theme="retro"/);
  media.matches = false;
  media.change();
  assert.equal(document.documentElement.dataset.chatplusTheme, "retro");
  window.__chatplusSetTheme("light");
  assert.equal(document.documentElement.dataset.chatplusTheme, "light");
  window.__chatplusSetTheme("retro");
  assert.equal(document.documentElement.dataset.chatplusTheme, "retro");
  assert.equal(themeStyle(document), style);
});

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

test("Light and System-resolved Light survive provider root replacement without dark surface overrides", async () => {
  for (const preference of ["light", "system"]) {
    const f = fixture(preference, false);
    const style = themeStyle(f.document);
    const root = f.document.createElement("html");
    root.dataset.chatplusTheme = "dark";
    root.innerHTML = `<head></head><body class="eos-scope">
      <main id="chat-main-app"><section class="message-viewer-scrollbar">
        <div aria-busy="true"></div><div role="progressbar"></div>
        <div contenteditable="true"></div><article class="jump-highlight"></article>
      </section><section data-testid="thread-viewer-comments-section"></section>
      <div data-testid="message-create-box-paste-zone"><div contenteditable="true"></div></div>
      <div role="menu"><button data-testid="reaction-button"></button></div>
      <div class="v-textfield-wrapper"><input></div></main></body>`;
    f.document.replaceChild(root, f.document.documentElement);
    await settle();
    style.remove();
    style.setAttribute("media", "not all");
    await settle();
    f.run();
    await settle();

    const matchesDarkOverride = () =>
      [root, ...root.querySelectorAll("*")].some((node) =>
        cssRules.some(
          ([, selector]) =>
            !/::|:(?:focus|hover)/.test(selector) &&
            node.matches(selector.trim()),
        ),
      );
    assert.equal(root.dataset.chatplusTheme, "light", preference);
    assert.equal(themeStyle(f.document), style);
    assert.equal(style.hasAttribute("media"), false);
    assert.equal(
      f.document.querySelectorAll("#chatplus-desktop-theme").length,
      1,
    );
    assert.equal(
      matchesDarkOverride(),
      false,
      `${preference}: provider Light colors remain available`,
    );

    f.media.matches = true;
    f.media.change();
    assert.equal(
      root.dataset.chatplusTheme,
      preference === "system" ? "dark" : "light",
    );
    assert.equal(matchesDarkOverride(), preference === "system");
    f.window.__chatplusSetTheme("light");
    assert.equal(matchesDarkOverride(), false);
    assert.equal(themeStyle(f.document), style);
  }
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
