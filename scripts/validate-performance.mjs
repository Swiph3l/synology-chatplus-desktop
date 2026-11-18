import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const METRICS = Object.freeze([
  ...["shell", "webview", "total"].flatMap((scope) =>
    [
      "working_set_bytes",
      "private_bytes",
      "private_working_set_bytes",
      "commit_bytes",
      "sampled_peak_working_set_bytes",
      "os_peak_working_set_bytes",
      "cpu_percent",
      "process_count",
    ].map((name) => ({
      name,
      scope,
      unit:
        name === "cpu_percent"
          ? "percent"
          : name === "process_count"
            ? "count"
            : "bytes",
    })),
  ),
  { name: "service_count", scope: "total", unit: "count" },
  { name: "startup_ms", scope: "total", unit: "ms" },
]);
const schemaPath = new URL(
  "../benchmarks/performance.schema.json",
  import.meta.url,
);
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const statuses = ["measured", "unavailable", "invalid", "not_run"];
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const near = (a, b) =>
  typeof a === "number" &&
  typeof b === "number" &&
  Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-9);
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    mean: sorted.reduce((a, b) => a + b, 0) / n,
    median: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
  };
};

// The intentionally small JSON Schema interpreter covers every keyword used by
// this repository's schema, without adding a runtime dependency.
function checkSchema(value, rule, location, errors) {
  if (rule.$ref) {
    const resolved = rule.$ref
      .split("/")
      .slice(1)
      .reduce((entry, key) => entry?.[key], schema);
    if (!resolved) throw new Error(`Unknown schema reference ${rule.$ref}`);
    return checkSchema(value, resolved, location, errors);
  }
  if (rule.anyOf) {
    if (
      !rule.anyOf.some((candidate) => {
        const test = [];
        checkSchema(value, candidate, location, test);
        return !test.length;
      })
    )
      errors.push(`${location}: does not match an allowed type`);
    return;
  }
  const typeMatches = (type) =>
    type === "null"
      ? value === null
      : type === "object"
        ? object(value)
        : type === "array"
          ? Array.isArray(value)
          : type === "integer"
            ? Number.isSafeInteger(value)
            : typeof value === type &&
              (type !== "number" || Number.isFinite(value));
  if (
    rule.type &&
    !(Array.isArray(rule.type) ? rule.type : [rule.type]).some(typeMatches)
  ) {
    errors.push(`${location}: expected ${rule.type}`);
    return;
  }
  if ("const" in rule && value !== rule.const)
    errors.push(`${location}: unexpected constant`);
  if (rule.enum && !rule.enum.includes(value))
    errors.push(`${location}: unknown value`);
  if (
    typeof value === "number" &&
    ((rule.minimum !== undefined && value < rule.minimum) ||
      (rule.maximum !== undefined && value > rule.maximum))
  )
    errors.push(`${location}: outside allowed range`);
  if (typeof value === "string") {
    if (rule.pattern && !new RegExp(rule.pattern).test(value))
      errors.push(`${location}: invalid format`);
    if (rule.maxLength && value.length > rule.maxLength)
      errors.push(`${location}: too long`);
    if (
      rule.format === "date-time" &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(
        value,
      ) ||
        !Number.isFinite(Date.parse(value)))
    )
      errors.push(`${location}: invalid timestamp`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems)
      errors.push(`${location}: too few entries`);
    if (rule.maxItems !== undefined && value.length > rule.maxItems)
      errors.push(`${location}: too many entries`);
    if (rule.items)
      value.forEach((entry, index) =>
        checkSchema(entry, rule.items, `${location}[${index}]`, errors),
      );
  }
  if (object(value)) {
    for (const key of rule.required ?? [])
      if (!(key in value)) errors.push(`${location}.${key}: required`);
    for (const [key, entry] of Object.entries(value)) {
      if (rule.properties?.[key])
        checkSchema(entry, rule.properties[key], `${location}.${key}`, errors);
      else if (rule.additionalProperties === false)
        errors.push(`${location}.${key}: unexpected field`);
      else if (object(rule.additionalProperties))
        checkSchema(
          entry,
          rule.additionalProperties,
          `${location}.${key}`,
          errors,
        );
    }
  }
}

