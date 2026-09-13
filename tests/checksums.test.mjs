import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

test("checksums cover nested platform artifacts and change with final bytes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "chatplus-hashes-"));
  const run = () => spawnSync(process.execPath, ["scripts/checksums.mjs", dir]);
  try {
    assert.notEqual(run().status, 0, "empty output cannot pass");
    await mkdir(path.join(dir, "linux"));
    await writeFile(path.join(dir, "linux", "app.deb"), "package bytes");
    await writeFile(path.join(dir, "setup.exe"), "final executable");
    assert.equal(run().status, 0);
    const original = await readFile(path.join(dir, "SHA256SUMS.txt"), "utf8");
    assert.equal(original.trim().split("\n").length, 2);
    assert.ok(
      original.includes(
        createHash("sha256").update("final executable").digest("hex") +
          "  setup.exe",
      ),
    );
    assert.equal(run().status, 0);
    assert.equal(
      await readFile(path.join(dir, "SHA256SUMS.txt"), "utf8"),
      original,
    );
    await writeFile(path.join(dir, "setup.exe"), "signed final executable");
    assert.equal(run().status, 0);
    assert.notEqual(
      await readFile(path.join(dir, "SHA256SUMS.txt"), "utf8"),
      original,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
