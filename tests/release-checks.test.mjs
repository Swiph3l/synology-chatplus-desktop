import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForChecks } from "../scripts/release-checks.mjs";

const commit = "a".repeat(40);
const workflows = ["ci.yml", "codeql.yml", "security.yml"];
const pending = ["queued", "in_progress", "requested", "waiting", "pending"];
const run = (workflow, overrides = {}) => ({
  id: workflows.indexOf(workflow) + 1,
  head_sha: commit,
  head_branch: "main",
  event: "push",
  run_number: 1,
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
  html_url: `https://example.invalid/${workflow}`,
  ...overrides,
});
const windows = (overrides = {}) => ({
  name: "validate (windows-latest, stable)",
  status: "completed",
  conclusion: "success",
  ...overrides,
});
const snapshot = (runs = {}, jobs = { 1: [windows()] }) => ({
  runs: {
    ...Object.fromEntries(workflows.map((name) => [name, [run(name)]])),
    ...runs,
  },
  jobs,
});

function harness(snapshots, { requestTime = () => 0, ...options } = {}) {
  let time = 0;
  const calls = [];
  const sleeps = [];
  const api = async (request) => {
    calls.push(request);
    time += requestTime(request);
    const data = snapshots[Math.min(sleeps.length, snapshots.length - 1)];
    const url = new URL(request, "https://example.invalid");
    const workflow = /^\/actions\/workflows\/([^/]+)\/runs$/.exec(
      url.pathname,
    )?.[1];
    if (workflow) {
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        head_sha: commit,
        event: "push",
        branch: "main",
        per_page: "100",
      });
      assert.ok(workflows.includes(workflow));
      return { workflow_runs: data.runs[workflow] };
    }
    const id = /^\/actions\/runs\/(\d+)\/jobs$/.exec(url.pathname)?.[1];
    assert.ok(id, `Unexpected API path: ${request}`);
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      filter: "latest",
      per_page: "100",
    });
    assert.ok(Object.hasOwn(data.jobs, id), `Unexpected run jobs: ${id}`);
    return { jobs: data.jobs[id] };
  };
  return {
    calls,
    sleeps,
    now: () => time,
    wait: () =>
      waitForChecks(api, commit, {
        timeoutMs: 100,
        pollIntervalMs: 10,
        now: () => time,
        sleep: async (ms) => {
          assert.ok(ms > 0);
          time += ms;
          sleeps.push(ms);
        },
        log: () => {},
        ...options,
      }),
  };
}

test("Release checks wait for every pending status before succeeding", async (t) => {
  for (const status of pending) {
    await t.test(status, async () => {
      const runs = Object.fromEntries(
        workflows.map((name) => [
          name,
          [run(name, { status, conclusion: null })],
        ]),
      );
      const gate = harness([
        snapshot(runs, { 1: [windows({ status, conclusion: null })] }),
        snapshot(),
      ]);
      await gate.wait();
      assert.deepEqual(gate.sleeps, [10]);
      for (const workflow of workflows) {
        assert.equal(
          gate.calls.filter((call) => call.includes(`/workflows/${workflow}/`))
            .length,
          2,
        );
      }
      assert.equal(
        gate.calls.filter((call) => call.includes("/jobs?")).length,
        2,
      );
    });
  }
});

test("Pending release checks reject failure, cancellation, skipping and timeout", async (t) => {
  for (const workflow of workflows) {
    for (const conclusion of ["failure", "cancelled", "skipped", "timed_out"]) {
      await t.test(`${workflow}: ${conclusion}`, async () => {
        const first = snapshot(
          {
            [workflow]: [
              run(workflow, { status: "in_progress", conclusion: null }),
            ],
          },
          {
            1: [
              windows(
                workflow === "ci.yml"
                  ? { status: "in_progress", conclusion: null }
                  : {},
              ),
            ],
          },
        );
        const last = snapshot(
          { [workflow]: [run(workflow, { conclusion })] },
          { 1: [windows(workflow === "ci.yml" ? { conclusion } : {})] },
        );
        const gate = harness([first, last]);
        await assert.rejects(gate.wait(), /must pass/);
        assert.deepEqual(gate.sleeps, [10]);
      });
    }
  }
});

test("Release checks wait for delayed workflow and Windows job creation", async () => {
  const gate = harness([
    snapshot({ "ci.yml": [], "security.yml": [] }),
    snapshot(
      { "ci.yml": [run("ci.yml", { status: "queued", conclusion: null })] },
      { 1: [] },
    ),
    snapshot(),
  ]);
  await gate.wait();
  assert.deepEqual(gate.sleeps, [10, 10]);
  for (const workflow of workflows) {
    assert.equal(
      gate.calls.filter((call) => call.includes(`/workflows/${workflow}/`))
        .length,
      3,
    );
  }
});

