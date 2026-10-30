import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const built = await build({
  entryPoints: ["src/theme/providers/dom.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { createViewContext } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

function fixture() {
  const { document } = parseHTML(
    '<html><body><main><section class="message-pane"><article>Example</article></section></main></body></html>',
  );
  let observer;
  class MutationObserver {
    records = [];
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe() {}
    disconnect() {}
    takeRecords() {
      return this.records.splice(0);
    }
  }
  const location = { href: "https://provider.example/conversation" };
  Object.defineProperty(document, "defaultView", {
    value: {
      MutationObserver,
      location,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  const pane = document.querySelector(".message-pane");
  const query = document.querySelectorAll.bind(document);
  let queries = 0;
  document.querySelectorAll = (selector) => {
    queries += 1;
    return query(selector);
  };
  const contexts = createViewContext(document, ".message-pane", "test-view");
  let changes = 0;
  const stop = contexts.observe(() => {
    changes += 1;
  });
  return {
    document,
    pane,
    contexts,
    location,
    stop,
    get queries() {
      return queries;
    },
    get changes() {
      return changes;
    },
    record(target, type = "childList", rest = {}) {
      observer.records.push({
        target,
        type,
        addedNodes: [],
        removedNodes: [],
        ...rest,
      });
    },
    notify() {
      observer.callback(observer.takeRecords());
    },
  };
}

test("repeated context reads avoid pane discovery when the mutation queue is empty", () => {
  const f = fixture();
  const original = f.contexts.key(f.pane);
  for (let index = 0; index < 1_000; index += 1)
    assert.equal(f.contexts.key(f.pane), original);
  assert.equal(f.queries, 0);
  f.location.href = "https://provider.example/another-conversation";
  assert.notEqual(f.contexts.key(f.pane), original);
  assert.equal(f.queries, 0);
  f.stop();
});

test("presentation-only mutations notify visibility checks without discovering panes or revoking content", () => {
  const f = fixture();
  const original = f.contexts.key(f.pane);
  for (const attributeName of ["class", "style", "hidden", "aria-hidden"])
    f.record(f.pane, "attributes", { attributeName });
  f.notify();
  assert.equal(f.changes, 1);
  assert.equal(f.contexts.key(f.pane), original);
  assert.equal(f.queries, 0);
});

test("pending content and identity mutations revoke a context before observer delivery with one discovery per batch", () => {
  for (const [type, rest] of [
    ["childList", {}],
    ["characterData", {}],
    ["attributes", { attributeName: "id" }],
    ["attributes", { attributeName: "data-conversation" }],
  ]) {
    const f = fixture();
    const original = f.contexts.key(f.pane);
    for (let index = 0; index < 100; index += 1)
      f.record(f.pane.firstChild, type, rest);
    assert.notEqual(f.contexts.key(f.pane), original);
    assert.equal(f.queries, 1);
    f.notify();
    assert.equal(f.queries, 1);
  }
});

test("detaching and reinserting the same pane revokes the previous gesture", () => {
  const f = fixture();
  const original = f.contexts.key(f.pane);
  const owner = f.pane.parentElement;
  f.pane.remove();
  owner.append(f.pane);
  f.record(owner, "childList", { removedNodes: [f.pane] });
  f.record(owner, "childList", { addedNodes: [f.pane] });
  assert.notEqual(f.contexts.key(f.pane), original);
  assert.equal(f.queries, 1);
});
