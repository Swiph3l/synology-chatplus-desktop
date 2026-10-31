import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const releaseTargets = {
  "windows-x86_64": {
    rustTarget: "x86_64-pc-windows-msvc",
    ciName: "validate (windows-latest, dev)",
    updaterExtension: ".exe",
    architecture: "x64",
  },
  "linux-x86_64": {
    rustTarget: "x86_64-unknown-linux-gnu",
    ciName: "validate (ubuntu-24.04, dev)",
    updaterExtension: ".AppImage",
    architecture: "amd64",
    installerExtension: ".deb",
  },
  "darwin-aarch64": {
    rustTarget: "aarch64-apple-darwin",
    ciName: "validate (macos-15, dev)",
    updaterExtension: ".app.tar.gz",
    architecture: "aarch64",
    installerExtension: ".dmg",
  },
  "darwin-x86_64": {
    rustTarget: "x86_64-apple-darwin",
    ciName: "validate (macos-15-intel, dev)",
    updaterExtension: ".app.tar.gz",
    architecture: "x64",
    installerExtension: ".dmg",
  },
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const target = releaseTargets[process.argv[2]];
  assert.ok(target, "Unsupported release target");
  const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  assert.ok(
    host.split(/\r?\n/).includes(`host: ${target.rustTarget}`),
    `Native ${target.rustTarget} toolchain required`,
  );
}
