import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDependencyAlignment,
  readDependencySources,
} from "../scripts/check-dependencies.mjs";

function fixture() {
  return {
    packageJson: {
      engines: { node: "^22.12.0 || ^24.0.0" },
      dependencies: { "@tauri-apps/api": "2.12.3" },
      devDependencies: { "@types/node": "^22.20.5" },
    },
    packageLock: {
      packages: {
        "": {
          dependencies: { "@tauri-apps/api": "2.12.3" },
          devDependencies: { "@types/node": "^22.20.5" },
        },
        "node_modules/@tauri-apps/api": { version: "2.12.3" },
        "node_modules/@types/node": { version: "22.20.5" },
      },
    },
    cargoToml: `[dependencies]\ntauri = { version = "~2.12.5" }\nwindows = { version = "0.62" }\nwebview2-com = { version = "0.39" }\n[dev-dependencies]\ntauri = { version = "~2.12.5", features = ["test"] }`,
    cargoLock: `version = 4
[[package]]
name = "tauri"
version = "2.12.5"
dependencies = [
 "windows 0.62.2",
 "webview2-com",
]
[[package]]
name = "wry"
version = "0.57.0"
dependencies = [
 "windows 0.62.2",
 "webview2-com",
]
[[package]]
name = "webview2-com"
version = "0.39.1"
[[package]]
name = "windows"
version = "0.62.2"
[[package]]
name = "windows"
version = "0.61.3"
[[package]]
name = "tauri-winrt-notification"
version = "0.8.1"
dependencies = [
 "windows 0.61.3",
]
`,
  };
}

test("the checked-in application aligns Node typings, Tauri and WebView interfaces", () => {
  checkDependencyAlignment(readDependencySources(process.cwd()));
});

test("a coherent update permits independent Windows dependencies behind a separate API", () => {
  checkDependencyAlignment(fixture());
});

test("an API-only minor bump and a stale native lockfile fail before packaging", () => {
  const sources = fixture();
  sources.cargoToml = sources.cargoToml.replaceAll("~2.12.5", "~2.11.6");
  assert.throws(() => checkDependencyAlignment(sources), /same minor/);
  sources.cargoToml = fixture().cargoToml;
  sources.cargoLock = sources.cargoLock.replace(
    'name = "tauri"\nversion = "2.12.5"',
    'name = "tauri"\nversion = "2.11.6"',
  );
  assert.throws(() => checkDependencyAlignment(sources), /locked native/);
});

test("a Windows or WebView2-only interface bump cannot pass the alignment gate", () => {
  const sources = fixture();
  sources.cargoToml = sources.cargoToml.replace(
    'windows = { version = "0.62" }',
    'windows = { version = "0.61" }',
  );
  assert.throws(() => checkDependencyAlignment(sources), /interface version/);
  sources.cargoToml = fixture().cargoToml;
  sources.cargoLock = sources.cargoLock.replace(
    'name = "webview2-com"\nversion = "0.39.1"',
    'name = "webview2-com"\nversion = "0.38.2"',
  );
  assert.throws(() => checkDependencyAlignment(sources), /direct webview2-com/);
});

test("npm declaration and resolved lock must both describe the tested API", () => {
  const sources = fixture();
  sources.packageLock.packages[""].dependencies["@tauri-apps/api"] = "2.11.1";
  assert.throws(() => checkDependencyAlignment(sources), /npm lockfile/);
});

test("Node typings follow the oldest runtime regardless of engine-range ordering", () => {
  const sources = fixture();
  sources.packageJson.engines.node = "^24.0.0 || ^22.12.0";
  checkDependencyAlignment(sources);
  sources.packageJson.engines.node = "^24.0.0";
  sources.packageJson.devDependencies["@types/node"] = "~24.1.0";
  sources.packageLock.packages[""].devDependencies["@types/node"] = "~24.1.0";
  sources.packageLock.packages["node_modules/@types/node"].version = "24.1.2";
  checkDependencyAlignment(sources);
});

test("a coherent Node 26 typing update fails while Node 22 remains supported", () => {
  const sources = fixture();
  sources.packageJson.devDependencies["@types/node"] = "^26.6.5";
  sources.packageLock.packages[""].devDependencies["@types/node"] = "^26.6.5";
  sources.packageLock.packages["node_modules/@types/node"].version = "26.6.5";
  assert.throws(
    () => checkDependencyAlignment(sources),
    /@types\/node major at 22/,
  );
});

test("stale or absent Node typing declarations and lock records fail independently", () => {
  for (const change of [
    (sources) => {
      sources.packageLock.packages["node_modules/@types/node"].version =
        "26.6.5";
    },
    (sources) => {
      sources.packageJson.devDependencies["@types/node"] = "^26.6.5";
    },
    (sources) => {
      sources.packageLock.packages[""].devDependencies["@types/node"] =
        "~22.20.5";
    },
    (sources) => {
      delete sources.packageJson.devDependencies["@types/node"];
    },
    (sources) => {
      delete sources.packageLock.packages["node_modules/@types/node"];
    },
  ]) {
    const sources = fixture();
    change(sources);
    assert.throws(
      () => checkDependencyAlignment(sources),
      /@types\/node major at 22/,
    );
  }
});

test("unsupported or absent engine syntax requires an explicit runtime-policy review", () => {
  for (const node of [undefined, ">=22", "^22.12.0 || >=24", "22.x", ""]) {
    const sources = fixture();
    sources.packageJson.engines.node = node;
    assert.throws(
      () => checkDependencyAlignment(sources),
      /explicit caret ranges/,
    );
  }
});