export function validatePerformance(data, { allowFixtures = false } = {}) {
  const errors = [];
  checkSchema(data, schema, "dataset", errors);
  if (errors.length) return errors;
  if (!allowFixtures && data.datasetKind !== "production")
    errors.push("Production results reject fixture datasets.");
  if (data.application.version !== data.build.appVersion)
    errors.push("Application and build versions differ.");
  const scenarioIds = data.scenarios.map((item) => item.id);
  if (
    new Set(scenarioIds).size !== 9 ||
    !"ABCDEFGHI".split("").every((id) => scenarioIds.includes(id))
  )
    errors.push("Exactly scenarios A-I are required.");
  const states = data.scenarios.map((item) => item.status);
  const status = states.includes("invalid")
    ? "invalid"
    : states.includes("measured")
      ? "measured"
      : states.includes("unavailable")
        ? "unavailable"
        : "not_run";
  if (data.status !== status)
    errors.push("Dataset status does not reflect its scenarios.");
  if (
    ["measured", "invalid"].includes(data.status) &&
    (!data.environment || !data.collection || !data.measuredAt)
  )
    errors.push(
      "Attempted measurements require environment, collection and date metadata.",
    );
  if (
    data.status === "measured" &&
    (!data.build.id || !data.build.executableSha256)
  )
    errors.push(
      "Measured results require release build and executable provenance.",
    );
  if (data.status === "not_run" && data.measuredAt !== null)
    errors.push("Not-run results cannot have a measurement date.");
  for (const scenario of data.scenarios) {
    const prefix = `scenario ${scenario.id}`;
    const expected = { A: 0, B: 1, C: 1, D: 3, E: 5 }[scenario.id];
    if (expected !== undefined && scenario.serviceCount !== expected)
      errors.push(`${prefix}: incorrect service count`);
    if (scenario.status !== "measured" && !scenario.reason)
      errors.push(`${prefix}: absent results require a reason`);
    const valid = scenario.runs.filter((run) => run.status === "measured");
    if (scenario.repetitionsCompleted !== valid.length)
      errors.push(`${prefix}: repetition count does not match successful runs`);
    if (
      new Set(scenario.runs.map((run) => run.id)).size !== scenario.runs.length
    )
      errors.push(`${prefix}: duplicate run ids`);
    if (scenario.status === "measured") {
      if (
        valid.length < scenario.repetitionsRequired ||
        valid.length !== scenario.runs.length ||
        scenario.state === null ||
        scenario.serviceCount === null
      )
        errors.push(
          `${prefix}: measured scenario must contain at least five complete repetitions and prepared state`,
        );
      if (
        !scenario.sources.some((source) => source.kind === "samples") ||
        !scenario.sources.some((source) => source.kind === "processes")
      )
        errors.push(
          `${prefix}: measured results require sample and process provenance`,
        );
      if (
        !scenario.workload ||
        scenario.workload.serviceProviders.length !== scenario.serviceCount ||
        scenario.workload.accountCount > scenario.serviceCount ||
        (scenario.serviceCount > 0 && scenario.workload.accountCount < 1) ||
        (scenario.id === "H" &&
          (scenario.workload.switchesPerformed < 120 ||
            scenario.serviceCount < 2))
      )
        errors.push(`${prefix}: workload configuration is incomplete`);
      if (
        !data.collection ||
        (scenario.id === "G" &&
          (scenario.state !== "idle" ||
            data.collection.preparedDurationMinutes * 60 +
              data.collection.warmupSeconds <
              1800)) ||
        (scenario.id === "I" &&
          data.collection.preparedDurationMinutes * 60 +
            data.collection.warmupSeconds <
            14400)
      )
        errors.push(`${prefix}: preparation does not satisfy methodology`);
    }
    if (
      ["not_run", "unavailable"].includes(scenario.status) &&
      (scenario.runs.length ||
        scenario.metrics.length ||
        scenario.sources.length)
    )
      errors.push(`${prefix}: absent scenarios must not contain results`);
    if (scenario.metrics.length && scenario.metrics.length !== METRICS.length)
      errors.push(`${prefix}: expected complete metric set`);
    const seen = new Set();
    for (const metric of scenario.metrics) {
      const key = `${metric.scope}.${metric.name}`,
        definition = METRICS.find(
          (item) => item.scope === metric.scope && item.name === metric.name,
        );
      if (!definition || metric.unit !== definition.unit || seen.has(key))
        errors.push(
          `${prefix}: unknown, duplicate or incorrectly labelled metric ${key}`,
        );
      seen.add(key);
      if (metric.status === "measured") {
        if (
          scenario.status !== "measured" ||
          metric.runCount !== valid.length ||
          !metric.aggregates
        ) {
          errors.push(`${prefix}: incomplete measured metric ${key}`);
          continue;
        }
        const values = valid.map((run) => run.metrics[key]);
        if (!values.every(finite)) {
          errors.push(`${prefix}: missing run values for ${key}`);
          continue;
        }
        const expectedSummary = summary(values);
        for (const field of ["mean", "median", "min", "max"])
          if (!near(metric.aggregates[field], expectedSummary[field]))
            errors.push(`${prefix}: invalid ${field} for ${key}`);
        if (
          metric.name === "os_peak_working_set_bytes" &&
          metric.scope !== "shell"
        )
          errors.push(`${prefix}: asynchronous process peaks cannot be summed`);
        if (
          metric.name === "startup_ms" &&
          data.collection?.startupMethod !== "launch_to_operator_ready"
        )
          errors.push(`${prefix}: startup was not observed`);
      } else if (
        metric.aggregates !== null ||
        metric.runCount !== 0 ||
        !metric.reason
      )
        errors.push(
          `${prefix}: absent metric ${key} must use null and explain its status`,
        );
    }
    for (const run of scenario.runs) {
      if (Date.parse(run.completedAt) < Date.parse(run.startedAt))
        errors.push(`${prefix}: reversed run timestamps`);
      if (run.status === "measured") {
        if (
          run.sampleCount < 3 ||
          run.issues.length ||
          Object.keys(run.metrics).length !== METRICS.length
        )
          errors.push(`${prefix}: incomplete successful run ${run.id}`);
        for (const [key, value] of Object.entries(run.metrics))
          if (
            !METRICS.some((item) => key === `${item.scope}.${item.name}`) ||
            !(value === null || finite(value))
          )
            errors.push(`${prefix}: invalid run metric`);
        if (run.metrics["total.service_count"] !== scenario.serviceCount)
          errors.push(`${prefix}: inconsistent service count`);
      }
    }
  }
  return errors;
}

