import { test } from "node:test";
import assert from "node:assert/strict";
import { transform } from "esbuild";
import { readFile } from "node:fs/promises";
const { code } = await transform(await readFile("src/app/about.ts", "utf8"), {
  loader: "ts",
  format: "esm",
});
const { hasSupport, available, yesNo } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
test("support controls stay hidden without a configured URL", () => {
  for (const value of [null, "", "   "]) assert.equal(hasSupport(value), false);
  assert.equal(hasSupport("https://example.com/support"), true);
});
test("unavailable metadata is distinguished from false", () => {
  assert.equal(available(null), "Unavailable");
  assert.equal(yesNo(null), "Unavailable");
  assert.equal(yesNo(false), "No");
  assert.equal(yesNo(true), "Yes");
});
