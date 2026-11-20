import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { changesForVersion } from "./release-changelog.mjs";
import { packageNames, releaseTargets } from "./release-targets.mjs";
import { manifestName } from "./updater-metadata.mjs";

function assetUrl(project, version, name) {
  return `https://github.com/${project.owner}/${project.repository}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(name)}`;
}

export function publicNames(version) {
  const names = [manifestName(version), "SHA256SUMS.txt"];
  for (const target of Object.keys(releaseTargets)) {
    const { installer, updater, standalone, appImage } = packageNames(
      target,
      version,
    );
    names.push(updater, updater + ".sig");
    if (appImage) names.push(appImage, appImage + ".sig");
    if (installer) names.push(installer);
    if (standalone) names.push(standalone);
  }
  return names;
}

export function releaseNotes(project, version, changelog) {
  const changes = changesForVersion(changelog, version);
  const link = (label, name) =>
    `[${label}](${assetUrl(project, version, name)})`;
  const windows = packageNames("windows-x86_64", version);
  const linux = packageNames("linux-x86_64", version);
  return [
    "## Download Chat+",
    "",
    `- **Windows (64-bit)** — ${link("Download Windows Setup", windows.updater)}. Run the installer.`,
    `- **macOS 14 or later** — ${link("Download for Apple Silicon", packageNames("darwin-aarch64", version).installer)} or ${link("download for Intel", packageNames("darwin-x86_64", version).installer)}. About This Mac shows your chip.`,
    `- **Linux (64-bit)** — ${link("Download DEB", linux.installer)} for Debian/Ubuntu, or ${link("download AppImage", linux.appImage)} for a compatible distribution. Make the AppImage executable before opening it.`,
    "",
    "Windows x64 is the established platform. macOS and Linux are candidate platforms. If Chat+ is already installed, use Settings → Updates to check for the signed update.",
    "",
    "## Changes",
    "",
    changes,
    "",
  ].join("\n");
}

export async function stageRelease(project, version, source, out) {
  const manifest = manifestName(version);
  const metadata = JSON.parse(
    await readFile(path.join(source, manifest), "utf8"),
  );
  assert.equal(metadata.version, version, "Unexpected updater version");
  assert.deepEqual(
    Object.keys(metadata.platforms).sort(),
    Object.keys(releaseTargets).sort(),
  );
  for (const target of Object.keys(releaseTargets)) {
    const { updater, appImage } = packageNames(target, version);
    const { url, signature } = metadata.platforms[target];
    assert.equal(
      url,
      assetUrl(project, version, updater),
      `Unexpected updater URL for ${target}`,
    );
    const sidecar = (
      await readFile(path.join(source, updater + ".sig"), "utf8")
    ).trim();
    assert.ok(
      sidecar && signature === sidecar,
      `Signature mismatch for ${target}`,
    );
    if (appImage) {
      for (const suffix of ["", ".sig"]) {
        const canonical = await readFile(path.join(source, appImage + suffix));
        const legacy = await readFile(path.join(source, updater + suffix));
        assert.ok(
          canonical.equals(legacy),
          "Linux updater alias differs from signed AppImage",
        );
      }
    }
  }
  // Swiph3l: Only copy the named distribution files into a fresh directory. Keep build
  // provenance available to the manifest check without accidentally publishing it.
  const temporary = await mkdtemp(out + "-");
  try {
    for (const name of publicNames(version).filter(
      (name) => name !== "SHA256SUMS.txt",
    )) {
      await copyFile(path.join(source, name), path.join(temporary, name));
    }
    await rename(temporary, out);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyDraft(project, version, release, folder, notes) {
  assert.ok(release.draft && release.prerelease, "Expected a prerelease draft");
  assert.equal(release.tag_name, `v${version}`);
  assert.equal(
    release.body.replaceAll("\r\n", "\n").trim(),
    notes.trim(),
    "Draft download notes changed",
  );
  const names = publicNames(version);
  assert.deepEqual(
    release.assets.map((asset) => asset.name).sort(),
    names.sort(),
    "Draft file list is incomplete or unexpected",
  );
  const draftSlug = new URL(release.html_url).pathname.split("/").pop();
  for (const asset of release.assets) {
    assert.equal(asset.state, "uploaded", `Incomplete upload: ${asset.name}`);
    const canonical = assetUrl(project, version, asset.name);
    // Swiph3l: GitHub may give private drafts a temporary untagged URL. Verify its
    // exact repo/draft path and file as well as the canonical post-publication path.
    const draftUrl = /^untagged-[a-f0-9]+$/.test(draftSlug)
      ? canonical.replace(
          `/download/v${encodeURIComponent(version)}/`,
          `/download/${draftSlug}/`,
        )
      : canonical;
    assert.ok(
      [canonical, draftUrl].includes(asset.browser_download_url),
      `Wrong download URL for ${asset.name}`,
    );
    const bytes = await readFile(path.join(folder, asset.name));
    assert.ok(
      bytes.length > 0 && bytes.length === asset.size,
      `Size mismatch for ${asset.name}`,
    );
    assert.equal(
      asset.digest,
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      `Upload digest mismatch for ${asset.name}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const project = JSON.parse(await readFile("project.json", "utf8"));
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const notes = releaseNotes(
    project,
    version,
    await readFile("CHANGELOG.md", "utf8"),
  );
  if (process.argv[2] === "--verify-draft") {
    const release = JSON.parse(await readFile(process.argv[3], "utf8"));
    await verifyDraft(project, version, release, "public-release", notes);
    console.log(
      `Verified download URLs, notes, sizes and SHA-256 for ${release.assets.length} draft files.`,
    );
  } else {
    await stageRelease(project, version, "release-artifacts", "public-release");
    await writeFile("release-notes.md", notes);
  }
}
