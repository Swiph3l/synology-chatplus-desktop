import { readdir, readFile, writeFile } from "node:fs/promises";
import { generate } from "./updater-metadata.mjs";
const root = "release-artifacts";
const targets = {};
for (const file of await readdir(root))
  if (file.endsWith("--target.json")) {
    const manifest = JSON.parse(await readFile(`${root}/${file}`, "utf8"));
    if (targets[manifest.target]) throw new Error("Duplicate release target");
    targets[manifest.target] = manifest.file;
  }
const project = JSON.parse(await readFile("project.json", "utf8"));
const version = process.env.GITHUB_REF_NAME?.replace(/^v/, "");
const metadata = await generate(
  root,
  version,
  await readFile("CHANGELOG.md", "utf8"),
  targets,
  project,
);
await writeFile(
  `${root}/latest.json`,
  JSON.stringify(metadata, null, 2) + "\n",
);
