import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

const bundle = (
  await build({
    entryPoints: ["src/theme/arrow-keys.ts"],
    bundle: true,
    write: false,
    format: "iife",
  })
).outputFiles[0].text;

// Characters are built from code points so the source stays plain ASCII.
const ch = (code) => String.fromCodePoint(code);
const RIGHT = ch(0x1d); // what ChatPlus's editor received for Right Arrow
const LEFT = ch(0x1c);
const UP = ch(0x1e);
const DOWN = ch(0x1f);

function page() {
  const moves = [];
  const host = new EventTarget();
  host.getSelection = () => ({ modify: (...move) => moves.push(move) });
  runInNewContext(bundle, { window: host, EventTarget });
  const input = (data) => {
    const event = new Event("beforeinput", { cancelable: true, bubbles: true });
    Object.assign(event, { data, inputType: "insertText" });
    host.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const key = (modifiers = {}) => {
    const event = new Event("keydown", { cancelable: true, bubbles: true });
    Object.assign(event, {
      key: "ArrowRight",
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ...modifiers,
    });
    host.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { input, key, moves };
}

test("Right Arrow's U+001D is not typed and the caret moves instead", () => {
  const { input, key, moves } = page();
  assert.equal(key(), false, "the arrow key itself is never blocked");
  assert.equal(input(RIGHT), true);
  assert.deepEqual(moves, [["move", "forward", "character"]]);
});

test("every arrow, Home and End move the way the key means", () => {
  const { input, key, moves } = page();
  for (const data of [LEFT, RIGHT, UP, DOWN, ch(0x01), ch(0x04)]) {
    key();
    assert.equal(input(data), true);
  }
  assert.deepEqual(moves, [
    ["move", "backward", "character"],
    ["move", "forward", "character"],
    ["move", "backward", "line"],
    ["move", "forward", "line"],
    ["move", "backward", "lineboundary"],
    ["move", "forward", "lineboundary"],
  ]);
});

test("modifiers follow macOS conventions", () => {
  const { input, key, moves } = page();
  key({ shiftKey: true });
  input(RIGHT);
  key({ altKey: true });
  input(LEFT);
  key({ metaKey: true, shiftKey: true });
  input(RIGHT);
  key({ metaKey: true });
  input(DOWN);
  assert.deepEqual(moves, [
    ["extend", "forward", "character"],
    ["move", "backward", "word"],
    ["extend", "forward", "lineboundary"],
    ["move", "forward", "documentboundary"],
  ]);
});

test("other control characters are never typed but move nothing", () => {
  const { input, moves } = page();
  for (const code of [0x00, 0x08, 0x0b, 0x1b, 0x7f])
    assert.equal(input(ch(code)), true, code.toString(16));
  assert.deepEqual(moves, []);
});

test("real text, Tab and newlines are untouched", () => {
  const { input, moves } = page();
  for (const data of [
    "a",
    "/",
    "é",
    "😀",
    "\t",
    "\n",
    "\r",
    "ab",
    ch(0xf703),
    ch(0xf8ff),
    null,
  ])
    assert.equal(input(data), false, JSON.stringify(data));
  assert.deepEqual(moves, []);
});
