import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const built = await build({
  stdin: {
    contents: `export { createDiscordInboxRead } from "./src/theme/providers/discord-read";
      export { installUnreadAdapter } from "./src/theme/provider-unread";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
});
const { createDiscordInboxRead, installUnreadAdapter } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

function fixture({ consume = true } = {}) {
  const { document, window } = parseHTML(`<html><body>
    <div role="button" aria-label="Inbox" id="open"></div>
    <div class="recentMentionsPopout_current" id="inbox" hidden>
      <div role="tablist"><div role="tab" id="unreads-tab" aria-selected="false">Unreads</div>
      <div role="tab" aria-selected="true">Mentions</div></div>
      <button id="mark" aria-label="Mark Inbox As Read"></button>
      <div role="tabpanel"><div id="private-message">Private text</div></div>
    </div><button id="unrelated" aria-label="Mark Inbox As Read"></button>
  </body></html>`);
  window.getComputedStyle = (element) => ({
    display: element.style.display || "block",
    visibility: element.style.visibility || "visible",
  });
  for (const element of document.querySelectorAll("*"))
    element.getBoundingClientRect = () => ({ width: 20, height: 20 });
  // Swiph3l: Only public control metadata may identify this action; a provider
  // message/contact body must never become a selector or leak into a result.
  Object.defineProperty(
    document.getElementById("private-message"),
    "textContent",
    {
      get() {
        throw new Error("message contents were inspected");
      },
    },
  );
  const clicks = [];
  document.getElementById("open").addEventListener("click", () => {
    clicks.push("open");
    document.getElementById("inbox").hidden = false;
  });
  document.getElementById("unreads-tab").addEventListener("click", (event) => {
    clicks.push("unreads");
    event.currentTarget.setAttribute("aria-selected", "true");
  });
  document.getElementById("mark").addEventListener("click", (event) => {
    clicks.push("mark");
    if (consume) event.currentTarget.setAttribute("aria-disabled", "true");
  });
  document
    .getElementById("unrelated")
    .addEventListener("click", () => clicks.push("unrelated"));
  return { document, window, clicks, step: createDiscordInboxRead(document) };
}

function copyControl(element) {
  const copy = element.cloneNode(true);
  copy.getBoundingClientRect = element.getBoundingClientRect;
  return copy;
}

test("Discord reads through the unique public Inbox and selected Unreads action, then waits for its consumed state", () => {
  const f = fixture();
  assert.equal(f.step("1"), "waiting");
  assert.equal(f.step("1"), "waiting");
  assert.equal(f.step("1"), "waiting");
  assert.equal(f.step("1"), "waiting");
  assert.equal(f.step("1"), "submitted");
  assert.deepEqual(f.clicks, ["open", "unreads", "mark"]);
});

test("observed Polish Inbox controls use the full unread-tab and mark-all names", () => {
  const f = fixture();
  const inbox = f.document.getElementById("inbox");
  inbox.removeAttribute("class");
  inbox.setAttribute("role", "dialog");
  inbox.setAttribute("aria-label", "Skrzynka odbiorcza");
  f.document
    .getElementById("open")
    .setAttribute("aria-label", "Skrzynka odbiorcza");
  const tab = f.document.getElementById("unreads-tab");
  tab.id = "localized-unread-tab";
  tab.textContent = "Nieprzeczytane wiadomości";
  f.document
    .getElementById("mark")
    .setAttribute("aria-label", "Oznacz wszystko jako przeczytane");
  for (let i = 0; i < 4; i++) assert.equal(f.step("1"), "waiting");
  assert.equal(f.step("1"), "submitted");
  assert.deepEqual(f.clicks, ["open", "unreads", "mark"]);
});

test("an unchanged read-all control is never clicked repeatedly or treated as completed", () => {
  const f = fixture({ consume: false });
  for (let i = 0; i < 20; i++) assert.equal(f.step("1"), "waiting");
  assert.deepEqual(f.clicks, ["open", "unreads", "mark"]);
});

test("after-click retry/error, renamed, removed, replaced and ambiguous actions cannot become successful reads", () => {
  for (const change of [
    (f) => {
      f.document.getElementById("mark").setAttribute("aria-label", "Retry");
      const alert = f.document.createElement("div");
      alert.setAttribute("role", "alert");
      alert.getBoundingClientRect = () => ({ width: 20, height: 20 });
      f.document.getElementById("inbox").append(alert);
    },
    (f) =>
      f.document.getElementById("mark").setAttribute("aria-label", "Retry"),
    (f) => f.document.getElementById("mark").remove(),
    (f) => {
      const mark = f.document.getElementById("mark");
      mark.replaceWith(copyControl(mark));
    },
    (f) =>
      f.document.getElementById("mark").setAttribute("aria-invalid", "true"),
    (f) =>
      f.document
        .getElementById("inbox")
        .append(copyControl(f.document.getElementById("mark"))),
  ]) {
    const f = fixture();
    for (let i = 0; i < 3; i++) assert.equal(f.step("1"), "waiting");
    change(f);
    assert.equal(f.step("1"), "unavailable");
    assert.equal(f.step("1"), "unavailable");
    assert.deepEqual(f.clicks, ["open", "unreads", "mark"]);
  }
});

test("a consumed public control cannot acknowledge local arrivals until fresh complete provider zero is confirmed", async () => {
  const f = fixture();
  Object.defineProperty(f.document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  f.document.hasFocus = () => false;
  let unread = true;
  let providerZero = false;
  const messages = [];
  const host = {
    chrome: {
      webview: {
        postMessage(value) {
          messages.push(JSON.parse(value));
        },
      },
    },
  };
  const adapter = {
    source: "discord-dom",
    snapshot: () => ({ hasUnread: unread, count: null }),
    providerUnreadZero: () => providerZero,
    readContext: () => null,
    contentContext: () => null,
    interactionContext: () => null,
    isViewingNotification: () => false,
    observe: () => () => {},
    readAllStep: f.step,
  };
  const stop = installUnreadAdapter(adapter, f.document, host);
  try {
    host.__chatplusSetForeground(true, 1);
    for (let i = 0; i < 6; i++)
      assert.equal(host.__chatplusReadAllStep("1"), "waiting");
    assert.deepEqual(f.clicks, ["open", "unreads", "mark"]);
    unread = null;
    assert.equal(
      host.__chatplusReadAllStep("1"),
      "waiting",
      "partial DOM never proves zero",
    );
    providerZero = true;
    assert.equal(
      host.__chatplusReadAllStep("1"),
      "waiting",
      "unknown aggregate cannot use a conflicting provider-zero claim",
    );
    unread = false;
    providerZero = false;
    assert.equal(
      host.__chatplusReadAllStep("1"),
      "waiting",
      "provider must independently confirm complete zero",
    );
    providerZero = true;
    assert.equal(host.__chatplusReadAllStep("1"), "submitted");
    await new Promise(setImmediate);
    assert.ok(
      messages
        .filter((message) => message.chatplusUnread)
        .every((message) => message.acknowledgement === null),
      "the renderer hook itself cannot acknowledge native arrivals",
    );
  } finally {
    stop();
  }
});

test("provider confirmation remains visible for the user and cannot acknowledge the captured boundary", () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) assert.equal(f.step("1"), "waiting");
  const modal = f.document.createElement("div");
  modal.setAttribute("role", "alertdialog");
  f.document.body.append(modal);
  assert.equal(f.step("1"), "confirmation");
  assert.deepEqual(f.clicks, ["open", "unreads", "mark"]);
});

test("ambiguous, disabled or renamed controls fail closed without another read action", () => {
  for (const change of [
    (f) =>
      f.document
        .getElementById("inbox")
        .append(copyControl(f.document.getElementById("mark"))),
    (f) => f.document.getElementById("mark").setAttribute("disabled", ""),
    (f) =>
      f.document
        .getElementById("mark")
        .setAttribute("aria-label", "Mark channel as read"),
  ]) {
    const f = fixture();
    f.step("1");
    f.step("1");
    change(f);
    assert.equal(f.step("1"), "unavailable");
    assert.deepEqual(f.clicks, ["open", "unreads"]);
  }
});

test("duplicate Inbox openers and an existing modal never trigger a control", () => {
  const f = fixture();
  f.document.body.append(copyControl(f.document.getElementById("open")));
  assert.equal(f.step("1"), "unavailable");
  assert.deepEqual(f.clicks, []);
  assert.equal(f.step("bad operation"), "unavailable");
  const modalFixture = fixture();
  const modal = modalFixture.document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modalFixture.document.body.append(modal);
  assert.equal(modalFixture.step("1"), "confirmation");
  assert.deepEqual(modalFixture.clicks, []);
});

test("native read-all hook requires a foreground supported adapter, emits no local read proof and is removed on disposal", async () => {
  const f = fixture();
  Object.defineProperty(f.document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  f.document.hasFocus = () => false;
  let calls = 0;
  const host = {};
  const adapter = {
    source: "discord-dom",
    snapshot: () => ({ hasUnread: true, count: null }),
    readContext: () => null,
    contentContext: () => null,
    interactionContext: () => null,
    isViewingNotification: () => false,
    observe: () => () => {},
    readAllStep: () => {
      calls++;
      return "waiting";
    },
  };
  const stop = installUnreadAdapter(adapter, f.document, host);
  assert.equal(host.__chatplusReadAllStep("1"), "unavailable");
  host.__chatplusSetForeground(true, 1);
  assert.equal(host.__chatplusReadAllStep("1"), "waiting");
  assert.equal(calls, 1, "native menu can own browser focus");
  adapter.source = "whatsapp-dom";
  assert.equal(host.__chatplusReadAllStep("1"), "unavailable");
  assert.equal(calls, 1);
  stop();
  assert.equal(host.__chatplusReadAllStep, undefined);
  await new Promise(setImmediate);
});
