import assert from "node:assert/strict";

export function changesForVersion(changelog, version) {
  const section = changelog
    .replaceAll("\r\n", "\n")
    .split(/^## /m)
    .slice(1)
    .find((text) => text.split(/\s/, 1)[0] === version);
  assert.ok(section, `Missing changelog entry for ${version}`);
  const changes = section.split("\n").slice(1).join("\n").trim();
  assert.ok(changes, "Release notes must describe this version");
  return changes;
}
