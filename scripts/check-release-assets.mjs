import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const files = await readdir("dist/assets");
const scripts = await Promise.all(
  files
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFile(`dist/assets/${f}`, "utf8")),
);
for (const marker of [
  "Local shell test",
  "DEVELOPMENT ONLY",
  "fixture-message",
  "developer_action",
]) {
  assert.ok(
    !scripts.some((s) => s.includes(marker)),
    `Debug marker leaked into production assets: ${marker}`,
  );
}
assert.ok(
  !files.some((f) => f.startsWith("fixture")),
  "Fixture chunk leaked into production assets",
);
console.log("Production assets exclude the development fixture.");
