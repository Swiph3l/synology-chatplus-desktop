import { readdir, readFile, writeFile } from "node:fs/promises";
import { generate, manifestName } from "./updater-metadata.mjs";
import {
  repositoryIdentity,
  validateSourceCommit,
} from "./release-identity.mjs";
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
    targets[manifest.target] = manifest.file;
  }
const project = JSON.parse(await readFile("project.json", "utf8"));
if (!targets["windows-x86_64"] && !targets["windows-x86_64-nsis"])
  throw new Error("A signed Windows x64 updater installer is required");
const metadata = await generate(
  root,
  version,
  await readFile("CHANGELOG.md", "utf8"),
  targets,
  project,
);
await writeFile(
  `${root}/${manifestName(version)}`,
  JSON.stringify(metadata, null, 2) + "\n",
);
