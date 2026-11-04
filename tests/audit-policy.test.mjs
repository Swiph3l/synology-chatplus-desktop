import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classifyLinux,
  registryAuditLock,
  verifyRegistryAudit,
} from "../scripts/audit-linux.mjs";

const manifest = JSON.parse(
  await readFile(
    new URL("../security/glib-backport.json", import.meta.url),
    "utf8",
  ),
);
const summary = (errors = []) =>
  [
    ...errors,
    { type: "summary", fields: { advisories: { errors: errors.length } } },
  ]
    .map(JSON.stringify)
    .join("\n");
const finding = () => ({
  advisory: {
    id: manifest.advisory,
    package: "glib",
    informational: "unsound",
  },
  package: {
    name: "glib",
    version: "0.18.5",
    source: manifest.package.registrySource,
  },
});
const report = () => ({
  vulnerabilities: { found: false, count: 0, list: [] },
  warnings: { unsound: [finding()] },
});

test("Linux policy no longer accepts an unpatched advisory exception", () => {
  assert.equal(classifyLinux(summary(), 0), "PASS");
  const error = {
    type: "diagnostic",
    fields: {
      severity: "error",
      code: "unsound",
      advisory: { id: manifest.advisory },
    },
  };
  assert.throws(() => classifyLinux(summary([error]), 1));
  assert.throws(() => classifyLinux(summary([error]), 0));
  for (const [text, status] of [
    ["", 0],
    ["not JSON", 0],
    [summary(), 1],
    [summary(), null],
  ])
    assert.throws(() => classifyLinux(text, status));
});

test("audit inventory restores only the original glib registry identity", () => {
  const lock =
    '# generated\n[[package]]\nname = "glib"\nversion = "0.18.5"\ndependencies = ["libc"]\n\n[[package]]\nname = "libc"\nversion = "0.2.0"\n';
  const restored = registryAuditLock(lock, manifest);
  assert.ok(
    restored.includes(`checksum = "${manifest.package.archiveSha256}"`),
  );
  assert.ok(restored.includes(`source = "${manifest.package.registrySource}"`));
  assert.equal(
    restored.split('[[package]]\nname = "libc"')[1],
    lock.split('[[package]]\nname = "libc"')[1],
  );
  assert.throws(() => registryAuditLock(restored, manifest));
  assert.throws(() =>
    registryAuditLock(lock.replace("0.18.5", "0.20.0"), manifest),
  );
  assert.throws(() => registryAuditLock(lock + lock, manifest));
  assert.throws(() => registryAuditLock("", manifest));
});

test("original-identity review accepts only the verified backported unsoundness", () => {
  assert.equal(verifyRegistryAudit(report(), 0, manifest), 1);
  assert.throws(() =>
    verifyRegistryAudit({ ...report(), warnings: {} }, 0, manifest),
  );
  for (const mutate of [
    (data) => {
      data.warnings.unsound[0].advisory.id = "RUSTSEC-2099-0001";
    },
    (data) => {
      data.warnings.unsound[0].advisory.informational = "unmaintained";
    },
    (data) => {
      data.warnings.unsound[0].package.version = "0.18.6";
    },
    (data) => {
      data.warnings.unsound[0].package.source = null;
    },
    (data) => {
      data.warnings.unmaintained = data.warnings.unsound;
      delete data.warnings.unsound;
    },
    (data) => {
      data.warnings.unsound.push(finding());
    },
    (data) => {
      data.vulnerabilities = { found: true, count: 1, list: [finding()] };
    },
  ]) {
    const data = report();
    mutate(data);
    assert.throws(() => verifyRegistryAudit(data, 0, manifest));
  }
  assert.throws(() => verifyRegistryAudit(report(), 1, manifest));
  assert.throws(() => verifyRegistryAudit({}, 0, manifest));
  assert.throws(() =>
    verifyRegistryAudit(
      { ...report(), warnings: { unsound: null } },
      0,
      manifest,
    ),
  );
});
