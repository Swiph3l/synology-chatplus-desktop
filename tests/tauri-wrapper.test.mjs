import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Exercise the real wrapper up to the CLI boundary, without signing or installing.
test("wrapper separates runtime updater configuration from release signing", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "chatplus-wrapper-"));
  const project = JSON.parse(await readFile("project.json", "utf8"));
  const original = structuredClone(project);
  try {
    await mkdir(path.join(dir, "scripts"));
    for (const name of [
      "tauri",
      "tauri-build-config",
      "release-identity",
      "updater-metadata",
    ])
      await copyFile(
        `scripts/${name}.mjs`,
        path.join(dir, `scripts/${name}.mjs`),
      );
    const cli = path.join(dir, "node_modules/@tauri-apps/cli");
    await mkdir(cli, { recursive: true });
    await writeFile(
      path.join(cli, "tauri.js"),
      `
      console.log('CAPTURE:' + JSON.stringify({
        args: process.argv.slice(2),
        key: process.env.TAURI_SIGNING_PRIVATE_KEY,
        password: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
      }));
    `,
    );
    const run = async (env, args = [], config = project) => {
      await writeFile(path.join(dir, "project.json"), JSON.stringify(config));
      return spawnSync(
        process.execPath,
        ["scripts/tauri.mjs", "build", "--debug", ...args],
        {
          cwd: dir,
          encoding: "utf8",
          // Do not inherit any real signing credentials.
          env: { SystemRoot: process.env.SystemRoot, ...env },
        },
      );
    };
    const capture = (result) => {
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.split("CAPTURE:")[1].trim());
    };
    const artifacts = (result) => {
      const i = result.args.lastIndexOf("--config");
      assert.ok(i >= 0);
      assert.ok(i < result.args.indexOf("--"));
      assert.ok(result.args.includes("--locked"));
      const config = JSON.parse(result.args[i + 1]);
      assert.equal(config.plugins.updater.pubkey, project.updaterPublicKey);
      const decoded = Buffer.from(
        config.plugins.updater.pubkey,
        "base64",
      ).toString("utf8");
      assert.match(
        decoded,
        /^untrusted comment: minisign public key: [0-9A-F]+\r?\n[A-Za-z0-9+/]{56}\r?\n?$/,
      );
      assert.equal(
        Buffer.from(decoded, "utf8").toString("base64"),
        project.updaterPublicKey,
      );
      return config.bundle.createUpdaterArtifacts;
    };
    await t.test(
      "normal CI without key passes on every package target and preserves runtime",
      async () => {
        for (const bundle of ["nsis", "deb", "app"]) {
          const result = capture(await run({}, ["--bundles", bundle]));
          assert.equal(artifacts(result), false);
          assert.equal(result.key, undefined);
          assert.equal(result.password, undefined);
        }
        assert.deepEqual(
          JSON.parse(await readFile(path.join(dir, "project.json"), "utf8")),
          original,
        );
        assert.equal(project.updaterEnabled, true);
      },
    );
    await t.test(
      "normal mode strips incidental credentials and overrides artifact opt-in",
      async () => {
        const result = capture(
          await run(
            {
              TAURI_SIGNING_PRIVATE_KEY: "fixture-only",
              TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "fixture-password",
            },
            [
              "--config",
              '{"bundle":{"createUpdaterArtifacts":true}}',
              "--",
              "--locked",
            ],
          ),
        );
        assert.equal(artifacts(result), false);
        assert.equal(result.key, undefined);
        assert.equal(result.password, undefined);
      },
    );
    await t.test("release without key fails before launching CLI", async () => {
      for (const key of [undefined, "", "   "]) {
        const result = await run({
          CHATPLUS_RELEASE_BUILD: "1",
          ...(key === undefined ? {} : { TAURI_SIGNING_PRIVATE_KEY: key }),
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Missing TAURI_SIGNING_PRIVATE_KEY/);
        assert.ok(!result.stdout.includes("CAPTURE:"));
      }
    });
    await t.test(
      "release with fixture key passes credentials and forces artifacts",
      async () => {
        const result = capture(
          await run(
            {
              CHATPLUS_RELEASE_BUILD: "1",
              TAURI_SIGNING_PRIVATE_KEY: "fixture-only-not-a-real-key",
              TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "fixture-password",
            },
            ["--config", '{"bundle":{"createUpdaterArtifacts":false}}'],
          ),
        );
        assert.equal(artifacts(result), true);
        assert.equal(result.key, "fixture-only-not-a-real-key");
        assert.equal(result.password, "fixture-password");
      },
    );
    await t.test(
      "enabled runtime requires a public key even in normal mode",
      async () => {
        const result = await run({}, [], { ...project, updaterPublicKey: " " });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /public verification key/);
      },
    );
    await t.test(
      "release rejects disabled runtime and malformed public key",
      async () => {
        for (const config of [
          { ...project, updaterEnabled: false },
          { ...project, updaterPublicKey: "invalid" },
        ]) {
          const result = await run(
            {
              CHATPLUS_RELEASE_BUILD: "1",
              TAURI_SIGNING_PRIVATE_KEY: "fixture-only",
            },
            [],
            config,
          );
          assert.notEqual(result.status, 0);
          assert.ok(!result.stdout.includes("CAPTURE:"));
        }
      },
    );
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith("chatplus-wrapper-"));
    await rm(dir, { recursive: true, force: true });
  }
});
