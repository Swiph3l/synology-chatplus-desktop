import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { bridgeMessages } from "./bridge-messages.mjs";
import { randomUUID } from "node:crypto";

export async function providerFixtures(entry = "src/theme/unread.ts") {
  const built = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
  });

  return function fixture(provider, frame = false, title, rowCount = 1) {
    const { window: dom, document } = parseHTML(`<html><body class="eos-scope">
    <div><div id="sidebar-tab-item-messages"><span data-testid="tab-item-indicator"></span></div></div>
    <div class="syno-chat"><div class="channel-list-main"><div class="channel-list-view"><div class="channel-list-item highlight"></div></div></div></div>
    <div data-list-id="private-channels-example"><a href="/channels/@me/333333333333333333"><span class="unreadPill_current"></span></a></div>
    <div id="pane-side"><div role="grid">${'<div role="row"><span data-testid="unread-count">2</span></div>'.repeat(rowCount)}</div></div>
    <div role="navigation"><div role="grid"><div role="row"><span aria-label="Unread"></span></div></div></div>
  </body></html>`);
    const bridge = bridgeMessages();
    const { messages, diagnostics } = bridge;
    const tasks = [];
    let geometry = 0;
    let selectors = 0;
    const listeners = new Map();
    const host = {
      __chatplusProvider: provider,
      location: {
        href: "https://example.com/",
        pathname: provider === "messenger" ? "/messages/" : "/",
        hash: "",
      },
      MutationObserver: dom.MutationObserver,
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      chrome: {
        webview: { postMessage: bridge.postMessage },
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
      dispatchEvent() {
        return true;
      },
    };
    host.top = frame ? {} : host;
    if (provider === "whatsapp") document.title = title ?? "(2) WhatsApp";
    document.hasFocus = () => true;
    const elements = [...document.querySelectorAll("*")];
    for (const root of [document, ...elements]) {
      for (const method of ["querySelector", "querySelectorAll"]) {
        const query = root[method].bind(root);
        root[method] = (selector) => {
          selectors += 1;
          return query(selector);
        };
      }
    }
    for (const element of elements) {
      element.getBoundingClientRect = () => {
        geometry += 1;
        return { width: 300, height: 100 };
      };
    }
    Object.defineProperty(document, "visibilityState", { value: "visible" });
    Object.defineProperty(document, "defaultView", { value: host });
    const boot = () =>
      runInNewContext(built.outputFiles[0].text, {
        window: host,
        document,
        Event: dom.Event,
        KeyboardEvent: class {},
        crypto: { randomUUID },
        queueMicrotask: (callback) => tasks.push(callback),
      });
    const flush = () => {
      while (tasks.length) tasks.shift()();
    };
    boot();
    flush();
    return {
      messages,
      diagnostics,
      host,
      document,
      boot,
      flush,
      listeners,
      geometry: () => geometry,
      selectors: () => selectors,
    };
  };
}
