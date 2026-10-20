import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requireWindowsJob } from "../scripts/release-checks.mjs";

const workflowNames = ["ci", "codeql", "security", "release"];
const workflows = Object.fromEntries(
  await Promise.all(
    workflowNames.map(async (name) => [
      name,
      await readFile(`.github/workflows/${name}.yml`, "utf8"),
    ]),
  ),
);
// Swiph3l: Workflow steps share this indentation in the repository. Inspect complete
// steps so a guard on a different action cannot satisfy a security assertion.
const steps = (source) => source.split(/(?=^ {6}- )/m).slice(1);
const uses = (step) => /^\s+(?:- )?uses:\s+([^\s#]+)/m.exec(step)?.[1];
const actionSteps = (source, action) =>
  steps(source).filter((step) => uses(step)?.startsWith(`${action}@`));

test("workflow actions remain immutable and checkout never persists credentials or enables unsafe fork checkout", () => {
  for (const [name, source] of Object.entries(workflows)) {
    const actions = steps(source).map(uses).filter(Boolean);
    assert.ok(actions.length > 0, name);
    for (const action of actions)
      assert.match(
        action,
        /^[\w-]+\/[\w./-]+@[a-f0-9]{40}$/,
        `${name}: ${action}`,
      );
    for (const step of actionSteps(source, "actions/checkout")) {
      assert.match(step, /^\s+persist-credentials: false\s*$/m, name);
      assert.doesNotMatch(
        step,
        /^\s+allow-unsafe-pr-checkout: true\s*$/m,
        name,
      );
    }
    assert.doesNotMatch(
      source,
      /^\s*(?:pull_request_target|workflow_run):/m,
      name,
    );
  }
});

test("CodeQL init and analyze use the same release to avoid incompatible saved configuration", () => {
  const codeql = steps(workflows.codeql)
    .map(uses)
    .filter((action) => action?.startsWith("github/codeql-action/"));
  assert.ok(
    codeql.some((action) => action.startsWith("github/codeql-action/init@")),
  );
  assert.ok(
    codeql.some((action) => action.startsWith("github/codeql-action/analyze@")),
  );
  assert.equal(new Set(codeql.map((action) => action.split("@")[1])).size, 1);
});

test("frontend Node 24 coverage preserves the single Windows release gate without duplicating native builds", () => {
  const jobs = [...workflows.ci.matchAll(/^    name:\s+(.+)$/gm)].map(
    ([, name]) => ({
      name,
      conclusion: "success",
    }),
  );
  requireWindowsJob(jobs);
  const frontend = workflows.ci.split(/^  frontend-node24:\s*$/m)[1];
  assert.ok(frontend);
  assert.match(frontend, /^    runs-on: ubuntu-latest\s*$/m);
  assert.match(frontend, /^\s+node-version: 24\s*$/m);
  for (const command of [
    "npm ci",
    "npm run typecheck",
    "npm test",
    "npm run build",
    "npm run check:release",
  ])
    assert.ok(frontend.includes(`- run: ${command}`), command);
  assert.doesNotMatch(frontend, /cargo\s|tauri\s+build|SIGNING_PRIVATE_KEY/);
  assert.match(
    workflows.ci.split(/^  frontend-node24:\s*$/m)[0],
    /^\s+node-version: 22\s*$/m,
  );
});

test("signed release artifacts keep exact source, integrity checks and isolated cache boundaries", () => {
  const source = workflows.release;
  assert.match(source, /^\s+tags: \["v\*"\]\s*$/m);
  assert.doesNotMatch(source, /^\s+(?:pull_request|workflow_dispatch):/m);
  for (const step of actionSteps(source, "actions/checkout")) {
    assert.match(step, /^\s+ref: \$\{\{ github\.sha \}\}\s*$/m);
    assert.match(step, /^\s+fetch-depth: 0\s*$/m);
  }
  for (const step of actionSteps(source, "actions/setup-node")) {
    assert.match(step, /^\s+package-manager-cache: false\s*$/m);
    assert.doesNotMatch(step, /^\s+cache:/m);
  }
  const [upload] = actionSteps(source, "actions/upload-artifact");
  const [download] = actionSteps(source, "actions/download-artifact");
  assert.ok(upload && download);
  const uploadName = /^\s+name: (.+)$/m.exec(upload)?.[1];
  assert.equal(/^\s+name: (.+)$/m.exec(download)?.[1], uploadName);
  assert.match(upload, /^\s+if-no-files-found: error\s*$/m);
  assert.match(upload, /^\s+archive: true\s*$/m);
  assert.match(upload, /^\s+overwrite: false\s*$/m);
  assert.match(upload, /^\s+include-hidden-files: false\s*$/m);
  assert.match(download, /^\s+digest-mismatch: error\s*$/m);
  assert.doesNotMatch(download, /^\s+(?:github-token|repository|run-id):/m);
  for (const guard of [
    "node scripts/release-identity.mjs",
    "node scripts/release-checks.mjs",
    "updates::updater_tests::production_artifact_signature_verifies",
    "node scripts/release-metadata.mjs",
    "node scripts/release-identity.mjs --verify-remote-tag",
    "'--draft'",
  ])
    assert.ok(source.includes(guard), guard);
  assert.ok(
    source.indexOf("production_artifact_signature_verifies") <
      source.indexOf(uses(upload)),
  );
  assert.ok(
    source.indexOf(uses(download)) <
      source.indexOf("node scripts/release-metadata.mjs"),
  );
});
