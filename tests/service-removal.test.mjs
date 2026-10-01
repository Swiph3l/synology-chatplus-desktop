import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { runInNewContext } from "node:vm";

const result = await build({
  entryPoints: ["src/ui/service-removal.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "removalUi",
});
function fixture() {
  const { window, document } = parseHTML(
    '<html><body><button id="trigger">Remove</button></body></html>',
  );
  let focused = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  const create = document.createElement.bind(document);
  document.createElement = (tag) => {
    const element = create(tag);
    if (tag === "dialog") {
      // DOM harness lacks browser dialog methods; test our handlers, not native focus trapping.
      element.showModal = () => element.setAttribute("open", "");
      element.close = () => element.removeAttribute("open");
      element.getBoundingClientRect = () => ({
        left: 20,
        right: 420,
        top: 20,
        bottom: 220,
      });
    }
    return element;
  };
  const context = { document };
  runInNewContext(result.outputFiles[0].text, context);
  document.getElementById("trigger").focus();
  return { window, document, confirm: context.removalUi.confirmServiceRemoval };
}
test("shared removal dialog requires explicit destructive confirmation and escapes service names", async () => {
  const f = fixture();
  const accepted = f.confirm('<img src=x onerror="bad()">');
  const dialog = f.document.querySelector("dialog[open]");
  assert.ok(dialog);
  assert.ok(f.document.getElementById(dialog.getAttribute("aria-labelledby")));
  assert.ok(f.document.getElementById(dialog.getAttribute("aria-describedby")));
  assert.equal(dialog.querySelector("img"), null);
  assert.match(dialog.textContent, /stored profile is retained/);
  assert.equal(f.document.activeElement.textContent, "Cancel");
  dialog.querySelector(".danger").click();
  assert.equal(await accepted, true);
  assert.equal(f.document.querySelector("dialog"), null);
  assert.equal(f.document.activeElement.id, "trigger");
});
test("removal confirmation cancels with Cancel, Escape or backdrop and leaves inside clicks open", async () => {
  for (const action of ["button", "escape", "backdrop"]) {
    const f = fixture();
    const accepted = f.confirm("Test service");
    const dialog = f.document.querySelector("dialog");
    if (action === "button")
      dialog.querySelector(".secondary:not(.danger)").click();
    if (action === "escape") {
      const event = new f.window.Event("cancel", { cancelable: true });
      dialog.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    }
    if (action === "backdrop") {
      const inside = new f.window.Event("click");
      Object.assign(inside, { clientX: 30, clientY: 30 });
      dialog.dispatchEvent(inside);
      assert.ok(f.document.querySelector("dialog[open]"));
      const outside = new f.window.Event("click");
      Object.assign(outside, { clientX: 5, clientY: 5 });
      dialog.dispatchEvent(outside);
    }
    assert.equal(await accepted, false);
    assert.equal(f.document.querySelector("dialog"), null);
    assert.equal(f.document.activeElement.id, "trigger");
  }
});
test("a second removal request cannot reuse confirmation for a different service", async () => {
  const f = fixture();
  const first = f.confirm("First service");
  assert.equal(await f.confirm("Second service"), false);
  assert.equal(f.document.querySelectorAll("dialog").length, 1);
  assert.match(f.document.querySelector("dialog").textContent, /First service/);
  f.document.querySelector("dialog .secondary:not(.danger)").click();
  assert.equal(await first, false);
});
