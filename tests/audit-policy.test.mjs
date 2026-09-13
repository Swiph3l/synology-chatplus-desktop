import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLinux } from "../scripts/audit-linux.mjs";
const known = {
  type: "diagnostic",
  fields: {
    severity: "error",
    code: "unsound",
    advisory: { id: "RUSTSEC-2024-0429", package: "glib" },
    graphs: [{ Krate: { name: "glib", version: "0.18.5" } }],
  },
};
const report = (errors) =>
  [
    ...errors,
    { type: "summary", fields: { advisories: { errors: errors.length } } },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n");
test("Linux exception is restricted to the reviewed unsoundness and absent Windows crate", () => {
  assert.match(
    classifyLinux(report([known]), 1, "tauri v2.11.5"),
    /REQUIRES REVIEW/,
  );
  assert.equal(classifyLinux(report([]), 0, ""), "PASS");
  assert.throws(() => classifyLinux(report([known]), 1, "glib v0.18.5"));
  for (const patch of [
    { code: "vulnerability" },
    { advisory: { id: "RUSTSEC-2099-0001", package: "glib" } },
    { graphs: [{ Krate: { name: "glib", version: "0.19.0" } }] },
  ])
    assert.throws(() =>
      classifyLinux(
        report([{ ...known, fields: { ...known.fields, ...patch } }]),
        1,
        "",
      ),
    );
  assert.throws(() => classifyLinux(report([known, known]), 1, ""));
  assert.throws(() => classifyLinux("not JSON", 1, ""));
  assert.throws(() => classifyLinux("", 1, ""));
  assert.throws(() => classifyLinux(report([]), 1, ""));
  assert.throws(() => classifyLinux(report([known]), null, ""));
});
