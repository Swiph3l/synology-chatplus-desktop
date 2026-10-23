import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";
import { bridgeMessages } from "./helpers/bridge-messages.mjs";

const built = await build({
  stdin: {
    contents: `export { createMattermostAdapter } from "./src/theme/providers/mattermost";
      export { installUnreadAdapter } from "./src/theme/provider-unread";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "mattermostUnread",
});

const post = "a".repeat(26);
const nextPost = "b".repeat(26);
const settle = () => new Promise(setImmediate);

function fixture({
  configured = "https://chat.example.test/mm/",
  path = "/mm/team/channels/town-square",
  timeout = 1000,
} = {}) {
  const { document, window: dom } = parseHTML(`<html><body>
    <header><button id="header">Channel header</button></header>
    <div id="postListContent"><div id="postListScrollContainer">
      <div data-testid="postView" id="post_${post}"><div id="message-body">Example message</div></div>
    </div></div>
    <form id="create_post"><textarea id="post_textbox"></textarea></form>
    <button id="overlay">Overlay</button>
  </body></html>`);
  let focused = true;
  let visibility = "visible";
  let covered = false;
  const calls = [];
  const fetchCalls = [];
  const observers = new Set();
  class MutationObserver {
    constructor(callback) {
      this.queued = [];
      this.native = new dom.MutationObserver((records) =>
        callback(records, this),
      );
      observers.add(this);
    }
    observe(...args) {
      this.native.observe(...args);
    }
    takeRecords() {
      return [...this.native.takeRecords(), ...this.queued.splice(0)];
    }
    disconnect() {
      this.native.disconnect();
      this.queued.length = 0;
      observers.delete(this);
    }
  }
  const host = Object.assign(new EventTarget(), {
    __chatplusServiceBase: configured,
    location: {
      origin: "https://chat.example.test",
      pathname: path,
      href: `https://chat.example.test${path}`,
    },
    MutationObserver,
    getComputedStyle: (node) => ({
      display: node.style.display || "block",
      visibility: node.style.visibility || "visible",
    }),
    setTimeout,
    clearTimeout,
    fetch: async (...args) => {
      fetchCalls.push(args);
      throw new Error("The injected verifier must own all transport.");
    },
  });
  Object.defineProperties(document, {
    defaultView: { value: host },
    hasFocus: { value: () => focused },
    visibilityState: { get: () => visibility },
  });
  const bounds = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
  };
  dom.HTMLElement.prototype.getBoundingClientRect = () => bounds;
  document.elementFromPoint = () =>
    document.getElementById(covered ? "overlay" : "message-body");
  const bridge = bridgeMessages();
  host.chrome = { webview: { postMessage: bridge.postMessage } };
  const context = {
    URL,
    AbortController,
    Event: dom.Event,
    KeyboardEvent: class {},
    queueMicrotask,
  };
  runInNewContext(built.outputFiles[0].text, context);
  const adapter = context.mattermostUnread.createMattermostAdapter(document, {
    verifyReadZero(options) {
      let resolve, reject;
      const result = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      });
      // Swiph3l: Deliberately ignore abort in the stub: stale successful replies
      // must be rejected by the real adapter even when transport cannot cancel.
      calls.push({ ...options, resolve, reject });
      return result;
    },
    retryDelayMs: 1,
    requestTimeoutMs: timeout,
  });
  const stop = context.mattermostUnread.installUnreadAdapter(
    adapter,
    document,
    host,
  );
  return {
    document,
    host,
    adapter,
    calls,
    fetchCalls,
    messages: bridge.messages,
    diagnostics: bridge.diagnostics,
    recordMutation(record) {
      for (const observer of observers) observer.queued.push(record);
    },
    foreground(value = true, generation = 7, incoming = 1) {
      host.__chatplusSetForeground(value, generation, incoming);
    },
    gesture(id = "message-body", { trusted = true, type = "click" } = {}) {
      const event = new dom.Event(type, { bubbles: true });
      Object.defineProperty(event, "isTrusted", { value: trusted });
      document.getElementById(id).dispatchEvent(event);
    },
    focus(value) {
      focused = value;
      host.dispatchEvent(new Event(value ? "focus" : "blur"));
    },
    visibility(value) {
      visibility = value;
      document.dispatchEvent(new dom.Event("visibilitychange"));
    },
    cover(value = true) {
      covered = value;
      document.dispatchEvent(new dom.Event("scroll"));
    },
    route(value) {
      host.location.pathname = value;
      host.location.href = `https://chat.example.test${value}`;
      host.dispatchEvent(new Event("popstate"));
    },
    stop,
    async dispose() {
      stop();
      for (const call of calls) call.resolve(null);
      await settle();
    },
  };
}

