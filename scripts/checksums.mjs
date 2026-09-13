import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";

// Run only after packaging/signing has finished. Relative names support all OS
// package formats, sidecars and SBOMs without maintaining an extension allowlist.
const root = path.resolve(process.argv[2] ?? "release-artifacts");
const names = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink())
      throw new Error("Release files must not be symlinks");
    if (stat.isDirectory()) await walk(full);
    else if (stat.isFile()) {
      const name = path.relative(root, full).split(path.sep).join("/");
      if (name === "SHA256SUMS.txt") continue;
      if (/[\r\n\\]/.test(name)) throw new Error("Unsafe checksum filename");
      if (!stat.size) throw new Error(`Empty release file: ${name}`);
      names.push(name);
    }
  }
}
await walk(root);
if (!names.length) throw new Error("No final artifacts found");
const lines = [];
for (const name of names.sort()) {
  const hash = createHash("sha256")
    .update(await readFile(path.join(root, name)))
    .digest("hex");
  lines.push(`${hash}  ${name}`);
}
await writeFile(path.join(root, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log(`Hashed ${names.length} final files.`);
