import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { validateSourceCommit } from "./release-identity.mjs";

const pending = (check) =>
  ["queued", "in_progress", "requested", "waiting", "pending"].includes(
    check.status,
  );

export function requireWindowsJob(jobs) {
  const windows = jobs.filter((job) =>
    job.name.startsWith("validate (windows-latest,"),
  );
  assert.equal(windows.length, 1, "Expected one Windows CI job");
  assert.equal(windows[0].conclusion, "success", "Windows CI must pass");
}
export async function waitForChecks(
  api,
  commit,
  {
    timeoutMs = 60 * 60 * 1000,
    pollIntervalMs = 30000,
    now = Date.now,
    sleep = setTimeout,
    log = console.log,
  } = {},
) {
  assert.ok(
    Number.isFinite(timeoutMs) && timeoutMs > 0,
    "Invalid check timeout",
  );
  assert.ok(
    Number.isFinite(pollIntervalMs) && pollIntervalMs > 0,
    "Invalid check polling interval",
  );
  const deadline = now() + timeoutMs;
  let waiting = [];
  const remainingTime = () => {
    const remaining = deadline - now();
    assert.ok(
      remaining > 0,
      `Timed out waiting for release checks on ${commit}: ${waiting.join("; ")}`,
    );
    return remaining;
  };
  for (;;) {
    remainingTime();
    waiting = [];
    const verified = [];
    // Re-select every gate each round so a newer run cannot hide behind an earlier success.
    for (const workflow of ["ci.yml", "codeql.yml", "security.yml"]) {
      remainingTime();
      const data = await api(
        `/actions/workflows/${workflow}/runs?head_sha=${commit}&event=push&branch=main&per_page=100`,
      );
      const run = data.workflow_runs
        .filter(
          (r) =>
            r.head_sha === commit &&
            r.head_branch === "main" &&
            r.event === "push",
        )
        .sort((a, b) => b.run_number - a.run_number)[0];
      if (!run) {
        waiting.push(`${workflow}: missing run on main for the tagged commit`);
        continue;
      }
      let check = run;
      let jobs;
      const label = workflow === "ci.yml" ? "Windows CI" : workflow;
      if (workflow === "ci.yml") {
        remainingTime();
        jobs = (
          await api(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)
        ).jobs;
        const windows = jobs.filter((job) =>
          job.name.startsWith("validate (windows-latest,"),
        );
        if (!windows.length && pending(run)) {
          waiting.push(
            `${workflow}: waiting for the Windows job (${run.status})`,
          );
          continue;
        }
        assert.equal(windows.length, 1, "Expected one Windows CI job");
        check = windows[0];
      }
      if (pending(check)) {
        assert.notEqual(
          run.status,
          "completed",
          `${label} cannot be pending in a completed workflow`,
        );
        waiting.push(`${label}: ${check.status} (${run.html_url})`);
        continue;
      }
      assert.equal(check.status, "completed", `${label} must complete`);
      if (jobs) requireWindowsJob(jobs);
      else
        assert.equal(
          check.conclusion,
          "success",
          `${workflow} must pass for the tagged commit`,
        );
      verified.push(`Verified ${workflow}: ${run.html_url}`);
    }
    if (!waiting.length) {
      remainingTime();
      for (const message of verified) log(message);
      return;
    }
    log(`Waiting for release checks on ${commit}: ${waiting.join("; ")}`);
    await sleep(Math.min(pollIntervalMs, remainingTime()));
  }
}
export async function verifyChecks() {
  const {
    GITHUB_REPOSITORY: repo,
    GITHUB_SHA: sha,
    GH_TOKEN: token,
  } = process.env;
  assert.ok(repo && sha && token, "Missing GitHub release gate context");
  const source = validateSourceCommit(process.env.GITHUB_REF_NAME, sha);
  async function api(path) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}${path}`,
      {
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    assert.ok(
      response.ok,
      `GitHub checks query failed: HTTP ${response.status}`,
    );
    return response.json();
  }
  await waitForChecks(api, source.commit);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await verifyChecks();
