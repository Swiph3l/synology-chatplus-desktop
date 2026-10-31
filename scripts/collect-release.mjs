import {
  readdir,
  mkdir,
  copyFile,
  writeFile,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import {
  repositoryIdentity,
  validateSourceCommit,
} from "./release-identity.mjs";
import { releaseTargets } from "./release-targets.mjs";
const target = process.argv[2];
if (!Object.hasOwn(releaseTargets, target))
  throw new Error("Unsupported release target");
const config = releaseTargets[target];
const rustTarget = process.argv[3];
if (rustTarget && rustTarget !== config.rustTarget)
  throw new Error("Rust build target disagrees with release target");
const buildRoot = path.join("src-tauri/target", rustTarget ?? "", "release");
const candidates = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) candidates.push(file);
  }
}
await walk(path.join(buildRoot, "bundle"));
function unique(extension) {
  const matches = candidates.filter((file) => file.endsWith(extension));
  if (matches.length !== 1)
    throw new Error(
      `Expected exactly one ${extension} package for this target`,
    );
  return matches[0];
}
const updater = unique(config.updaterExtension);
if (!(await readFile(updater)).length)
  throw new Error("Updater package must be nonempty");
if (!(await readFile(updater + ".sig", "utf8")).trim())
  throw new Error("Updater signature must be nonempty");
await mkdir("release-artifacts", { recursive: true });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
let sourceCommit;
if (process.env.GITHUB_REF_TYPE === "tag") {
  const source = validateSourceCommit(
    process.env.GITHUB_REF_NAME,
    process.env.GITHUB_SHA,
  );
  const identity = repositoryIdentity(source.tag);
  if (identity.version !== version)
    throw new Error("Collected artifact version disagrees with release source");
  sourceCommit = source.commit;
}
const prefix = `${target}--ChatPlus-Desktop_${version}_${config.architecture}`;
const file = `${prefix}${target === "windows-x86_64" ? "-setup" : ""}${config.updaterExtension}`;
if (target === "windows-x86_64") {
  // Swiph3l: Ship the actual application separately; the updater must still install the signed NSIS package.
  const application = path.join(buildRoot, "chatplus-desktop.exe");
  const bytes = await readFile(application);
  if (!bytes.length || bytes.equals(await readFile(updater)))
    throw new Error(
      "Standalone application must be nonempty and distinct from the installer",
    );
  // Swiph3l: GitHub rewrites spaces in asset names, so published names must already be URL-safe.
  await copyFile(application, path.join("release-artifacts", `${prefix}.exe`));
}
if (config.installerExtension) {
  const installer = unique(config.installerExtension);
  if (!(await readFile(installer)).length)
    throw new Error("Installer package must be nonempty");
  await copyFile(
    installer,
    path.join("release-artifacts", `${prefix}${config.installerExtension}`),
  );
}
await copyFile(updater, path.join("release-artifacts", file));
await copyFile(updater + ".sig", path.join("release-artifacts", file + ".sig"));
await writeFile(
  path.join("release-artifacts", `${target}--target.json`),
  JSON.stringify({ target, file, version, sourceCommit }) + "\n",
);
