import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const file = process.argv[2] ?? "src-tauri/target/release/chatplus-desktop.exe";
const binary = await readFile(file);
// Run on the unpacked executable: a compressed installer requires extraction.
const roots = [
  process.cwd(),
  homedir(),
  process.env.CARGO_HOME,
  process.env.RUSTUP_HOME,
].filter(Boolean);
for (const root of roots) {
  for (const text of new Set([
    root,
    root.split(path.sep).join("/"),
    root.replaceAll("/", "\\"),
  ])) {
    for (const encoding of ["utf8", "utf16le"]) {
      if (binary.includes(Buffer.from(text, encoding)))
        throw new Error("Build-machine path embedded in executable");
    }
  }
}
for (const marker of [
  "DEVELOPMENT ONLY",
  "fixture-message",
  "Local shell test",
]) {
  if (binary.includes(Buffer.from(marker)))
    throw new Error("Development fixture embedded in executable");
}
console.log(
  "Executable contains no tested build roots or fixture markers. This is not a general secret scanner.",
);
