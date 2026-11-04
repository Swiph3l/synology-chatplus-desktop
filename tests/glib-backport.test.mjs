import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifyBackport,
  verifyMetadata,
} from "../scripts/check-glib-backport.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const vendorPath = "vendor/glib-0.18.5";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "chatplus-glib-proof-"));
  t.after(async () => {
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), path.resolve(tmpdir()));
    assert.ok(path.basename(absolute).startsWith("chatplus-glib-proof-"));
    await rm(absolute, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "security"));
  await copyFile(
    path.join(repoRoot, "security/glib-backport.json"),
    path.join(root, "security/glib-backport.json"),
  );
  await cp(path.join(repoRoot, vendorPath), path.join(root, vendorPath), {
    recursive: true,
  });
  return root;
}

test("the published glib inventory contains only the approved upstream backport", async () => {
  const verified = await verifyBackport();
  assert.equal(verified.root, path.resolve(repoRoot));
  assert.equal(verified.vendorDirectory, path.join(repoRoot, vendorPath));
  assert.equal(verified.manifest.advisory, "RUSTSEC-2024-0429");
});

test("restoring the vulnerable pointer or changing its MIT license fails proof", async (t) => {
  for (const entry of ["src/variant_iter.rs", "LICENSE"]) {
    await t.test(entry, async (t) => {
      const root = await fixture(t);
      const filename = path.join(root, vendorPath, entry);
      const original = await readFile(filename, "utf8");
      await writeFile(
        filename,
        entry === "LICENSE"
          ? `${original}\nUnexpected license edit.\n`
          : original.replace("let mut p:", "let p:").replace("&mut p,", "&p,"),
      );
      await assert.rejects(verifyBackport({ root }), /approved bytes/);
    });
  }
});

test("missing published files and extra cache files fail proof", async (t) => {
  await t.test("missing copyright", async (t) => {
    const root = await fixture(t);
    await unlink(path.join(root, vendorPath, "COPYRIGHT"));
    await assert.rejects(verifyBackport({ root }), /missing or extra/);
  });
  await t.test("unexpected cache marker", async (t) => {
    const root = await fixture(t);
    await writeFile(path.join(root, vendorPath, ".cargo-ok"), "{}");
    await assert.rejects(verifyBackport({ root }), /missing or extra/);
  });
  await t.test("unexpected empty directory", async (t) => {
    const root = await fixture(t);
    await mkdir(path.join(root, vendorPath, "extra-directory"));
    await assert.rejects(verifyBackport({ root }), /extra published directory/);
  });
});

test("symbolic directories cannot substitute for published vendor content", async (t) => {
  const root = await fixture(t);
  const outside = path.join(root, "unreviewed");
  await mkdir(outside);
  await symlink(
    outside,
    path.join(root, vendorPath, "linked-content"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(verifyBackport({ root }), /symbolic links/);
});

test("editing source and its manifest together cannot approve another archive", async (t) => {
  const root = await fixture(t);
  const filename = path.join(root, vendorPath, "README.md");
  const changed = `${await readFile(filename, "utf8")}\nUnapproved change.\n`;
  await writeFile(filename, changed);
  const manifestPath = path.join(root, "security/glib-backport.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.pristineFiles["README.md"] = createHash("sha256")
    .update(changed)
    .digest("hex");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifyBackport({ root }), /inventory/);
});

test("the backport cannot cite a different source checksum or upstream commit", async (t) => {
  const root = await fixture(t);
  const manifestPath = path.join(root, "security/glib-backport.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const change of [
    (value) => (value.package.archiveSha256 = "0".repeat(64)),
    (value) => (value.upstreamFix.commit = "0".repeat(40)),
  ]) {
    const changed = structuredClone(manifest);
    change(changed);
    await writeFile(manifestPath, JSON.stringify(changed));
    await assert.rejects(verifyBackport({ root }), /provenance/);
  }
});

test("Linux metadata must select the verified path exactly once", () => {
  const id = "path+file:///reviewed/glib#0.18.5";
  const metadata = {
    packages: [
      {
        name: "glib",
        version: "0.18.5",
        source: null,
        manifest_path: path.join(repoRoot, vendorPath, "Cargo.toml"),
        id,
      },
    ],
    resolve: { nodes: [{ id, dependencies: [] }] },
  };
  assert.equal(verifyMetadata(metadata), metadata.packages[0]);
  for (const change of [
    (value) => (value.packages[0].version = "0.18.4"),
    (value) =>
      (value.packages[0].source =
        "registry+https://github.com/rust-lang/crates.io-index"),
    (value) =>
      (value.packages[0].manifest_path = path.join(
        repoRoot,
        "other/Cargo.toml",
      )),
    (value) =>
      value.packages.push({ ...value.packages[0], version: "0.22.10" }),
    (value) => (value.resolve.nodes = []),
  ]) {
    const changed = structuredClone(metadata);
    change(changed);
    assert.throws(() => verifyMetadata(changed), /locked Linux graph/);
  }
});
