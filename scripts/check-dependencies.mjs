import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const minor = (value) => {
  const match = /^[~^=]?(\d+)\.(\d+)(?:\.\d+)?(?:$|[-+])/.exec(value ?? "");
  if (!match)
    throw new Error(`Expected an explicit dependency version: ${value}`);
  return `${match[1]}.${match[2]}`;
};

// Swiph3l: Only the named inline dependency declarations and [[package]] records used by
// this repository are inspected; Cargo remains the manifest/lockfile validator.
function declared(cargoToml, name) {
  return [
    ...cargoToml.matchAll(
      new RegExp(
        `^${name}\\s*=\\s*(?:"([^"]+)"|\\{[^}]*?version\\s*=\\s*"([^"]+)")`,
        "gm",
      ),
    ),
  ].map((match) => match[1] ?? match[2]);
}

function lockedPackages(cargoLock) {
  return cargoLock
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)
    .map((record) => ({
      name: /^name = "([^"]+)"/m.exec(record)?.[1],
      version: /^version = "([^"]+)"/m.exec(record)?.[1],
      dependencies: [
        ...(
          /^dependencies = \[([\s\S]*?)^\]/m.exec(record)?.[1] ?? ""
        ).matchAll(/^\s*"([^"]+)"/gm),
      ].map((match) => match[1]),
    }));
}

export function checkDependencyAlignment({
  packageJson,
  packageLock,
  cargoToml,
  cargoLock,
}) {
  // Swiph3l: Tauri patch versions may differ across ecosystems, but an API/native
  // minor migration must be reviewed together before either build can proceed.
  const apiSpec = packageJson.dependencies?.["@tauri-apps/api"];
  const apiVersion =
    packageLock.packages?.["node_modules/@tauri-apps/api"]?.version;
  if (
    packageLock.packages?.[""]?.dependencies?.["@tauri-apps/api"] !== apiSpec ||
    minor(apiVersion) !== minor(apiSpec)
  ) {
    throw new Error("The Tauri API manifest and npm lockfile must agree.");
  }
  const nativeSpecs = declared(cargoToml, "tauri");
  if (
    nativeSpecs.length !== 2 ||
    nativeSpecs.some((spec) => minor(spec) !== minor(apiVersion))
  ) {
    throw new Error(
      "Update the Tauri JavaScript API and both native Tauri declarations to the same minor version together.",
    );
  }
  const packages = lockedPackages(cargoLock);
  const native = packages.filter((entry) => entry.name === "tauri");
  if (native.length !== 1 || minor(native[0].version) !== minor(apiVersion)) {
    throw new Error(
      "The locked native Tauri version must match the JavaScript API minor version.",
    );
  }
  for (const name of ["windows", "webview2-com"]) {
    const specs = declared(cargoToml, name);
    if (specs.length !== 1)
      throw new Error(`Expected one direct ${name} declaration.`);
    const directMinor = minor(specs[0]);
    const direct = packages.filter(
      (entry) => entry.name === name && minor(entry.version) === directMinor,
    );
    if (direct.length !== 1)
      throw new Error(
        `The direct ${name} declaration must match its lockfile.`,
      );
    // Swiph3l: COM values cross these boundaries. A separate Windows version used behind
    // an independent Toast API is intentionally not part of this interface graph.
    for (const runtime of packages.filter((entry) =>
      ["tauri", "tauri-runtime-wry", "wry", "webview2-com"].includes(
        entry.name,
      ),
    )) {
      for (const dependency of runtime.dependencies) {
        const [dependencyName, version] = dependency.split(" ");
        if (dependencyName !== name) continue;
        const candidates = packages.filter(
          (entry) =>
            entry.name === name && (!version || entry.version === version),
        );
        if (
          candidates.length !== 1 ||
          minor(candidates[0].version) !== directMinor
        ) {
          throw new Error(
            `Update ${name} with the Tauri/WebView runtime: ${runtime.name} uses a different interface version.`,
          );
        }
      }
    }
  }
}

export function readDependencySources(root) {
  const read = (name) => readFileSync(path.join(root, name), "utf8");
  return {
    packageJson: JSON.parse(read("package.json")),
    packageLock: JSON.parse(read("package-lock.json")),
    cargoToml: read("src-tauri/Cargo.toml"),
    cargoLock: read("src-tauri/Cargo.lock"),
  };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  checkDependencyAlignment(
    readDependencySources(fileURLToPath(new URL("../", import.meta.url))),
  );
  console.log(
    "Tauri API/native minor versions and WebView COM interfaces are aligned.",
  );
}
