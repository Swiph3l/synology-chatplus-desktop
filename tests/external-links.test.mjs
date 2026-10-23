import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const built = await build({
  entryPoints: ["src/theme/external-links.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { installExternalLinks } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

function fixture({
  provider = "whatsapp",
  origin = "https://web.whatsapp.com",
  post,
  beforeCapture,
} = {}) {
  const { window, document } = parseHTML(
    "<html><head></head><body></body></html>",
  );
  Object.defineProperty(document, "baseURI", { value: `${origin}/app/` });
  // Linkedom does not implement ancestor capture ordering. Model only that
  // transport phase explicitly; real DOM nodes, listeners and URL parsing stay
  // in use, and every installation must request capture on the window.
  const captures = beforeCapture ? [beforeCapture] : [];
  Object.defineProperty(document, "defaultView", {
    value: {
      addEventListener(type, listener, capture) {
        assert.equal(type, "click");
        assert.equal(capture, true);
        captures.push(listener);
      },
      removeEventListener(type, listener, capture) {
        assert.equal(type, "click");
        assert.equal(capture, true);
        const index = captures.indexOf(listener);
        if (index >= 0) captures.splice(index, 1);
      },
    },
  });
  const messages = [];
  const dispose = installExternalLinks(
    document,
    { provider, origin },
    post ?? ((value) => messages.push(JSON.parse(value))),
  );
  const anchor = document.createElement("a");
  anchor.href = "https://example.test/article?value=one%2Ftwo#part";
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.append(anchor);
  let providerCalls = 0;
  anchor.addEventListener("click", () => providerCalls++);
  function click(options = {}, target = anchor) {
    const event = new window.Event("click", {
      bubbles: true,
      cancelable: options.cancelable ?? true,
      composed: true,
    });
    Object.assign(event, {
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...options,
    });
    Object.defineProperty(event, "isTrusted", {
      value: options.isTrusted ?? true,
    });
    const path = [];
    for (let node = target; node; node = node.parentNode) path.push(node);
    Object.defineProperty(event, "composedPath", { value: () => [...path] });
    let stopped = false;
    const stop = event.stopImmediatePropagation.bind(event);
    event.stopImmediatePropagation = () => {
      stopped = true;
      stop();
    };
    for (const capture of captures) {
      capture(event);
      if (stopped) break;
    }
    if (!stopped) target.dispatchEvent(event);
    const allowed = !event.defaultPrevented;
    return { event, allowed };
  }
  return {
    window,
    document,
    anchor,
    messages,
    dispose,
    click,
    providerCalls: () => providerCalls,
  };
}

test("a genuine external left click requests confirmation before the provider can swallow or duplicate it", () => {
  const f = fixture();
  const span = f.document.createElement("span");
  span.textContent = "Public fixture link";
  f.anchor.append(span);
  let providerPopup = 0;
  f.anchor.addEventListener("click", (event) => {
    event.preventDefault();
    providerPopup++;
  });
  const original = f.anchor.outerHTML;
  const { event, allowed } = f.click({}, span);
  assert.deepEqual(f.messages, [
    {
      chatplusExternalLink: 1,
      href: "https://example.test/article?value=one%2Ftwo#part",
    },
  ]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(allowed, false);
  assert.equal(providerPopup, 0);
  assert.equal(f.providerCalls(), 0);
  assert.equal(f.anchor.outerHTML, original);
});

test("external anchors route regardless of blank, current, or absent target", () => {
  for (const target of ["_blank", "_self", ""]) {
    const f = fixture();
    f.anchor.target = target;
    f.click();
    assert.equal(f.messages.length, 1, target);
  }
});

test("the composed path finds an anchor behind nested SVG and a retargeted host", () => {
  const f = fixture();
  const svg = f.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = f.document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.append(path);
  f.anchor.append(svg);
  const { event } = f.click({}, path);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.messages.length, 1);
});

for (const [name, options] of [
  ["Ctrl", { ctrlKey: true }],
  ["Meta", { metaKey: true }],
  ["Shift", { shiftKey: true }],
  ["Alt", { altKey: true }],
  ["middle", { button: 1 }],
  ["right", { button: 2 }],
  ["synthetic provider", { isTrusted: false }],
  ["uncancelable", { cancelable: false }],
]) {
  test(`${name} clicks retain provider and native fallback semantics`, () => {
    const f = fixture();
    const { event } = f.click(options);
    assert.deepEqual(f.messages, []);
    assert.equal(f.providerCalls(), 1);
    assert.equal(event.defaultPrevented, false);
  });
}

test("a click already prevented by an earlier capture handler stays provider-owned", () => {
  const f = fixture({ beforeCapture: (event) => event.preventDefault() });
  const { event } = f.click();
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.providerCalls(), 1);
  assert.deepEqual(f.messages, []);
});

test("internal relative routes keep the provider handler and its preventDefault", () => {
  for (const href of [
    "../conversation/123",
    "/app/#conversation",
    "#message",
    "https://web.whatsapp.com/login?state=opaque",
  ]) {
    const f = fixture();
    f.anchor.setAttribute("href", href);
    let handled = false;
    f.anchor.addEventListener("click", (event) => {
      handled = true;
      event.preventDefault();
    });
    f.click();
    assert.equal(handled, true, href);
    assert.deepEqual(f.messages, [], href);
  }
});

test("Slack workspace and Discord signed attachment links keep their native profile paths", () => {
  for (const [provider, origin, href] of [
    ["slack", "https://work.slack.com", "https://other.slack.com/client/"],
    [
      "slack",
      "https://work.slack.com",
      "https://slack.com/signin?state=opaque",
    ],
    [
      "discord",
      "https://discord.com",
      "https://cdn.discordapp.com/attachments/1/2/report.pdf?signature=opaque",
    ],
    [
      "discord",
      "https://discord.com",
      "https://media.discordapp.net/attachments/1/2/image.png",
    ],
  ]) {
    const f = fixture({ provider, origin });
    f.anchor.href = href;
    assert.equal(f.click().allowed, true, href);
    assert.equal(f.providerCalls(), 1, href);
    assert.deepEqual(f.messages, [], href);
  }
});

test("lookalike hosts, nonstandard ports and nonattachment CDN paths still require confirmation", () => {
  for (const [provider, origin, href] of [
    [
      "slack",
      "https://work.slack.com",
      "https://work.slack.com.evil.test/path",
    ],
    ["slack", "https://work.slack.com", "https://other.slack.com:444/path"],
    [
      "discord",
      "https://discord.com",
      "https://cdn.discordapp.com/not-attachment",
    ],
    [
      "discord",
      "https://discord.com",
      "https://cdn.discordapp.com:444/attachments/1/2/image.png",
    ],
  ]) {
    const f = fixture({ provider, origin });
    f.anchor.href = href;
    f.click();
    assert.equal(f.messages.length, 1, href);
  }
});

test("download anchors, blob/auth schemes and malformed URLs remain unchanged", () => {
  for (const href of [
    "blob:https://web.whatsapp.com/attachment-id",
    "about:blank",
    "mailto:public@example.test",
    "tel:+1234",
    "javascript:void(0)",
    "data:text/plain,fixture",
    "https://user:secret@example.test/",
    "https://[invalid",
    "https://example.test/" + "x".repeat(16_384),
  ]) {
    const f = fixture();
    f.anchor.setAttribute("href", href);
    assert.equal(f.click().allowed, true);
    assert.deepEqual(f.messages, []);
  }
  for (const value of ["", "report.pdf"]) {
    const f = fixture();
    f.anchor.setAttribute("download", value);
    assert.equal(f.click().allowed, true);
    assert.equal(f.providerCalls(), 1);
    assert.deepEqual(f.messages, []);
    assert.equal(f.anchor.getAttribute("download"), value);
  }
});

test("a failed native post leaves default navigation and provider handlers available", () => {
  const f = fixture({
    post: () => {
      throw new Error("fixture native bridge unavailable");
    },
  });
  assert.equal(f.click().allowed, true);
  assert.equal(f.providerCalls(), 1);
});

test("editable, disabled and inert provider links retain their own interaction", () => {
  for (const state of ["editable", "disabled", "inert"]) {
    const f = fixture();
    if (state === "editable")
      Object.defineProperty(f.anchor, "isContentEditable", { value: true });
    if (state === "disabled") f.anchor.setAttribute("aria-disabled", "true");
    if (state === "inert") f.document.body.setAttribute("inert", "");
    assert.equal(f.click().allowed, true, state);
    assert.equal(f.providerCalls(), 1, state);
    assert.deepEqual(f.messages, [], state);
  }
});

test("keyboard activation, replacement links and disposal use one document lifecycle", () => {
  const f = fixture();
  f.click({ detail: 0 });
  assert.equal(f.messages.length, 1);
  const next = f.document.createElement("a");
  next.href = "https://example.test/next";
  f.anchor.replaceWith(next);
  f.click({}, next);
  assert.equal(f.messages.length, 2);
  f.dispose();
  assert.equal(f.click({}, next).allowed, true);
  assert.equal(f.messages.length, 2);
});

test("malicious-looking URLs remain serialized data and never become DOM markup", () => {
  const f = fixture();
  f.anchor.href =
    "https://example.test/<img src=x onerror=alert(1)>?next=\"&value='";
  const originalChildren = f.anchor.childNodes.length;
  f.click();
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].href, new URL(f.anchor.href).href);
  assert.equal(f.anchor.childNodes.length, originalChildren);
  assert.equal(f.document.querySelector("img"), null);
});
