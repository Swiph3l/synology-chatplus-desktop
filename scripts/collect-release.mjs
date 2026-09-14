import {
  readdir,
  mkdir,
  copyFile,
  writeFile,
  readFile,
} from "node:fs/promises";
import path from "node:path";
const target = process.argv[2];
const extensions = {
  "windows-x86_64": ".exe",
  "linux-x86_64": ".AppImage",
  "darwin-aarch64": ".app.tar.gz",
};
if (!(target in extensions)) throw new Error("Unsupported release target");
const candidates = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name.endsWith(extensions[target])) candidates.push(file);
  }
}
await walk("src-tauri/target/release/bundle");
if (candidates.length !== 1)
  throw new Error(
    "Expected exactly one signed updater package for this target",
  );
await mkdir("release-artifacts", { recursive: true });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const file =
  target === "windows-x86_64"
    ? `${target}--ChatPlus Desktop_${version}_x64-setup.exe`
    : `${target}--${path.basename(candidates[0])}`;
await copyFile(candidates[0], path.join("release-artifacts", file));
await copyFile(
  candidates[0] + ".sig",
  path.join("release-artifacts", file + ".sig"),
);
await writeFile(
  path.join("release-artifacts", `${target}--target.json`),
  JSON.stringify({ target, file }) + "\n",
);
