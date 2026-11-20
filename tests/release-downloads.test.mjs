import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAsset, summary } from "../scripts/release-downloads.mjs";

test("download counts distinguish installers, standalone apps, update archives and build files", () => {
  const cases = [
    [
      "windows-x86_64--ChatPlus.Desktop_0.5.0-beta.1_x64-setup.exe",
      "Windows setup",
    ],
    ["windows-x86_64--app.exe", "Windows standalone"],
    ["darwin-x86_64--app.dmg", "macOS Intel"],
    ["darwin-aarch64--app.dmg", "macOS Apple Silicon"],
    ["darwin-aarch64--app.app.tar.gz", "macOS update"],
    ["linux-x86_64--app.AppImage", "Linux AppImage"],
    ["ChatPlus-Desktop-1.0.6-x86_64.AppImage", "Linux AppImage"],
    ["linux-x86_64--app.deb", "Linux DEB"],
    ["linux-x86_64--app.AppImage.sig", "Signature"],
    ["latest.json", "Updater metadata"],
    ["latest-prerelease.json", "Updater metadata"],
    ["SHA256SUMS.txt", "Checksums"],
    ["darwin-aarch64--rust.cdx.json", "Build evidence"],
    ["linux-x86_64--target.json", "Build evidence"],
    ["source.zip", "Other"],
  ];
  for (const [name, expected] of cases)
    assert.equal(classifyAsset(name), expected);
  const totals = summary(
    cases.map(([name]) => ({ kind: classifyAsset(name), count: 2 })),
  );
  assert.equal(totals.installers, 12);
  assert.equal(totals.other, 18);
  assert.equal(totals.downloads["Build evidence"], 4);
});
