import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { manifestName } from "../scripts/updater-metadata.mjs";
import {
  validateIdentity,
  validateSigning,
  repositoryIdentity,
} from "../scripts/release-identity.mjs";
import { requireWindowsJob } from "../scripts/release-checks.mjs";

test("release requires exact synchronized version and production signing configuration", () => {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  assert.equal(repositoryIdentity(`v${version}`).version, version);
  assert.equal(
    validateIdentity("v0.5.0-beta.1", ["0.5.0-beta.1"]).prerelease,
    true,
  );
  assert.throws(() => validateIdentity("v0.5.0", ["0.5.0-beta.1"]));
  assert.throws(() =>
    validateIdentity("v0.5.0-beta.1", ["0.5.0-beta.1", "0.5.0"]),
  );
  assert.throws(() => validateIdentity("v01.0.0", ["01.0.0"]));
  assert.throws(() =>
    validateSigning({ updaterEnabled: false, updaterPublicKey: "" }, ""),
  );
  assert.throws(() =>
    validateSigning(
      { updaterEnabled: true, updaterPublicKey: "placeholder" },
      "",
    ),
  );
});
test("Windows gate ignores experimental platforms but rejects missing or failing Windows", () => {
  requireWindowsJob([
    { name: "validate (windows-latest, nsis)", conclusion: "success" },
    { name: "validate (ubuntu-latest, deb)", conclusion: "failure" },
  ]);
  assert.throws(() => requireWindowsJob([]));
  assert.throws(() =>
    requireWindowsJob([
      { name: "validate (windows-latest, nsis)", conclusion: "failure" },
    ]),
  );
});
test("beta metadata never overwrites stable manifest and checksums hash actual EXE bytes", async () => {
  assert.equal(manifestName("0.5.0-beta.1"), "latest-prerelease.json");
  assert.equal(manifestName("0.5.0-beta.2"), "latest-prerelease.json");
  assert.equal(manifestName("0.5.0"), "latest.json");
  const dir = await mkdtemp(path.join(tmpdir(), "chatplus-release-test-"));
  const cli = path.resolve("scripts/updater-metadata.mjs");
  const checksums = path.resolve("scripts/checksums.mjs");
  try {
    await writeFile(
      path.join(dir, "project.json"),
      JSON.stringify({
        owner: "Swiph3l",
        repository: "synology-chatplus-desktop",
      }),
    );
    await writeFile(path.join(dir, "notes.md"), "Fixture only");
    await writeFile(path.join(dir, "app.exe"), "Non-executable fixture bytes");
    // Envelope-only fixture; cryptographic verification belongs to Rust HTTPS tests.
    await writeFile(
      path.join(dir, "app.exe.sig"),
      Buffer.from(
        "untrusted comment: fixture\nfixture\ntrusted comment: fixture\nfixture",
      ).toString("base64"),
    );
    await writeFile(path.join(dir, "latest.json"), "stable sentinel");
    const run = spawnSync(
      process.execPath,
      [cli, dir, "0.5.0-beta.1", "notes.md", "windows-x86_64=app.exe"],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      await readFile(path.join(dir, "latest.json"), "utf8"),
      "stable sentinel",
    );
    const beta = JSON.parse(
      await readFile(path.join(dir, "latest-prerelease.json"), "utf8"),
    );
    assert.equal(beta.version, "0.5.0-beta.1");
    assert.match(
      beta.platforms["windows-x86_64"].url,
      /\/v0\.5\.0-beta\.1\/app.exe$/,
    );
    const result = spawnSync(process.execPath, [checksums, dir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const digest = createHash("sha256")
      .update(await readFile(path.join(dir, "app.exe")))
      .digest("hex");
    assert.ok(
      (await readFile(path.join(dir, "SHA256SUMS.txt"), "utf8")).includes(
        `${digest}  app.exe\n`,
      ),
    );
    const stable = spawnSync(
      process.execPath,
      [cli, dir, "0.5.0", "notes.md", "windows-x86_64=app.exe"],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(stable.status, 0, stable.stderr);
    assert.equal(
      JSON.parse(await readFile(path.join(dir, "latest.json"), "utf8")).version,
      "0.5.0",
    );
    assert.ok((await readdir(dir)).includes("latest-prerelease.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