function assertKeys(value, keys, label) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    throw new Error(`${label}: invalid or private source fields`);
}
const safeTime = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const sampleNames = [
  "working_set_bytes",
  "private_bytes",
  "private_working_set_bytes",
  "commit_bytes",
  "os_peak_working_set_bytes",
  "cpu_percent",
  "process_count",
];

export async function validatePerformanceSources(data, baseDirectory) {
  const errors = [];
  const root = await realpath(baseDirectory);
  for (const scenario of data.scenarios) {
    if (!scenario.sources.length) continue;
    try {
      const sourceData = {};
      for (const source of scenario.sources) {
        if (source.path.split("/").includes(".."))
          throw new Error("Source paths cannot traverse directories.");
        const sourcePath = await realpath(path.resolve(root, source.path));
        const relative = path.relative(root, sourcePath);
        if (relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error("Source must remain inside the evidence directory.");
        const bytes = await readFile(sourcePath);
        if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
          throw new Error("Source hash mismatch.");
        if (sourceData[source.kind]) throw new Error("Duplicate source kind.");
        sourceData[source.kind] = JSON.parse(
          bytes.toString("utf8").replace(/^\uFEFF/, ""),
        );
      }
      if (
        !Array.isArray(sourceData.samples) ||
        !Array.isArray(sourceData.processes)
      )
        throw new Error("Both safe JSON evidence files are required.");
      const processes = new Map();
      for (const process of sourceData.processes) {
        assertKeys(
          process,
          ["identity", "pid", "parentPid", "startedAt", "role", "imageName"],
          "process",
        );
        if (
          !/^\d+@\d+$/.test(process.identity) ||
          !Number.isInteger(process.pid) ||
          process.pid <= 0 ||
          !Number.isInteger(process.parentPid) ||
          !safeTime(process.startedAt) ||
          !["shell", "webview", "helper"].includes(process.role) ||
          !/^[a-zA-Z0-9 ._+-]+\.exe$/i.test(process.imageName) ||
          processes.has(process.identity)
        )
          throw new Error("Invalid public process identity.");
        if (!process.identity.startsWith(`${process.pid}@`))
          throw new Error("Process identity and PID differ.");
        const expectedTicks =
          BigInt(Date.parse(process.startedAt)) * 10000n + 621355968000000000n;
        const actualTicks = BigInt(process.identity.split("@")[1]);
        if (
          actualTicks < expectedTicks ||
          actualTicks - expectedTicks >= 10000n
        )
          throw new Error("Process creation time and identity differ.");
        if (
          process.role === "webview" &&
          process.imageName.toLowerCase() !== "msedgewebview2.exe"
        )
          throw new Error("WebView attribution has incorrect executable name.");
        processes.set(process.identity, process);
      }
      for (const process of processes.values()) {
        let child = process;
        const visited = new Set();
        while (child.role !== "shell") {
          if (visited.has(child.identity))
            throw new Error("Process attribution contains a cycle.");
          visited.add(child.identity);
          const parents = [...processes.values()]
            .filter(
              (parent) =>
                parent.pid === child.parentPid &&
                Date.parse(parent.startedAt) <= Date.parse(child.startedAt),
            )
            .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
          if (!parents.length)
            throw new Error(
              "Process lineage has no verified parent leading to a shell.",
            );
          child = parents[0];
        }
      }
      for (const sample of sourceData.samples) {
        assertKeys(
          sample,
          [
            "runId",
            "sampleId",
            "sampledAt",
            "elapsedMs",
            "cycleDurationMs",
            "processIdentities",
            "scopes",
          ],
          "sample",
        );
        if (
          !Number.isInteger(sample.runId) ||
          !Number.isInteger(sample.sampleId) ||
          sample.sampleId < 1 ||
          !safeTime(sample.sampledAt) ||
          !finite(sample.elapsedMs) ||
          !finite(sample.cycleDurationMs) ||
          !Array.isArray(sample.processIdentities) ||
          new Set(sample.processIdentities).size !==
            sample.processIdentities.length ||
          sample.processIdentities.some((id) => !processes.has(id))
        )
          throw new Error("Invalid synchronized sample provenance.");
        assertKeys(sample.scopes, ["shell", "webview", "total"], "scopes");
        for (const scope of ["shell", "webview", "total"]) {
          assertKeys(sample.scopes[scope], sampleNames, scope);
          for (const [name, value] of Object.entries(sample.scopes[scope]))
            if (!(
              finite(value) ||
              (value === null &&
                [
                  "private_working_set_bytes",
                  "os_peak_working_set_bytes",
                ].includes(name))
            ))
              throw new Error("Missing or invalid mandatory source counter.");
          const counted =
            scope === "total"
              ? sample.processIdentities.length
              : sample.processIdentities.filter(
                  (id) => processes.get(id).role === scope,
                ).length;
          if (
            sample.scopes[scope].process_count !== counted ||
            (scope === "shell" && counted !== 1)
          )
            throw new Error(
              "Source process counts do not match attributed identities.",
            );
        }
        for (const name of [
          "working_set_bytes",
          "private_bytes",
          "commit_bytes",
          "cpu_percent",
        ])
          if (
            sample.scopes.total[name] + 1e-6 <
            sample.scopes.shell[name] + sample.scopes.webview[name]
          )
            throw new Error("Tree total excludes attributed processes.");
        if (
          sample.scopes.total.os_peak_working_set_bytes !== null ||
          sample.scopes.webview.os_peak_working_set_bytes !== null
        )
          throw new Error("Source contains summed asynchronous peaks.");
      }
      for (const run of scenario.runs.filter(
        (item) => item.status === "measured",
      )) {
        const samples = sourceData.samples.filter(
          (sample) => sample.runId === run.id,
        );
        if (
          samples.length !== run.sampleCount ||
          new Set(samples.map((sample) => sample.sampleId)).size !==
            samples.length
        )
          throw new Error("Run sample count differs from raw evidence.");
        if (
          samples.some(
            (sample, index) =>
              index > 0 &&
              (sample.elapsedMs <= samples[index - 1].elapsedMs ||
                Date.parse(sample.sampledAt) <=
                  Date.parse(samples[index - 1].sampledAt)),
          )
        )
          throw new Error("Sample timestamps must increase.");
        if (samples.at(-1).elapsedMs < data.collection.durationSeconds * 1000)
          throw new Error("Sampling window is incomplete.");
        for (const definition of METRICS) {
          const key = `${definition.scope}.${definition.name}`;
          if (["startup_ms", "service_count"].includes(definition.name))
            continue;
          let expected = null;
          if (!(
            definition.name === "os_peak_working_set_bytes" &&
            definition.scope !== "shell"
          )) {
            const rawName =
              definition.name === "sampled_peak_working_set_bytes"
                ? "working_set_bytes"
                : definition.name;
            const values = samples.map(
              (sample) => sample.scopes[definition.scope][rawName],
            );
            if (values.every((value) => value !== null))
              expected = definition.name.includes("peak_")
                ? Math.max(...values)
                : summary(values).mean;
          }
          if (
            expected === null
              ? run.metrics[key] !== null
              : !near(run.metrics[key], expected)
          )
            throw new Error(`Run metric ${key} differs from raw samples.`);
        }
      }
    } catch (error) {
      errors.push(`scenario ${scenario.id}: ${error.message}`);
    }
  }
  return errors;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const input = process.argv[2];
    if (!input || process.argv.length !== 3)
      throw new Error(
        "Usage: node scripts/validate-performance.mjs <performance.json>",
      );
    const data = JSON.parse(
      (await readFile(input, "utf8")).replace(/^\uFEFF/, ""),
    );
    const errors = validatePerformance(data);
    if (!errors.length)
      errors.push(
        ...(await validatePerformanceSources(
          data,
          path.dirname(path.resolve(input)),
        )),
      );
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      `PASS: production benchmark ${data.status}; ${data.scenarios.filter((item) => item.status === "measured").length} measured scenarios.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