test("One shared deadline reports pending statuses and missing runs", async () => {
  const gate = harness(
    [
      snapshot(
        {
          "ci.yml": [run("ci.yml", { status: "queued", conclusion: null })],
          "codeql.yml": [
            run("codeql.yml", { status: "waiting", conclusion: null }),
          ],
          "security.yml": [],
        },
        { 1: [windows({ status: "requested", conclusion: null })] },
      ),
    ],
    { timeoutMs: 25 },
  );
  await assert.rejects(gate.wait(), (error) => {
    assert.match(error.message, /Timed out/);
    assert.ok(error.message.includes(commit));
    assert.match(error.message, /Windows CI: requested/);
    assert.match(error.message, /codeql\.yml: waiting/);
    assert.match(error.message, /security\.yml: missing run/);
    return true;
  });
  assert.equal(gate.now(), 25);
  assert.deepEqual(gate.sleeps, [10, 10, 5]);
  assert.equal(
    gate.calls.length,
    12,
    "Do not issue another request at the deadline",
  );
});

test("A successful API response arriving after the deadline still times out", async () => {
  const gate = harness([snapshot()], {
    timeoutMs: 25,
    requestTime: (request) => (request.includes("/security.yml/") ? 26 : 0),
  });
  await assert.rejects(gate.wait(), /Timed out/);
  assert.equal(gate.now(), 26);
  assert.equal(gate.calls.length, 4);
  assert.deepEqual(gate.sleeps, []);
});

test("Completed or inconsistent checks fail immediately", async (t) => {
  for (const workflow of workflows) {
    await t.test(`${workflow}: completed without conclusion`, async () => {
      const gate = harness([
        snapshot(
          { [workflow]: [run(workflow, { conclusion: null })] },
          { 1: [windows(workflow === "ci.yml" ? { conclusion: null } : {})] },
        ),
      ]);
      await assert.rejects(gate.wait(), /must pass/);
      assert.deepEqual(gate.sleeps, []);
    });
  }
  for (const [name, jobs, message] of [
    ["missing Windows", [], /Expected one Windows CI job/],
    [
      "duplicate Windows",
      [windows(), windows()],
      /Expected one Windows CI job/,
    ],
    [
      "pending Windows in completed CI",
      [windows({ status: "in_progress", conclusion: null })],
      /cannot be pending in a completed workflow/,
    ],
    [
      "unknown Windows status",
      [windows({ status: "unknown" })],
      /must complete/,
    ],
  ]) {
    await t.test(name, async () => {
      const gate = harness([snapshot({}, { 1: jobs })]);
      await assert.rejects(gate.wait(), message);
      assert.deepEqual(gate.sleeps, []);
    });
  }
});

test("Workflow selection excludes the wrong source, branch and event", async () => {
  const invalid = (name) => [
    run(name, { id: 91, run_number: 9, head_sha: "b".repeat(40) }),
    run(name, { id: 92, run_number: 10, head_branch: "other" }),
    run(name, { id: 93, run_number: 11, event: "pull_request" }),
  ];
  await harness([
    snapshot(
      Object.fromEntries(
        workflows.map((name) => [name, [...invalid(name), run(name)]]),
      ),
    ),
  ]).wait();
  const gate = harness(
    [
      snapshot(
        Object.fromEntries(workflows.map((name) => [name, invalid(name)])),
        { 91: [windows()], 92: [windows()], 93: [windows()] },
      ),
    ],
    { timeoutMs: 10 },
  );
  await assert.rejects(gate.wait(), /Timed out.*missing run/);
  assert.deepEqual(gate.sleeps, [10]);
});

test("Every poll rechecks prior successes when a newer run or rerun appears", async (t) => {
  for (const rerun of [false, true]) {
    await t.test(
      rerun ? "same run ID, newer attempt" : "newer run number",
      async () => {
        const latest = {
          id: rerun ? 1 : 4,
          run_number: rerun ? 1 : 2,
          run_attempt: 2,
        };
        const pendingRun = run("ci.yml", {
          ...latest,
          status: "in_progress",
          conclusion: null,
        });
        const gate = harness([
          snapshot({
            "codeql.yml": [
              run("codeql.yml", { status: "in_progress", conclusion: null }),
            ],
          }),
          snapshot(
            { "ci.yml": rerun ? [pendingRun] : [run("ci.yml"), pendingRun] },
            {
              1: [windows(rerun ? { status: "queued", conclusion: null } : {})],
              4: [windows({ status: "queued", conclusion: null })],
            },
          ),
          snapshot(
            { "ci.yml": [run("ci.yml", latest)] },
            { [latest.id]: [windows()] },
          ),
        ]);
        await gate.wait();
        assert.deepEqual(gate.sleeps, [10, 10]);
        assert.deepEqual(
          gate.calls
            .filter((call) => call.includes("/jobs?"))
            .map((call) => /\/runs\/(\d+)\//.exec(call)[1]),
          ["1", String(latest.id), String(latest.id)],
        );
      },
    );
  }
});

test("Successful Windows CI permits experimental platform failures", async () => {
  const gate = harness([
    snapshot(
      { "ci.yml": [run("ci.yml", { conclusion: "failure" })] },
      {
        1: [
          windows(),
          {
            name: "validate (ubuntu-latest, stable)",
            status: "completed",
            conclusion: "failure",
          },
        ],
      },
    ),
  ]);
  await gate.wait();
  assert.deepEqual(gate.sleeps, []);
});