function assertNoRead(f) {
  assert.equal(f.adapter.snapshot().hasUnread, null);
  assert.equal(f.adapter.providerUnreadZero(), false);
  assert.ok(f.messages.every((event) => event.acknowledgement === null));
  assert.ok(f.messages.every((event) => event.readScope !== "provider-zero"));
}

for (const [target, type] of [
  ["message-body", "click"],
  ["post_textbox", "input"],
]) {
  test(`Mattermost ${target}: trusted input and server zero acknowledge only the current native generation`, async (t) => {
    const f = fixture();
    t.after(() => f.dispose());
    f.foreground();
    await settle();
    assertNoRead(f);
    f.gesture(target, { type });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].base.href, "https://chat.example.test/mm/");
    assert.equal(f.calls[0].signal.aborted, false);
    assert.equal(typeof f.calls[0].fetch, "function");
    assert.equal(
      f.fetchCalls.length,
      0,
      "the adapter delegates read-only transport",
    );
    await settle();
    assertNoRead(f);
    f.calls[0].resolve(true);
    await settle();
    const read = f.messages.at(-1);
    assert.equal(read.source, "mattermost-dom");
    assert.equal(read.hasUnread, false);
    assert.equal(read.acknowledgement, 7);
    assert.equal(read.readScope, "provider-zero");
    assert.deepEqual(read.readArrivals, [1]);
    assert.equal(
      f.adapter.isViewingNotification({ tag: "legacy message text" }),
      false,
    );
  });
}

test("Mattermost focus, header, synthetic input and initial pre-arrival input never start metadata requests", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  f.foreground(true, 7, 0);
  await settle();
  f.gesture();
  f.gesture("post_textbox", { type: "input" });
  assert.equal(
    f.calls.length,
    0,
    "no initial notification means no metadata polling",
  );
  f.foreground(true, 8, 1);
  f.focus(false);
  f.focus(true);
  f.gesture("header");
  f.gesture("message-body", { trusted: false });
  f.gesture("post_textbox", { trusted: false, type: "input" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 0);
  assertNoRead(f);
});

test("Mattermost duplicate input shares one pending query and failed/unknown metadata never becomes zero", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  f.foreground();
  f.gesture();
  f.gesture("post_textbox", { type: "input" });
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    f.calls.length,
    2,
    "only one bounded retry belongs to the original gesture",
  );
  assertNoRead(f);
  f.calls[1].reject(new Error("metadata unavailable"));
  await settle();
  assertNoRead(f);
});

test("Mattermost request timeout cannot turn a late successful reply into a read", async (t) => {
  const f = fixture({ timeout: 5 });
  t.after(() => f.dispose());
  f.foreground();
  f.gesture();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(f.calls[0].signal.aborted, true);
  assertNoRead(f);
  f.calls[0].resolve(true);
  await settle();
  assertNoRead(f);
});

test("Mattermost server zero cannot be reused for a newer arrival without fresh input and metadata", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  f.foreground();
  f.gesture();
  f.calls[0].resolve(true);
  await settle();
  assert.equal(f.messages.at(-1).acknowledgement, 7);
  f.host.__chatplusAcceptRead([1], 1);
  await settle();
  const previous = f.messages.length;
  f.foreground(true, 8, 2);
  await settle();
  assert.equal(f.adapter.snapshot().hasUnread, null);
  assert.equal(f.adapter.providerUnreadZero(), false);
  assert.equal(
    f.calls.length,
    1,
    "a new arrival itself cannot start metadata polling",
  );
  assert.ok(
    f.messages.slice(previous).every((event) => event.acknowledgement === null),
  );
  f.gesture();
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve(true);
  await settle();
  assert.equal(f.messages.at(-1).acknowledgement, 8);
  assert.deepEqual(f.messages.at(-1).readArrivals, [2]);
});

test("Mattermost full native read stops further metadata requests until a new arrival", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  f.foreground();
  f.gesture();
  f.calls[0].resolve(true);
  await settle();
  assert.equal(f.messages.at(-1).readScope, "provider-zero");
  f.host.__chatplusAcceptRead([1], 1);
  await settle();
  assert.equal(
    f.adapter.snapshot().hasUnread,
    null,
    "native acceptance consumes the zero receipt",
  );
  const previous = f.messages.length;
  f.gesture();
  f.gesture("post_textbox", { type: "input" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    f.calls.length,
    1,
    "read-through input cannot poll the server again",
  );
  assert.ok(
    f.messages.slice(previous).every((event) => event.acknowledgement === null),
  );
});

