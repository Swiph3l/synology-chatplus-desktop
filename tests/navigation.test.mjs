import { test } from "node:test";
import assert from "node:assert/strict";
import { transform } from "esbuild";
import { readFile } from "node:fs/promises";
const { code } = await transform(
  await readFile("src/app/navigation.ts", "utf8"),
  { loader: "ts", format: "esm" },
);
const { normalizeServer } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
test("normalizes server URLs", () => {
  assert.equal(
    normalizeServer(" https://nas.example.com/chat "),
    "https://nas.example.com/chat/",
  );
  assert.equal(
    normalizeServer("http://localhost:5000/chat///"),
    "http://localhost:5000/chat/",
  );
});
test("rejects credentials, tokens, non-web schemes and malformed input", () => {
  for (const value of [
    "file:///tmp",
    "javascript:alert(1)",
    "https:example.com",
    "https://user:secret@example.com",
    "https://example.com/?token=x",
    "https://example.com/#x",
    "https://exa mple.com",
    "https://example.com\\evil",
    "",
  ])
    assert.throws(() => normalizeServer(value));
});
