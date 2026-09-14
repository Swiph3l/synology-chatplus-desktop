import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validVersion, manifestName } from "./updater-metadata.mjs";

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
    "Tag must match application version exactly",
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
export function repositoryIdentity(tag) {
  const json = (file) => JSON.parse(readFileSync(file, "utf8"));
  const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
  const lock = readFileSync("src-tauri/Cargo.lock", "utf8");
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
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(
    process.env.GITHUB_REF_TYPE,
    "tag",
    "Release requires a tag event",
  );
  const identity = repositoryIdentity(process.env.GITHUB_REF_NAME);
  validateSigning(
    JSON.parse(readFileSync("project.json", "utf8")),
    process.env.TAURI_SIGNING_PRIVATE_KEY,
  );
  console.log(
    `Validated ${identity.version}; prerelease=${identity.prerelease}`,
  );
}
