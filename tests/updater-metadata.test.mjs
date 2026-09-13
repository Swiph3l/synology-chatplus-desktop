import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generate, validVersion } from "../scripts/updater-metadata.mjs";
test("updater metadata rejects invalid SemVer and missing or fabricated signatures", async () => {
  for (const v of ["0.1.0", "0.2.0-alpha.1", "0.2.0-beta.1", "0.2.0-rc.1"])
    assert.ok(validVersion(v));
  for (const v of ["v0.1.0", "01.2.3", "1.2.3-01", "1.2", "../../x"])
    assert.ok(!validVersion(v));
  const dir = await mkdtemp(path.join(tmpdir(), "chatplus-update-metadata-"));
  try {
    await writeFile(path.join(dir, "app.exe"), "test bytes");
    const config = {
      owner: "Swiph3l",
      repository: "synology-chatplus-desktop",
    };
    await assert.rejects(
      generate(dir, "0.2.0", "", { "windows-x86_64": "app.exe" }, config),
    );
    await writeFile(path.join(dir, "app.exe.sig"), "not-a-real-signature");
    await assert.rejects(
      generate(dir, "0.2.0", "", { "windows-x86_64": "app.exe" }, config),
    );
    await assert.rejects(generate(dir, "0.2.0", "", {}, config));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
