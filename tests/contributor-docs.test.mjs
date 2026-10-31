import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

test("published README credits stay synchronized with the reviewed contributor registry", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../scripts/update-contributors.mjs", import.meta.url),
      ),
      "--check",
    ],
    { cwd: tmpdir(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a registry-only contributor and Linux port can be credited and regenerated", async (context) => {
  const project = await mkdtemp(join(tmpdir(), "chatplus-contributor-docs-"));
  context.after(async () => {
    const target = resolve(project);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^chatplus-contributor-docs-/);
    await rm(target, { recursive: true, force: true });
  });
  await mkdir(join(project, "scripts"));
  await mkdir(join(project, "src", "i18n"), { recursive: true });
  for (const file of [
    "scripts/update-contributors.mjs",
    "contributors.json",
    "src/i18n/en.json",
    "README.md",
  ]) {
    await copyFile(new URL(`../${file}`, import.meta.url), join(project, file));
  }
  const registryPath = join(project, "contributors.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  registry.contributors.push({
    id: "community-tester",
    name: "Community Tester",
    username: "community-tester",
    contributions: ["port"],
  });
  registry.forks.push({
    id: "community-linux",
    contributorId: "community-tester",
    owner: "community-tester",
    repository: "chatplus-linux",
    platform: "linux",
  });
  await writeFile(registryPath, JSON.stringify(registry));
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [join(project, "scripts", "update-contributors.mjs"), ...args],
      { cwd: tmpdir(), encoding: "utf8" },
    );
  assert.equal(
    run("--check").status,
    1,
    "a registry change requires README regeneration",
  );
  const updated = run();
  assert.equal(updated.status, 0, updated.stderr);
  const readme = await readFile(join(project, "README.md"), "utf8");
  assert.ok(
    readme.includes("[Community Tester](https://github.com/community-tester)"),
  );
  assert.ok(
    readme.includes(
      "[Linux community variant by Community Tester](https://github.com/community-tester/chatplus-linux)",
    ),
  );
  assert.equal(run("--check").status, 0);
});
