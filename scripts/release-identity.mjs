import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { validVersion, manifestName } from "./updater-metadata.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateIdentity(tag, versions) {
  const version = versions[0];
  assert.ok(validVersion(version), "Invalid application SemVer");
  assert.ok(
    versions.every((v) => v === version),
    "Application versions disagree",
  );
  assert.equal(
    tag,
    `v${version}`,
    "Tag must match application version exactly; tag the commit containing the prepared version",
  );
  return {
    version,
    prerelease: manifestName(version) === "latest-prerelease.json",
  };
}
export function validateSigning(project, key) {
  assert.equal(
    project.updaterEnabled,
    true,
    "Enable the production updater first",
  );
  const decoded = Buffer.from(project.updaterPublicKey, "base64").toString(
    "utf8",
  );
  const lines = decoded.trim().split(/\r?\n/);
  assert.ok(
    lines[0]?.startsWith("untrusted comment:"),
    "Missing Tauri production public key",
  );
  assert.equal(
    Buffer.from(lines[1] ?? "", "base64").length,
    42,
    "Invalid Tauri public key",
  );
  assert.ok(key?.trim(), "Missing TAURI_SIGNING_PRIVATE_KEY secret");
}
export function repositoryIdentity(
  tag,
  { repositoryRoot: root = repositoryRoot } = {},
) {
  const read = (file) => readFileSync(resolve(root, file), "utf8");
  const json = (file) => JSON.parse(read(file));
  const cargo = read("src-tauri/Cargo.toml");
  const lock = read("src-tauri/Cargo.lock");
  const npmLock = json("package-lock.json");
  return validateIdentity(tag, [
    json("package.json").version,
    npmLock.version,
    npmLock.packages[""].version,
    json("src-tauri/tauri.conf.json").version,
    /\[package\][\s\S]*?\nversion = "([^"]+)"/.exec(cargo)?.[1],
    /name = "chatplus-desktop"\r?\nversion = "([^"]+)"/.exec(lock)?.[1],
  ]);
}
export function validateSourceCommit(
  tag,
  eventSha,
  { repositoryRoot: root = repositoryRoot } = {},
) {
  assert.match(
    eventSha ?? "",
    /^[a-f0-9]{40}$/i,
    "Missing exact workflow source commit",
  );
  assert.ok(
    /^v/.test(tag ?? "") && validVersion(tag.slice(1)),
    "Invalid release tag",
  );
  const git = (revision) =>
    execFileSync("git", ["rev-parse", "--verify", revision], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  const commit = git(`${eventSha}^{commit}`);
  assert.equal(
    git("HEAD"),
    commit,
    "Release checkout must match the workflow event commit exactly",
  );
  assert.equal(
    git(`refs/tags/${tag}^{commit}`),
    commit,
    "Release tag must identify the workflow source commit; do not build a moved tag from a different commit",
  );
  return { tag, commit };
}
export async function validateRemoteTag(repository, source, token) {
  assert.ok(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""),
    "Invalid release repository",
  );
  assert.ok(token?.trim(), "Missing GitHub token for remote tag verification");
  const api = async (resource) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/git/${resource}`,
      {
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    assert.ok(
      response.ok,
      `Remote tag verification failed: HTTP ${response.status}`,
    );
    return response.json();
  };
  let object = (await api(`ref/tags/${encodeURIComponent(source.tag)}`)).object;
  for (let depth = 0; object?.type === "tag" && depth < 8; depth++) {
    assert.match(object.sha, /^[a-f0-9]{40}$/i, "Invalid annotated tag object");
    object = (await api(`tags/${object.sha}`)).object;
  }
  assert.equal(object?.type, "commit", "Release tag must resolve to a commit");
  assert.equal(
    object.sha,
    source.commit,
    "The remote release tag moved away from the verified source commit",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(
    process.env.GITHUB_REF_TYPE,
    "tag",
    "Release requires a tag event",
  );
  const source = validateSourceCommit(
    process.env.GITHUB_REF_NAME,
    process.env.GITHUB_SHA,
  );
  const identity = repositoryIdentity(source.tag);
  if (process.argv.includes("--verify-remote-tag")) {
    await validateRemoteTag(
      process.env.GITHUB_REPOSITORY,
      source,
      process.env.GH_TOKEN,
    );
  } else {
    validateSigning(
      JSON.parse(readFileSync(resolve(repositoryRoot, "project.json"), "utf8")),
      process.env.TAURI_SIGNING_PRIVATE_KEY,
    );
  }
  console.log(
    `Validated ${identity.version}; prerelease=${identity.prerelease}; source=${source.commit}`,
  );
}
