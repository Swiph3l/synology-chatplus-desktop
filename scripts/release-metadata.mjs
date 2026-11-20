import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { changesForVersion } from "./release-changelog.mjs";
import { generate, manifestName } from "./updater-metadata.mjs";
import {
  repositoryIdentity,
  validateSourceCommit,
} from "./release-identity.mjs";
import { packageNames, releaseTargets } from "./release-targets.mjs";
const root = "release-artifacts";
const targets = {};
const source = validateSourceCommit(
  process.env.GITHUB_REF_NAME,
  process.env.GITHUB_SHA,
);
const { version } = repositoryIdentity(source.tag);
for (const file of await readdir(root))
  if (file.endsWith("--target.json")) {
    const manifest = JSON.parse(await readFile(`${root}/${file}`, "utf8"));
    if (manifest.version !== version || manifest.sourceCommit !== source.commit)
      throw new Error(
        "Artifact provenance must match the release version and exact source commit",
      );
    if (targets[manifest.target]) throw new Error("Duplicate release target");
    if (!Object.hasOwn(releaseTargets, manifest.target))
      throw new Error("Unsupported release target");
    const { appImage, updater } = packageNames(manifest.target, version);
    if (manifest.file !== (appImage ?? updater))
      throw new Error("Unexpected signed package name in build provenance");
    targets[manifest.target] = updater;
  }
const project = JSON.parse(await readFile("project.json", "utf8"));
for (const target of Object.keys(releaseTargets))
  if (!targets[target])
    throw new Error(`A signed ${target} updater package is required`);
// Installed Linux clients require the historical asset and sidecar names.
// Make both from the exact bytes that passed the signed AppImage startup matrix.
const { appImage, updater } = packageNames("linux-x86_64", version);
for (const suffix of ["", ".sig"])
  await copyFile(`${root}/${appImage}${suffix}`, `${root}/${updater}${suffix}`);
const metadata = await generate(
  root,
  version,
  changesForVersion(await readFile("CHANGELOG.md", "utf8"), version),
  targets,
  project,
);
await writeFile(
  `${root}/${manifestName(version)}`,
  JSON.stringify(metadata, null, 2) + "\n",
);
