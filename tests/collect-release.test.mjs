import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const collector = path.resolve("scripts/collect-release.mjs");
const checksums = path.resolve("scripts/checksums.mjs");

test("Windows collection preserves application bytes, installer update target and checksums", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "chatplus-collect-"));
  const application = Buffer.from("Non-executable application fixture");
  const installer = Buffer.from("Non-executable installer fixture");
  const prefix = "windows-x86_64--ChatPlus-Desktop_0.5.0-beta.2_x64";
  try {
    await mkdir(path.join(root, "src-tauri/target/release/bundle/nsis"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: "0.5.0-beta.2" }),
    );
    await writeFile(
      path.join(root, "src-tauri/target/release/chatplus-desktop.exe"),
      application,
    );
    await writeFile(
      path.join(root, "src-tauri/target/release/bundle/nsis/setup.exe"),
      installer,
    );
    await writeFile(
      path.join(root, "src-tauri/target/release/bundle/nsis/setup.exe.sig"),
      "copy-only sidecar fixture",
    );
    const run = () =>
      spawnSync(process.execPath, [collector, "windows-x86_64"], {
        cwd: root,
        encoding: "utf8",
      });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const output = path.join(root, "release-artifacts");
    assert.deepEqual(
      await readFile(path.join(output, `${prefix}.exe`)),
      application,
    );
    assert.deepEqual(
      await readFile(path.join(output, `${prefix}-setup.exe`)),
      installer,
    );
    assert.equal(
      await readFile(path.join(output, `${prefix}-setup.exe.sig`), "utf8"),
      "copy-only sidecar fixture",
    );
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(output, "windows-x86_64--target.json"),
          "utf8",
        ),
      ).file,
      `${prefix}-setup.exe`,
    );
    result = spawnSync(process.execPath, [checksums, output], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const sums = await readFile(path.join(output, "SHA256SUMS.txt"), "utf8");
    assert.ok(
      sums.includes(
        `${createHash("sha256").update(application).digest("hex")}  ${prefix}.exe\n`,
      ),
    );
    await writeFile(
      path.join(root, "src-tauri/target/release/chatplus-desktop.exe"),
      installer,
    );
    assert.notEqual(
      run().status,
      0,
      "reject an installer substituted for the application",
    );
    await rm(path.join(root, "src-tauri/target/release/chatplus-desktop.exe"));
    assert.notEqual(
      run().status,
      0,
      "missing application must fail collection",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
