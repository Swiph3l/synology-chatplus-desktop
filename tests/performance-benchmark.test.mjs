import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  METRICS,
  validatePerformance,
  validatePerformanceSources,
} from "../scripts/validate-performance.mjs";

const baseline = JSON.parse(
  await readFile(
    new URL("./fixtures/performance-unmeasured.json", import.meta.url),
    "utf8",
  ),
);
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median:
      (sorted[Math.floor((values.length - 1) / 2)] +
        sorted[Math.floor(values.length / 2)]) /
      2,
    min: sorted[0],
    max: sorted.at(-1),
  };
};
const stamp = "2026-01-01T00:00:00.000Z";
const ticks = (value) =>
  (BigInt(Date.parse(value)) * 10000n + 621355968000000000n).toString();

async function fixture(directory) {
  const data = structuredClone(baseline);
  data.datasetKind = "fixture";
  data.status = "measured";
  data.measuredAt = stamp;
  data.build.id = "synthetic-test-only";
  data.build.executableSha256 = "a".repeat(64);
  data.environment = {
    os: {
      name: "Synthetic Windows",
      version: "10.0",
      build: "12345",
      architecture: "x64",
    },
    hardware: {
      cpu: "Synthetic CPU",
      logicalProcessors: 4,
      physicalMemoryBytes: 1024,
    },
    webview2Versions: ["1.2.3"],
    collectorPowerShell: "5.1",
  };
  data.collection = {
    scriptSha256: "b".repeat(64),
    moduleSha256: "c".repeat(64),
    durationSeconds: 5,
    warmupSeconds: 1,
    sampleIntervalMs: 1000,
    preparedDurationMinutes: 0,
    serviceCountMethod: "operator_confirmed",
    startupMethod: "not_observed_attach_mode",
    repetitionMethod: "repeated_windows_same_session",
  };
  const scenario = data.scenarios.find((item) => item.id === "B");
  Object.assign(scenario, {
    status: "measured",
    reason: null,
    state: "idle",
    repetitionsCompleted: 5,
    workload: {
      serviceProviders: ["synology-chatplus"],
      accountCount: 1,
      switchesPerformed: 0,
    },
  });
  const processes = [
    { pid: 100, parentPid: 1, role: "shell", imageName: "chatplus.exe" },
    {
      pid: 101,
      parentPid: 100,
      role: "webview",
      imageName: "msedgewebview2.exe",
    },
  ].map((item) => ({
    ...item,
    startedAt: stamp,
    identity: `${item.pid}@${ticks(stamp)}`,
  }));
  const samples = [];
  for (let runId = 1; runId <= 5; runId++) {
    const runSamples = [];
    for (let index = 0; index < 3; index++) {
      const scopes = {};
      for (const scope of ["shell", "webview", "total"]) {
        const shell = [40, 70, 50][index],
          webview = [100, 20, 50][index];
        const workingSet =
          scope === "shell"
            ? shell
            : scope === "webview"
              ? webview
              : shell + webview;
        scopes[scope] = {
          working_set_bytes: workingSet,
          private_bytes: workingSet,
          private_working_set_bytes: null,
          commit_bytes: workingSet,
          os_peak_working_set_bytes: scope === "shell" ? 200 : null,
          cpu_percent: scope === "total" ? 4 : 2,
          process_count: scope === "total" ? 2 : 1,
        };
      }
      runSamples.push({
        runId,
        sampleId: index + 1,
        sampledAt: new Date(
          Date.parse(stamp) + runId * 10000 + index * 2000,
        ).toISOString(),
        elapsedMs: 1000 + index * 2000,
        cycleDurationMs: 5,
        processIdentities: processes.map((item) => item.identity),
        scopes,
      });
    }
    const metrics = {};
    for (const definition of METRICS) {
      const key = `${definition.scope}.${definition.name}`;
      const rawName =
        definition.name === "sampled_peak_working_set_bytes"
          ? "working_set_bytes"
          : definition.name;
      if (definition.name === "service_count") metrics[key] = 1;
      else if (
        definition.name === "startup_ms" ||
        definition.name === "private_working_set_bytes" ||
        (definition.name === "os_peak_working_set_bytes" &&
          definition.scope !== "shell")
      )
        metrics[key] = null;
      else {
        const values = runSamples.map(
          (item) => item.scopes[definition.scope][rawName],
        );
        metrics[key] = definition.name.includes("peak_")
          ? Math.max(...values)
          : stats(values).mean;
      }
    }
    scenario.runs.push({
      id: runId,
      status: "measured",
      startedAt: stamp,
      completedAt: new Date(Date.parse(stamp) + 100000).toISOString(),
      sampleCount: 3,
      metrics,
      issues: [],
    });
    samples.push(...runSamples);
  }
  scenario.metrics = METRICS.map((definition) => {
    const values = scenario.runs.map(
      (run) => run.metrics[`${definition.scope}.${definition.name}`],
    );
    const available = values.every((value) => value !== null);
    return {
      ...definition,
      status: available ? "measured" : "unavailable",
      reason: available ? null : "Synthetic unavailable counter",
      runCount: available ? 5 : 0,
      aggregates: available ? stats(values) : null,
    };
  });
  for (const [kind, value] of [
    ["samples", samples],
    ["processes", processes],
  ]) {
    const bytes = Buffer.from(JSON.stringify(value));
    await writeFile(path.join(directory, `${kind}.json`), bytes);
    scenario.sources.push({
      path: `${kind}.json`,
      kind,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return { data, scenario, samples, processes };
}

test("public benchmark is validated NOT RUN, with no invented numeric results", () => {
  assert.deepEqual(validatePerformance(baseline), []);
  assert.equal(baseline.status, "not_run");
  assert.equal(baseline.measuredAt, null);
  assert.ok(
    baseline.scenarios.every(
      (item) => item.metrics.length === 0 && item.runs.length === 0,
    ),
  );
});

test("production rejects fixtures and absent-result zeroes", () => {
  const data = structuredClone(baseline);
  data.datasetKind = "fixture";
  assert.match(validatePerformance(data).join("\n"), /reject fixture/);
  data.datasetKind = "production";
  data.measuredAt = stamp;
  assert.match(
    validatePerformance(data).join("\n"),
    /cannot have a measurement date/,
  );
  data.measuredAt = null;
  data.scenarios[0].metrics = [
    {
      name: "working_set_bytes",
      unit: "bytes",
      scope: "shell",
      status: "not_run",
      reason: "Not observed",
      runCount: 0,
      aggregates: { mean: 0, median: 0, min: 0, max: 0 },
    },
  ];
  assert.match(validatePerformance(data).join("\n"), /must use null/);
});

test("source validation reproduces synchronized peaks, aggregates and attribution; rejects tampering", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "chatplus-benchmark-fixture-"),
  );
  try {
    const { data, scenario } = await fixture(directory);
    assert.deepEqual(validatePerformance(data, { allowFixtures: true }), []);
    assert.deepEqual(await validatePerformanceSources(data, directory), []);
    const peak = scenario.metrics.find(
      (item) =>
        item.scope === "total" &&
        item.name === "sampled_peak_working_set_bytes",
    );
    assert.equal(peak.aggregates.mean, 140);
    const altered = structuredClone(data);
    altered.scenarios[1].runs[0].metrics[
      "total.sampled_peak_working_set_bytes"
    ] = 170;
    assert.match(
      (await validatePerformanceSources(altered, directory)).join("\n"),
      /differs from raw samples/,
    );
    peak.aggregates.mean = 170;
    assert.match(
      validatePerformance(data, { allowFixtures: true }).join("\n"),
      /invalid mean/,
    );
    await writeFile(path.join(directory, "samples.json"), "[]");
    assert.match(
      (await validatePerformanceSources(data, directory)).join("\n"),
      /hash mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsafe source fields, lineage, mismatched counts and incomplete repetitions cannot become public", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "chatplus-benchmark-fixture-"),
  );
  try {
    const { data, scenario, processes } = await fixture(directory);
    scenario.runs.pop();
    scenario.repetitionsCompleted = 4;
    assert.match(
      validatePerformance(data, { allowFixtures: true }).join("\n"),
      /at least five/,
    );
    scenario.runs.push(structuredClone(scenario.runs[0]));
    scenario.runs.at(-1).id = 5;
    scenario.repetitionsCompleted = 5;
    processes[1].commandLine = "private-profile-path";
    const rewrite = async () => {
      const bytes = Buffer.from(JSON.stringify(processes));
      await writeFile(path.join(directory, "processes.json"), bytes);
      scenario.sources.find((source) => source.kind === "processes").sha256 =
        createHash("sha256").update(bytes).digest("hex");
    };
    await rewrite();
    assert.match(
      (await validatePerformanceSources(data, directory)).join("\n"),
      /private source fields/,
    );
    delete processes[1].commandLine;
    processes[1].parentPid = 999;
    await rewrite();
    assert.match(
      (await validatePerformanceSources(data, directory)).join("\n"),
      /no verified parent/,
    );
    processes[1].parentPid = 100;
    processes[1].identity = "101@123";
    await rewrite();
    assert.match(
      (await validatePerformanceSources(data, directory)).join("\n"),
      /creation time and identity differ/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("benchmark CLI accepts an unmeasured dataset and refuses to publish it", async () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/validate-performance.mjs",
      "tests/fixtures/performance-unmeasured.json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const directory = await mkdtemp(
    path.join(tmpdir(), "chatplus-benchmark-export-"),
  );
  try {
    const absent = spawnSync(
      process.execPath,
      [
        "scripts/export-performance.mjs",
        "tests/fixtures/performance-unmeasured.json",
        directory,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /Only complete measured/);
    const { data } = await fixture(directory);
    const file = path.join(directory, "performance.json");
    await writeFile(file, JSON.stringify(data));
    const fixtureExport = spawnSync(
      process.execPath,
      ["scripts/export-performance.mjs", file, path.join(directory, "public")],
      { encoding: "utf8" },
    );
    assert.notEqual(fixtureExport.status, 0);
    assert.match(fixtureExport.stderr, /reject fixture/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "PowerShell synthetic collector regression and parser checks",
  { skip: process.platform !== "win32" },
  () => {
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "tests/benchmark-memory.selftest.ps1",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parse = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "$errorsFound=$false; foreach($file in @('scripts/benchmark-memory.ps1','scripts/lib/benchmark-memory.psm1')) { $tokens=$null; $issues=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file).Path,[ref]$tokens,[ref]$issues) | Out-Null; if($issues.Count) { $issues | Out-String | Write-Output; $errorsFound=$true } }; if($errorsFound) { exit 1 }",
      ],
      { encoding: "utf8" },
    );
    assert.equal(parse.status, 0, parse.stderr || parse.stdout);
  },
);
