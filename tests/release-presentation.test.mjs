import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  publicNames,
  releaseNotes,
  stageRelease,
  verifyDraft,
} from "../scripts/release-presentation.mjs";

const project = { owner: "Swiph3l", repository: "synology-chatplus-desktop" };
const version = "1.0.4";
const base =
  "https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v1.0.4/";
const legacySuffixes = {
  "windows-x86_64": "x64-setup.exe",
  "darwin-aarch64": "aarch64.app.tar.gz",
  "darwin-x86_64": "x64.app.tar.gz",
  "linux-x86_64": "amd64.AppImage",
};
const changelog =
  "# Changelog\n\n## 1.0.4 - Prepared\n\n### Added\n\n- New feature.\n\n## 1.0.3 - Earlier\n\nOlder changes.\n";

test("download choices match the public files and only describe the target release", () => {
  const notes = releaseNotes(project, version, changelog);
  assert.ok(notes.startsWith("## Download Chat+"));
  assert.ok(notes.includes("New feature."));
  assert.ok(!notes.includes("Older changes."));
  const links = Array.from(
    notes.matchAll(/\]\((https:\/\/[^)]+)\)/g),
    (match) => match[1],
  );
  const installers = publicNames(version).filter((name) =>
    /(?:-setup\.exe|\.dmg|\.deb|\.AppImage)$/.test(name),
  );
  assert.equal(installers.length, 5);
  assert.deepEqual(links.sort(), installers.map((name) => base + name).sort());
  assert.throws(
    () => releaseNotes(project, "1.0.5", changelog),
    /Missing changelog/,
  );
});

test("stage the signed 1.0.3-compatible file set and verify the authenticated draft before publication", async (t) => {
  const source = await mkdtemp(path.join(tmpdir(), "chatplus-draft-"));
  t.after(() => rm(source, { recursive: true, force: true }));
  const out = path.join(source, "public-release");
  const file = (name) => path.join(source, name);
  const names = publicNames(version);
  assert.equal(names.length, 14);
  for (const name of names) await writeFile(file(name), name);
  await writeFile(file("windows-x86_64--rust.cdx.json"), "build evidence");
  await writeFile(file("windows-x86_64--target.json"), "build provenance");
  const platforms = {};
  for (const [target, suffix] of Object.entries(legacySuffixes)) {
    const name = `${target}--ChatPlus-Desktop_1.0.4_${suffix}`;
    platforms[target] = { url: base + name, signature: name + ".sig" };
  }
  const manifest = { version, platforms };
  const writeManifest = (data) =>
    writeFile(file("latest.json"), JSON.stringify(data));
  const stage = () => stageRelease(project, version, source, out);
  await writeManifest({
    ...manifest,
    platforms: { "windows-x86_64": platforms["windows-x86_64"] },
  });
  await assert.rejects(stage);
  const bad = structuredClone(manifest);
  bad.platforms["linux-x86_64"].url += ".sig";
  await writeManifest(bad);
  await assert.rejects(stage, /updater URL/);
  const badSignature = structuredClone(manifest);
  badSignature.platforms["darwin-aarch64"].signature += "!";
  await writeManifest(badSignature);
  await assert.rejects(stage, /Signature mismatch/);
  await writeManifest(manifest);
  const diskImage = names.find((name) => name.endsWith(".dmg"));
  await rm(file(diskImage));
  await assert.rejects(stage, /ENOENT/);
  assert.ok(!(await readdir(source)).includes("public-release"));
  await writeFile(file(diskImage), diskImage);
  await stage();
  assert.deepEqual(
    (await readdir(out)).sort(),
    names.filter((name) => name !== "SHA256SUMS.txt").sort(),
  );
  await writeFile(path.join(out, "SHA256SUMS.txt"), "checksum fixture");
  const notes = releaseNotes(project, version, changelog);
  const assets = await Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(path.join(out, name));
      return {
        name,
        state: "uploaded",
        size: bytes.length,
        digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
        browser_download_url: base + name,
      };
    }),
  );
  const draft = {
    draft: true,
    prerelease: true,
    tag_name: "v1.0.4",
    body: notes,
    assets,
    html_url:
      "https://github.com/Swiph3l/synology-chatplus-desktop/releases/tag/untagged-abcd",
  };
  const verify = (data) => verifyDraft(project, version, data, out, notes);
  await verify(draft);
  const tempAssets = assets.map((a) => ({
    ...a,
    browser_download_url: a.browser_download_url.replace(
      "/v1.0.4/",
      "/untagged-abcd/",
    ),
  }));
  await verify({ ...draft, assets: tempAssets });
  for (const key of ["digest", "browser_download_url", "state", "size"]) {
    const changed = structuredClone(draft);
    changed.assets[0][key] = "incorrect";
    await assert.rejects(verify(changed));
  }
  await assert.rejects(verify({ ...draft, assets: assets.slice(1) }));
  await assert.rejects(verify({ ...draft, tag_name: "v1.0.3" }));
  await assert.rejects(verify({ ...draft, draft: false }));
  await assert.rejects(
    verify({ ...draft, body: notes.replace("v1.0.4", "v1.0.3") }),
  );
});
