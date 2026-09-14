import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { configureBuild } from "./tauri-build-config.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const env = { ...process.env };
if (args[0] === "build") {
  const project = JSON.parse(readFileSync("project.json", "utf8"));
  const release = configureBuild(args, env, project);
  console.log(
    release
      ? "Release build: signed updater artifacts required."
      : "Normal build: no updater artifacts or signatures; runtime updater configuration preserved.",
  );
}
if (
  args[0] === "build" &&
  !args.includes("--locked") &&
  !args.includes("--frozen")
) {
  if (!args.includes("--")) args.push("--");
  args.push("--locked");
}
if (args[0] === "build" && !args.includes("--debug")) {
  // Preserve caller flags. Encoded flags avoid shell quoting of paths with spaces.
  const flags = env.CARGO_ENCODED_RUSTFLAGS
    ? env.CARGO_ENCODED_RUSTFLAGS.split("\x1f")
    : (env.RUSTFLAGS ?? "").split(/\s+/).filter(Boolean);
  const mappings = [
    [homedir(), "/user"],
    [env.CARGO_HOME ?? path.join(homedir(), ".cargo"), "/cargo"],
    [env.RUSTUP_HOME ?? path.join(homedir(), ".rustup"), "/rustup"],
    [process.cwd(), "/chatplus"],
  ];
  for (const [source, destination] of mappings) {
    for (const variant of new Set([source, source.replaceAll("\\", "/")])) {
      flags.push(`--remap-path-prefix=${variant}=${destination}`);
    }
  }
  if (process.platform === "win32")
    flags.push("-C", "link-arg=/PDBALTPATH:chatplus-desktop.pdb");
  env.CARGO_ENCODED_RUSTFLAGS = flags.join("\x1f");
}
const result = spawnSync(
  process.execPath,
  [require.resolve("@tauri-apps/cli/tauri.js"), ...args],
  { env, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
