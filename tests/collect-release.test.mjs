import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { releaseTargets } from "../scripts/release-targets.mjs";
import {
  repositoryIdentity,
  validateSourceCommit,
} from "../scripts/release-identity.mjs";

const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
const version = "0.5.0-beta.6";
const tag = `v${version}`;
const application = Buffer.from("Non-executable application fixture");
const installer = Buffer.from("Non-executable installer fixture");
const signature = "copy-only sidecar fixture";
const prefix = `windows-x86_64--ChatPlus-Desktop_${version}_x64`;

async function writeVersions(root, value) {
  const json = (file, data) =>
    writeFile(path.join(root, file), JSON.stringify(data) + "\n");
  await json("package.json", { version: value });
  await json("package-lock.json", {
    version: value,
    packages: { "": { version: value } },
  });
  await json("src-tauri/tauri.conf.json", { version: value });
  await writeFile(
    path.join(root, "src-tauri/Cargo.toml"),
    `[package]\nname = "chatplus-desktop"\nversion = "${value}"\n`,
  );
  await writeFile(
    path.join(root, "src-tauri/Cargo.lock"),
    `[[package]]\nname = "chatplus-desktop"\nversion = "${value}"\n`,
  );
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "chatplus-collect-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  const externalRoot = path.join(root, "artifacts");
  await mkdir(path.join(repositoryRoot, "scripts"), { recursive: true });
  await mkdir(path.join(repositoryRoot, "src-tauri"));
  for (const file of [
    "collect-release.mjs",
    "release-identity.mjs",
    "updater-metadata.mjs",
    "release-targets.mjs",
    "release-metadata.mjs",
    "checksums.mjs",
  ]) {
    await copyFile(
      path.join(scripts, file),
      path.join(repositoryRoot, "scripts", file),
    );
  }
  await writeVersions(repositoryRoot, version);
  const git = (...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=Release Fixture",
        "-c",
        "user.email=release-fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet", "-b", "release-fixture");
  git("add", ".");
  git("commit", "--quiet", "-m", "Prepared release fixture");
  const commit = git("rev-parse", "HEAD");
  git("tag", tag);
  const collect = (
    cwd,
    environment = {},
    target = "windows-x86_64",
    rustTarget,
  ) =>
    spawnSync(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts/collect-release.mjs"),
        target,
        ...(rustTarget ? [rustTarget] : []),
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REF_TYPE: "tag",
          GITHUB_REF_NAME: tag,
          GITHUB_SHA: commit,
          ...environment,
        },
      },
    );
  return { repositoryRoot, externalRoot, commit, git, collect };
}

async function writeArtifacts(root) {
  await mkdir(path.join(root, "src-tauri/target/release/bundle/nsis"), {
    recursive: true,
  });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
  await writeFile(
    path.join(root, "src-tauri/target/release/chatplus-desktop.exe"),
    application,
  );
  await writeFile(
    path.join(root, "src-tauri/target/release/bundle/nsis/setup.exe"),
    installer,
  );
  await writeFile(
    path.join(root, "src-tauri/target/release/bundle/nsis/setup.exe.sig"),
    signature,
  );
}

function rejected(result, message) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, message);
}

for (const cwd of ["repositoryRoot", "externalRoot"]) {
  test(`Windows collection preserves application bytes, installer update target and checksums from ${cwd}`, async (t) => {
    const repo = await fixture(t);
    const root = repo[cwd];
    await writeArtifacts(root);
    const result = repo.collect(root);
    assert.equal(result.status, 0, result.stderr);
    const output = path.join(root, "release-artifacts");
    assert.deepEqual(
      await readFile(path.join(output, `${prefix}.exe`)),
      application,
    );
    assert.deepEqual(
      await readFile(path.join(output, `${prefix}-setup.exe`)),
      installer,
    );
    assert.equal(
      await readFile(path.join(output, `${prefix}-setup.exe.sig`), "utf8"),
      signature,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(output, "windows-x86_64--target.json"),
          "utf8",
        ),
      ),
      {
        target: "windows-x86_64",
        file: `${prefix}-setup.exe`,
        version,
        sourceCommit: repo.commit,
      },
    );
    const hashes = spawnSync(
      process.execPath,
      [path.join(scripts, "checksums.mjs"), output],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(hashes.status, 0, hashes.stderr);
    const sums = await readFile(path.join(output, "SHA256SUMS.txt"), "utf8");
    for (const [name, bytes] of [
      [`${prefix}.exe`, application],
      [`${prefix}-setup.exe`, installer],
    ]) {
      assert.ok(
        sums.includes(
          `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`,
        ),
      );
    }
    const executable = path.join(
      root,
      "src-tauri/target/release/chatplus-desktop.exe",
    );
    await writeFile(executable, installer);
    rejected(
      repo.collect(root),
      /Standalone application must be nonempty and distinct/,
    );
    await rm(executable);
    rejected(repo.collect(root), /ENOENT/);
  });
}

