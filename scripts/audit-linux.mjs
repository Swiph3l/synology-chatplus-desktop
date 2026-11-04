import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyBackport } from "./check-glib-backport.mjs";

export function classifyLinux(output, status) {
  const rows = output.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const summary = rows.find((row) => row.type === "summary")?.fields
    ?.advisories;
  const errors = rows.filter((row) => row.fields?.severity === "error");
  assert.ok(
    summary && summary.errors === errors.length,
    "Incomplete Linux audit",
  );
  assert.equal(status, 0, "Linux dependency policy failed");
  assert.equal(errors.length, 0, "Linux dependency policy reported errors");
  return "PASS";
}

// Swiph3l: Registry scanners omit a path-patched crate. Restore its published
// identity only in a temporary audit inventory, never in the compiled graph.
export function registryAuditLock(lock, manifest) {
  const blocks = lock.split(/(?=^\[\[package\]\]\r?$)/m);
  const glib = blocks.filter((block) => /^name = "glib"$/m.test(block));
  assert.equal(glib.length, 1, "Expected exactly one locked glib package");
  const block = glib[0];
  assert.match(block, /^version = "0\.18\.5"$/m, "Unreviewed glib version");
  assert.doesNotMatch(
    block,
    /^(?:source|checksum) = /m,
    "glib must use the verified path patch",
  );
  const restored = block.replace(
    /^(version = "0\.18\.5")\r?$/m,
    `$1\nsource = "${manifest.package.registrySource}"\nchecksum = "${manifest.package.archiveSha256}"`,
  );
  return blocks.map((entry) => (entry === block ? restored : entry)).join("");
}

export function verifyRegistryAudit(report, status, manifest) {
  assert.ok(
    report?.vulnerabilities &&
      typeof report.vulnerabilities.found === "boolean",
    "Incomplete RustSec report",
  );
  assert.ok(
    Array.isArray(report.vulnerabilities.list),
    "Missing RustSec vulnerability list",
  );
  assert.equal(
    report.vulnerabilities.count,
    report.vulnerabilities.list.length,
    "Inconsistent RustSec vulnerability count",
  );
  assert.equal(
    report.vulnerabilities.found,
    false,
    "RustSec found a vulnerability",
  );
  assert.equal(
    report.vulnerabilities.list.length,
    0,
    "RustSec found a vulnerability",
  );
  assert.equal(status, 0, "RustSec audit failed");
  assert.ok(
    report.warnings &&
      typeof report.warnings === "object" &&
      !Array.isArray(report.warnings),
    "Missing RustSec warnings",
  );
  let backported = 0;
  for (const [kind, findings] of Object.entries(report.warnings)) {
    assert.ok(Array.isArray(findings), "Malformed RustSec warning list");
    for (const finding of findings) {
      assert.ok(
        finding?.advisory?.id && finding?.package?.name,
        "Malformed RustSec finding",
      );
      if (finding.package.name !== "glib") continue;
      assert.equal(kind, "unsound", "Unreviewed glib advisory category");
      assert.equal(
        finding.advisory.id,
        manifest.advisory,
        "Unreviewed glib advisory",
      );
      assert.equal(
        finding.advisory.package,
        manifest.package.name,
        "Mismatched advisory package",
      );
      assert.equal(
        finding.advisory.informational,
        "unsound",
        "Unreviewed advisory classification",
      );
      assert.equal(
        finding.package.version,
        manifest.package.version,
        "Unreviewed glib version",
      );
      assert.equal(
        finding.package.source,
        manifest.package.registrySource,
        "Missing original registry identity",
      );
      backported++;
    }
  }
  assert.equal(
    backported,
    1,
    "The original glib advisory must remain visible before its verified backport is accepted",
  );
  return backported;
}

function run(args) {
  const result = spawnSync("cargo", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error)
    throw new Error("Cargo audit tool unavailable", { cause: result.error });
  return result;
}

async function audit() {
  const args = process.argv.slice(2);
  assert.ok(
    args.length === 0 ||
      (args.length === 2 && args[0] === "--advisory-db" && args[1]),
    "Usage: audit-linux.mjs [--advisory-db path]",
  );
  const { manifest, root } = await verifyBackport({ metadata: true });
  const temporary = await mkdtemp(path.join(tmpdir(), "chatplus-glib-audit-"));
  try {
    const lock = await readFile(
      path.join(root, "src-tauri/Cargo.lock"),
      "utf8",
    );
    const inventory = path.join(temporary, "Cargo.lock");
    await writeFile(inventory, registryAuditLock(lock, manifest));
    const registry = run([
      "audit",
      "--json",
      "--file",
      inventory,
      ...(args.length ? ["--db", args[1]] : []),
    ]);
    const report = JSON.parse(registry.stdout);
    const reviewed = verifyRegistryAudit(report, registry.status, manifest);
    console.log(
      `Original registry identity audited; verified backported advisory findings: ${reviewed}.`,
    );
    const policy = run([
      "deny",
      "--format",
      "json",
      "--manifest-path",
      path.join(root, "src-tauri/Cargo.toml"),
      "--config",
      path.join(root, "deny.toml"),
      "--target",
      "x86_64-unknown-linux-gnu",
      "--locked",
      "check",
      "advisories",
    ]);
    process.stdout.write(policy.stdout);
    process.stderr.write(policy.stderr);
    console.log(classifyLinux(policy.stderr, policy.status));
  } finally {
    assert.equal(
      path.dirname(temporary),
      path.resolve(tmpdir()),
      "Unexpected audit temporary directory",
    );
    assert.ok(
      path.basename(temporary).startsWith("chatplus-glib-audit-"),
      "Unexpected audit temporary directory",
    );
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await audit();