test("Mattermost partial out-of-order acceptance preserves the earlier pending read", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  f.foreground(true, 7, 1);
  f.foreground(true, 8, 2);
  f.gesture();
  f.calls[0].resolve(true);
  await settle();
  assert.deepEqual(f.messages.at(-1).readArrivals, [1, 2]);
  f.host.__chatplusAcceptRead([2]);
  await settle();
  assert.equal(f.adapter.providerUnreadZero(), true);
  f.gesture();
  await settle();
  assert.equal(
    f.calls.length,
    1,
    "fresh input within the receipt TTL shares its bounded query",
  );
  f.host.__chatplusCompleteArrival(1);
  await settle();
  assert.equal(f.messages.at(-1).readScope, "provider-zero");
  assert.deepEqual(f.messages.at(-1).readArrivals, [1]);
  f.host.__chatplusAcceptRead([1], 2);
  await settle();
  assert.equal(f.adapter.providerUnreadZero(), false);
  f.gesture();
  assert.equal(
    f.calls.length,
    1,
    "only native's full boundary stops further queries",
  );
});

test("Mattermost read diagnostics contain only fixed outcomes and generation", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  f.foreground();
  f.gesture();
  f.calls[0].resolve(null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  f.calls[1].resolve(true);
  await settle();
  assert.deepEqual(
    f.diagnostics.filter((row) => row.event === "read-state-checked"),
    [
      {
        chatplusUnreadDiagnostic: 1,
        source: "mattermost-dom",
        event: "read-state-checked",
        reason: "unverified-zero",
        generation: 7,
      },
      {
        chatplusUnreadDiagnostic: 1,
        source: "mattermost-dom",
        event: "read-state-checked",
        reason: "verified-zero",
        generation: 7,
      },
    ],
  );
});

for (const [name, invalidate] of [
  ["blur", (f) => f.focus(false)],
  ["hidden document", (f) => f.visibility("hidden")],
  ["native generation", (f) => f.foreground(true, 8, 1)],
  ["new arrival", (f) => f.foreground(true, 7, 2)],
  [
    "route ABA",
    (f) => {
      f.route("/mm/team/channels/other");
      f.route("/mm/team/channels/town-square");
    },
  ],
  ["overlay", (f) => f.cover()],
  ["unmount", (f) => f.document.getElementById("postListContent").remove()],
  [
    "new rendered post",
    (f) =>
      (f.document.querySelector('[data-testid="postView"]').id =
        `post_${nextPost}`),
  ],
  [
    "same-post content edit",
    (f) => {
      const target = f.document.getElementById("message-body");
      const removedNodes = [...target.childNodes];
      target.textContent = "Edited message";
      // Swiph3l: Linkedom attributes this childList to Document. Queue the
      // browser-specified parent record only for takeRecords(), preserving the
      // observer-lag race: the async receipt must drain pending DOM changes.
      f.recordMutation({
        type: "childList",
        target,
        addedNodes: [...target.childNodes],
        removedNodes,
      });
    },
  ],
  [
    "pane detach/reinsert ABA",
    (f) => {
      const root = f.document.getElementById("postListContent");
      const parent = root.parentElement;
      root.remove();
      parent.append(root);
    },
  ],
]) {
  test(`Mattermost discards pending server zero after ${name}`, async (t) => {
    const f = fixture();
    t.after(() => f.dispose());
    f.foreground();
    f.gesture();
    assert.equal(f.calls.length, 1);
    invalidate(f);
    // The verification result may arrive before MutationObserver delivery.
    f.calls[0].resolve(true);
    await settle();
    assertNoRead(f);
    assert.equal(
      f.calls.length,
      1,
      "invalidated replies cannot schedule background retries",
    );
  });
}

for (const [name, options, breakScope] of [
  ["origin mismatch", { configured: "https://other.example.test/mm/" }],
  [
    "configured URL credentials",
    { configured: "https://user@chat.example.test/mm/" },
  ],
  [
    "configured URL query",
    { configured: "https://chat.example.test/mm/?token=example" },
  ],
  [
    "outside configured subpath",
    { path: "/another/team/channels/town-square" },
  ],
  ["unknown provider route", { path: "/mm/team/settings" }],
  [
    "missing post identity",
    {},
    (f) =>
      f.document
        .querySelector('[data-testid="postView"]')
        .removeAttribute("id"),
  ],
  [
    "duplicate post list",
    {},
    (f) =>
      f.document
        .getElementById("postListScrollContainer")
        .insertAdjacentHTML("beforeend", '<div id="postListContent"></div>'),
  ],
]) {
  test(`Mattermost ${name} cannot start a read request`, async (t) => {
    const f = fixture(options);
    t.after(() => f.dispose());
    breakScope?.(f);
    f.foreground();
    f.gesture();
    await settle();
    assert.equal(f.calls.length, 0);
    assertNoRead(f);
  });
}

test("Mattermost disposal aborts an in-flight query and ignores its later success", async () => {
  const f = fixture();
  f.foreground();
  f.gesture();
  await settle();
  const before = f.messages.length;
  f.stop();
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].resolve(true);
  await settle();
  assert.equal(f.messages.length, before);
  assert.equal(f.adapter.snapshot().hasUnread, null);
  assert.equal(f.host.__chatplusSetForeground, undefined);
});
