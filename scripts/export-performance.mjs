import { readFile, writeFile, mkdir, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  validatePerformance,
  validatePerformanceSources,
} from "./validate-performance.mjs";

// Prepare local public assets only. This does not deploy, upload or publish.
try {
  const [input, destination] = process.argv.slice(2);
  if (!input || !destination || process.argv.length !== 4)
    throw new Error(
      "Usage: node scripts/export-performance.mjs <performance.json> <public-data-directory>",
    );
  const original = await readFile(input);
  const data = JSON.parse(original.toString("utf8").replace(/^\uFEFF/, ""));
  const errors = validatePerformance(data);
  if (!errors.length)
    errors.push(
      ...(await validatePerformanceSources(
        data,
        path.dirname(path.resolve(input)),
      )),
    );
  if (errors.length) throw new Error(errors.join("\n"));
  if (data.status !== "measured")
    throw new Error(
      "Only complete measured production datasets can replace public results.",
    );
  const id = createHash("sha256").update(original).digest("hex").slice(0, 20);
  const prefix = `benchmarks/${id}`;
  const target = path.resolve(destination);
  await mkdir(path.join(target, prefix), { recursive: true });
  for (const scenario of data.scenarios) {
    for (const source of scenario.sources) {
      const bytes = await readFile(
        path.resolve(path.dirname(input), source.path),
      );
      if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
        throw new Error("Source changed after validation.");
      const name = `${scenario.id}-${source.kind}.json`;
      await writeFile(path.join(target, prefix, name), bytes);
      source.path = `${prefix}/${name}`;
    }
  }
  const finalErrors = [
    ...validatePerformance(data),
    ...(await validatePerformanceSources(data, target)),
  ];
  if (finalErrors.length) throw new Error(finalErrors.join("\n"));
  await copyFile(
    new URL("../benchmarks/performance.schema.json", import.meta.url),
    path.join(target, "performance.schema.json"),
  );
  const temporary = path.join(target, `performance-${id}.json.tmp`);
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n");
  await rename(temporary, path.join(target, "performance.json"));
  console.log(
    `PASS: prepared local public data at ${path.join(target, "performance.json")}. No deployment performed.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