test("Source validation accepts only the exact fixture commit, checkout and tag", async (t) => {
  const repo = await fixture(t);
  const options = { repositoryRoot: repo.repositoryRoot };
  await writeArtifacts(repo.externalRoot);
  assert.deepEqual(validateSourceCommit(tag, repo.commit, options), {
    tag,
    commit: repo.commit,
  });
  assert.deepEqual(repositoryIdentity(tag, options), {
    version,
    prerelease: true,
  });
  assert.throws(
    () => validateSourceCommit(tag, "not-a-commit", options),
    /Missing exact workflow source commit/,
  );
  for (const commit of [
    "0".repeat(40),
    repo.git("rev-parse", "HEAD:package.json"),
  ]) {
    assert.throws(() => validateSourceCommit(tag, commit, options));
    rejected(
      repo.collect(repo.externalRoot, { GITHUB_SHA: commit }),
      /Command failed: git/,
    );
  }
  repo.git(
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "Different source commit",
  );
  const head = repo.git("rev-parse", "HEAD");
  assert.throws(
    () => validateSourceCommit(tag, repo.commit, options),
    /Release checkout must match the workflow event commit exactly/,
  );
  rejected(repo.collect(repo.externalRoot), /Release checkout must match/);
  assert.throws(
    () => validateSourceCommit(tag, head, options),
    /Release tag must identify the workflow source commit/,
  );
  rejected(
    repo.collect(repo.externalRoot, { GITHUB_SHA: head }),
    /Release tag must identify/,
  );
});

test("Collection enforces tag, synchronized application versions and artifact identity", async (t) => {
  const repo = await fixture(t);
  await writeArtifacts(repo.externalRoot);
  await writeFile(
    path.join(repo.repositoryRoot, "src-tauri/tauri.conf.json"),
    JSON.stringify({ version: "0.5.0-beta.5" }),
  );
  rejected(repo.collect(repo.externalRoot), /Application versions disagree/);
  await writeVersions(repo.repositoryRoot, "0.5.0-beta.5");
  rejected(
    repo.collect(repo.externalRoot),
    /Tag must match application version exactly/,
  );
  await writeVersions(repo.repositoryRoot, version);
  await writeFile(
    path.join(repo.externalRoot, "package.json"),
    JSON.stringify({ version: "0.5.0-beta.5" }),
  );
  rejected(
    repo.collect(repo.externalRoot),
    /Collected artifact version disagrees with release source/,
  );
});

for (const [target, config] of Object.entries(releaseTargets).filter(
  ([target]) => target !== "windows-x86_64",
)) {
  test(`${target} collection keeps installer and signed updater distinct with URL-safe names`, async (t) => {
    const repo = await fixture(t);
    const root = repo.repositoryRoot;
    const bundle = path.join(
      root,
      "src-tauri/target",
      config.rustTarget,
      "release/bundle",
    );
    await mkdir(bundle, { recursive: true });
    const artifact = path.join(
      bundle,
      `ChatPlus Desktop${config.updaterExtension}`,
    );
    const setup = path.join(
      bundle,
      `ChatPlus Desktop${config.installerExtension}`,
    );
    await writeFile(artifact, application);
    await writeFile(artifact + ".sig", signature);
    await writeFile(setup, installer);
    const collect = () => repo.collect(root, {}, target, config.rustTarget);
    const result = collect();
    assert.equal(result.status, 0, result.stderr);
    const prefix = `${target}--ChatPlus-Desktop_${version}_${config.architecture}`;
    const output = path.join(root, "release-artifacts");
    assert.deepEqual(
      await readFile(path.join(output, prefix + config.updaterExtension)),
      application,
    );
    assert.deepEqual(
      await readFile(path.join(output, prefix + config.installerExtension)),
      installer,
    );
    const provenance = JSON.parse(
      await readFile(path.join(output, `${target}--target.json`), "utf8"),
    );
    assert.equal(provenance.file, prefix + config.updaterExtension);
    assert.equal(provenance.sourceCommit, repo.commit);
    await writeFile(artifact + ".sig", "");
    rejected(collect(), /Updater signature must be nonempty/);
    await writeFile(artifact + ".sig", signature);
    await writeFile(
      path.join(bundle, `duplicate${config.updaterExtension}`),
      application,
    );
    rejected(collect(), /Expected exactly one/);
    rejected(
      repo.collect(root, {}, target, "unrelated-target"),
      /Rust build target disagrees/,
    );
  });
}

test("Release metadata requires all four signed targets from the exact source commit", async (t) => {
  const repo = await fixture(t);
  const root = repo.repositoryRoot;
  const output = path.join(root, "release-artifacts");
  await mkdir(output);
  await writeFile(
    path.join(root, "project.json"),
    JSON.stringify({
      owner: "Swiph3l",
      repository: "synology-chatplus-desktop",
    }),
  );
  await writeFile(path.join(root, "CHANGELOG.md"), "Fixture release notes");
  const encodedSignature = Buffer.from(
    "untrusted comment: fixture\nfixture\ntrusted comment: fixture\nfixture",
  ).toString("base64");
  const manifests = [];
  for (const [target, config] of Object.entries(releaseTargets)) {
    const file = `${target}--fixture${config.updaterExtension}`;
    await writeFile(path.join(output, file), application);
    await writeFile(path.join(output, file + ".sig"), encodedSignature);
    const manifest = path.join(output, `${target}--target.json`);
    const bytes = JSON.stringify({
      target,
      file,
      version,
      sourceCommit: repo.commit,
    });
    manifests.push({ manifest, bytes });
    await writeFile(manifest, bytes);
  }
  const generate = () =>
    spawnSync(process.execPath, ["scripts/release-metadata.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF_NAME: tag,
        GITHUB_SHA: repo.commit,
      },
    });
  let result = generate();
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(
    await readFile(path.join(output, "latest-prerelease.json"), "utf8"),
  );
  assert.deepEqual(
    Object.keys(metadata.platforms).sort(),
    Object.keys(releaseTargets).sort(),
  );
  for (const { manifest, bytes } of manifests) {
    await rm(manifest);
    rejected(generate(), /updater package is required/);
    await writeFile(manifest, bytes);
  }
  const { manifest, bytes } = manifests[0];
  await writeFile(manifest, bytes.replace(repo.commit, "0".repeat(40)));
  rejected(generate(), /Artifact provenance must match/);
});
