import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDependencyAlignment,
  readDependencySources,
} from "../scripts/check-dependencies.mjs";

function fixture() {
  return {
    packageJson: { dependencies: { "@tauri-apps/api": "2.12.3" } },
    packageLock: {
      packages: {
        "": { dependencies: { "@tauri-apps/api": "2.12.3" } },
        "node_modules/@tauri-apps/api": { version: "2.12.3" },
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

test("the checked-in application keeps Tauri API/native and WebView interfaces aligned", () => {
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
