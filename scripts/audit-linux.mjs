import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// A Windows-beta exception, not approval to distribute Linux binaries.
// Fail closed on every other advisory, version, tool error or malformed result.
export function classifyLinux(output, status, windowsTree) {
  const rows = output.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const summary = rows.find((r) => r.type === "summary")?.fields?.advisories;
  const errors = rows.filter((r) => r.fields?.severity === "error");
  if (!summary || summary.errors !== errors.length || ![0, 1].includes(status))
    throw new Error("Incomplete Linux audit; review tool output.");
  if (status === 0 && errors.length === 0) return "PASS";
  if (status !== 1 || errors.length !== 1 || /\bglib v/.test(windowsTree))
    throw new Error("Unreviewed or Windows-reachable Linux audit failure.");
  const f = errors[0].fields;
  if (
    f.code !== "unsound" ||
    f.advisory?.id !== "RUSTSEC-2024-0429" ||
    f.advisory?.package !== "glib" ||
    f.graphs?.length !== 1 ||
    f.graphs[0].Krate?.name !== "glib" ||
    f.graphs[0].Krate?.version !== "0.18.5"
  )
    throw new Error("Unreviewed Linux advisory; update dependency analysis.");
  return "REQUIRES REVIEW: Linux glib 0.18.5 / RUSTSEC-2024-0429. Absent from Windows; Linux release blocked pending review/fix.";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const tree = spawnSync(
    "cargo",
    [
      "tree",
      "--locked",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--target",
      "x86_64-pc-windows-msvc",
      "--edges",
      "normal,build,dev",
    ],
    { encoding: "utf8", maxBuffer: 20e6 },
  );
  if (tree.error || tree.status !== 0)
    throw new Error("Windows dependency graph unavailable.");
  const result = spawnSync(
    "cargo",
    [
      "deny",
      "--format",
      "json",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--config",
      "deny.toml",
      "--target",
      "x86_64-unknown-linux-gnu",
      "--locked",
      "check",
      "advisories",
    ],
    { encoding: "utf8", maxBuffer: 20e6 },
  );
  if (result.error) throw result.error;
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  const classification = classifyLinux(
    result.stderr,
    result.status,
    tree.stdout,
  );
  console.log(classification);
  if (process.env.GITHUB_ACTIONS && classification !== "PASS")
    console.log(
      `::warning title=Linux release requires review::${classification}`,
    );
}
