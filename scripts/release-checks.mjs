import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export function requireWindowsJob(jobs) {
  const windows = jobs.filter((job) =>
    job.name.startsWith("validate (windows-latest,"),
  );
  assert.equal(windows.length, 1, "Expected one Windows CI job");
  assert.equal(windows[0].conclusion, "success", "Windows CI must pass");
}
export async function verifyChecks() {
  const {
    GITHUB_REPOSITORY: repo,
    GITHUB_SHA: sha,
    GH_TOKEN: token,
  } = process.env;
  assert.ok(repo && sha && token, "Missing GitHub release gate context");
  async function api(path) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}${path}`,
      {
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
  for (const workflow of ["ci.yml", "codeql.yml", "security.yml"]) {
    const data = await api(
      `/actions/workflows/${workflow}/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
    );
    const run = data.workflow_runs
      .filter((r) => r.head_sha === sha && r.head_branch === "main")
      .sort((a, b) => b.run_number - a.run_number)[0];
    assert.ok(run, `Missing ${workflow} run on main for the tagged commit`);
    if (workflow === "ci.yml") {
      requireWindowsJob(
        (await api(`/actions/runs/${run.id}/jobs?per_page=100`)).jobs,
      );
    } else {
      assert.equal(
        run.conclusion,
        "success",
        `${workflow} must pass for the tagged commit`,
      );
    }
    console.log(`Verified ${workflow}: ${run.html_url}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await verifyChecks();
