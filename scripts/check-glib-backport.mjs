import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
const vendorPath = "vendor/glib-0.18.5";
const archiveSha256 =
  "233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5";
const fixCommit = "05dff0ee696f9bcd8617cd48c4b812d046d440cb";
const pristineMapSha256 =
  "d59db0cd23975279aa057124dd43c47d26ba742df34e9dbfba0e72099d71e217";
const pristineVariantSha256 =
  "1fd02859333761c45321b32f28b24233446b97d0022a90d3a937ed162585b90e";
const patchedVariantSha256 =
  "a0f5ee8acb8faa089bcdfbc9a57372609fce7654026ccef7d9a224d05a654ccc";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyManifest(manifest) {
  requireValue(
    manifest.schemaVersion === 1 &&
      manifest.advisory === "RUSTSEC-2024-0429" &&
      manifest.vendorDirectory === vendorPath &&
      manifest.package?.name === "glib" &&
      manifest.package?.version === "0.18.5" &&
      manifest.package?.registrySource ===
        "registry+https://github.com/rust-lang/crates.io-index" &&
      manifest.package?.archiveUrl ===
        "https://static.crates.io/crates/glib/glib-0.18.5.crate" &&
      manifest.package?.archiveSha256 === archiveSha256 &&
      manifest.upstreamFix?.repository ===
        "https://github.com/gtk-rs/gtk-rs-core" &&
      manifest.upstreamFix?.commit === fixCommit &&
      manifest.upstreamFix?.path === "glib/src/variant_iter.rs",
    "The glib backport must retain its pinned official archive and upstream fix provenance.",
  );
  requireValue(
    record(manifest.pristineFiles) && record(manifest.patchedFiles),
    "The glib backport needs pristine and patched file hash maps.",
  );
  const entries = Object.entries(manifest.pristineFiles).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  // Swiph3l: Pin the complete authenticated archive inventory, not only values
  // supplied by an editable manifest. Updating source and its manifest together
  // cannot silently approve a different upstream tree or additional patches.
  requireValue(
    entries.length === 121 &&
      sha256(JSON.stringify(Object.fromEntries(entries))) ===
        pristineMapSha256 &&
      manifest.pristineFiles["src/variant_iter.rs"] === pristineVariantSha256 &&
      Object.keys(manifest.patchedFiles).length === 1 &&
      manifest.patchedFiles["src/variant_iter.rs"] === patchedVariantSha256,
    "The glib backport file inventory or approved patch hash changed.",
  );
}

async function ordinaryDirectory(directory) {
  const status = await lstat(directory);
  requireValue(
    status.isDirectory() && !status.isSymbolicLink(),
    `The glib backport must not use a symbolic directory: ${directory}`,
  );
}

async function inventory(directory, allowedDirectories, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(directory, relative), {
    withFileTypes: true,
  })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const status = await lstat(path.join(directory, name));
    requireValue(
      !status.isSymbolicLink(),
      `The glib backport must not contain symbolic links: ${name}`,
    );
    if (status.isDirectory()) {
      requireValue(
        allowedDirectories.has(name),
        `The glib backport has an extra published directory: ${name}`,
      );
      files.push(...(await inventory(directory, allowedDirectories, name)));
    } else {
      requireValue(status.isFile(), `Unsupported glib backport entry: ${name}`);
      files.push(name);
    }
  }
  return files;
}

export function verifyMetadata(
  metadata,
  { root = repoRoot, vendorDirectory = path.join(root, vendorPath) } = {},
) {
  requireValue(
    path.resolve(vendorDirectory) === path.resolve(root, vendorPath),
    "The expected glib directory must remain inside the repository vendor path.",
  );
  const packages = metadata?.packages;
  requireValue(
    Array.isArray(packages),
    "Cargo package metadata is unavailable.",
  );
  const glib = packages.filter((entry) => entry.name === "glib");
  requireValue(
    glib.length === 1 &&
      glib[0].version === "0.18.5" &&
      glib[0].source === null &&
      typeof glib[0].manifest_path === "string" &&
      path.isAbsolute(glib[0].manifest_path) &&
      path.resolve(glib[0].manifest_path) ===
        path.resolve(vendorDirectory, "Cargo.toml") &&
      typeof glib[0].id === "string" &&
      Array.isArray(metadata.resolve?.nodes) &&
      metadata.resolve.nodes.some((node) => node.id === glib[0].id),
    "The locked Linux graph must resolve exactly one glib 0.18.5 from the verified vendor directory.",
  );
  return glib[0];
}

export async function verifyBackport({
  root = repoRoot,
  metadata = false,
} = {}) {
  requireValue(typeof metadata === "boolean", "metadata must be a boolean.");
  root = path.resolve(root);
  await ordinaryDirectory(path.join(root, "security"));
  const manifestPath = path.join(root, "security/glib-backport.json");
  const manifestStatus = await lstat(manifestPath);
  requireValue(
    manifestStatus.isFile() && !manifestStatus.isSymbolicLink(),
    "The glib provenance manifest must be an ordinary file.",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  verifyManifest(manifest);
  await ordinaryDirectory(path.join(root, "vendor"));
  const vendorDirectory = path.join(root, vendorPath);
  await ordinaryDirectory(vendorDirectory);
  const expectedFiles = Object.keys(manifest.pristineFiles).sort();
  const allowedDirectories = new Set();
  for (const name of expectedFiles) {
    const segments = name.split("/");
    for (let index = 1; index < segments.length; index++)
      allowedDirectories.add(segments.slice(0, index).join("/"));
  }
  const files = (await inventory(vendorDirectory, allowedDirectories)).sort();
  requireValue(
    files.length === expectedFiles.length &&
      files.every((name, index) => name === expectedFiles[index]),
    "The glib backport has missing or extra published files.",
  );
  await Promise.all(
    files.map(async (name) => {
      const expected =
        manifest.patchedFiles[name] ?? manifest.pristineFiles[name];
      requireValue(
        sha256(await readFile(path.join(vendorDirectory, name))) === expected,
        `The glib backport file does not match its approved bytes: ${name}`,
      );
    }),
  );
  const variant = await readFile(
    path.join(vendorDirectory, "src/variant_iter.rs"),
    "utf8",
  );
  const declaration =
    "            let mut p: *mut libc::c_char = std::ptr::null_mut();";
  const argument = "                &mut p,";
  requireValue(
    variant.split(declaration).length === 2 &&
      variant.split(argument).length === 2 &&
      sha256(
        variant
          .replace(declaration, declaration.replace("let mut p", "let p"))
          .replace(argument, "                &p,"),
      ) === pristineVariantSha256,
    "The glib source must differ from the published crate by exactly the upstream two-line fix.",
  );
  if (metadata) {
    const { stdout } = await execute(
      "cargo",
      [
        "metadata",
        "--locked",
        "--filter-platform",
        "x86_64-unknown-linux-gnu",
        "--format-version",
        "1",
        "--manifest-path",
        path.join(root, "src-tauri/Cargo.toml"),
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 30e6, timeout: 300_000 },
    );
    verifyMetadata(JSON.parse(stdout), { root, vendorDirectory });
  }
  return { manifest, root, vendorDirectory };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    requireValue(
      args.length === 0 || (args.length === 1 && args[0] === "--metadata"),
      "Usage: node scripts/check-glib-backport.mjs [--metadata]",
    );
    await verifyBackport({ metadata: args.includes("--metadata") });
    console.log(
      "Verified the 121-file glib 0.18.5 archive and exact upstream backport" +
        (args.includes("--metadata")
          ? ", including locked Linux resolution."
          : "."),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
