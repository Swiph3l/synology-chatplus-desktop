import { readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
export function validVersion(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    version,
  );
}
export async function generate(
  root,
  version,
  notes,
  targets,
  project,
  date = new Date().toISOString(),
) {
  if (!validVersion(version))
    throw new Error("A valid SemVer version is required");
  if (
    !/^[A-Za-z0-9_-]+$/.test(project.owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(project.repository)
  )
    throw new Error("Invalid configured repository");
  root = await realpath(root);
  const platforms = {};
  for (const [target, file] of Object.entries(targets)) {
    if (
      !/^(windows|linux|darwin)-(x86_64|aarch64)(?:-(nsis|msi|appimage))?$/.test(
        target,
      )
    )
      throw new Error("Unsupported updater target");
    const artifact = await realpath(path.resolve(root, file));
    if (path.dirname(artifact) !== root || path.basename(file) !== file)
      throw new Error(
        "Artifacts must be final files directly inside the release directory",
      );
    if (!(await readFile(artifact)).length) throw new Error("Empty artifact");
    const sigPath = await realpath(artifact + ".sig");
    if (path.dirname(sigPath) !== root)
      throw new Error("Signature escapes release directory");
    const signature = (await readFile(sigPath, "utf8")).trim();
    const decoded = Buffer.from(signature, "base64").toString("utf8");
    if (
      !decoded.startsWith("untrusted comment:") ||
      !decoded.includes("trusted comment:")
    )
      throw new Error("Expected an actual Tauri-generated .sig file");
    platforms[target] = {
      signature,
      url: `https://github.com/${project.owner}/${project.repository}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(file)}`,
    };
  }
  if (!Object.keys(platforms).length)
    throw new Error("No signed target artifacts");
  return { version, notes, pub_date: date, platforms };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [root, version, notesFile, ...specs] = process.argv.slice(2);
  if (!root || !version || !notesFile)
    throw new Error(
      "Usage: updater-metadata <artifact directory> <version> <notes file> <target=filename>...",
    );
  const targets = Object.fromEntries(
    specs.map((spec) => {
      const index = spec.indexOf("=");
      if (index < 1) throw new Error("Expected target=filename");
      return [spec.slice(0, index), spec.slice(index + 1)];
    }),
  );
  const project = JSON.parse(await readFile("project.json", "utf8"));
  const metadata = await generate(
    root,
    version,
    await readFile(notesFile, "utf8"),
    targets,
    project,
  );
  await writeFile(
    path.join(root, "latest.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  console.log(
    `Generated metadata for ${Object.keys(targets).length} signed targets.`,
  );
}
