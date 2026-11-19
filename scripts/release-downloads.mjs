import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const installerTypes = [
  "Windows setup",
  "macOS Intel",
  "macOS Apple Silicon",
  "Linux AppImage",
  "Linux DEB",
];

export function classifyAsset(name) {
  if (name.endsWith(".sig")) return "Signature";
  if (/^latest(?:-prerelease)?\.json$/.test(name)) return "Updater metadata";
  if (name === "SHA256SUMS.txt") return "Checksums";
  if (
    /--(?:npm\.cdx\.json|rust\.cdx\.json|SBOM-NOTES\.txt|target\.json)$/.test(
      name,
    )
  )
    return "Build evidence";
  if (/^windows-x86_64--.+-setup\.exe$/.test(name)) return "Windows setup";
  if (/^windows-x86_64--.+\.exe$/.test(name)) return "Windows standalone";
  if (/^darwin-aarch64--.+\.dmg$/.test(name)) return "macOS Apple Silicon";
  if (/^darwin-x86_64--.+\.dmg$/.test(name)) return "macOS Intel";
  if (/^darwin-(?:aarch64|x86_64)--.+\.app\.tar\.gz$/.test(name))
    return "macOS update";
  if (/^linux-x86_64--.+\.AppImage$/.test(name)) return "Linux AppImage";
  if (/^linux-x86_64--.+\.deb$/.test(name)) return "Linux DEB";
  return "Other";
}

async function* pages(url) {
  for (let page = 1; ; page++) {
    const response = await fetch(`${url}?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GH_TOKEN && {
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
        }),
      },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `GitHub release API returned HTTP ${response.status} for ${url}`,
      );
    yield* await response.json();
    if (!response.headers.get("link")?.includes('rel="next"')) return;
  }
}

export function summary(assets) {
  const downloads = {};
  for (const { kind, count } of assets)
    downloads[kind] = (downloads[kind] ?? 0) + count;
  const installers = installerTypes.reduce(
    (total, type) => total + (downloads[type] ?? 0),
    0,
  );
  return {
    downloads,
    installers,
    other: Object.values(downloads).reduce((a, b) => a + b, 0) - installers,
  };
}

async function collect() {
  const { owner, repository } = JSON.parse(
    await readFile(new URL("../project.json", import.meta.url), "utf8"),
  );
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases`;
  const releases = [];
  for await (const release of pages(url)) {
    if (release.draft || !release.published_at) continue;
    const assets = [];
    for await (const asset of pages(`${url}/${release.id}/assets`)) {
      if (asset.state !== "uploaded") continue;
      const {
        name,
        size,
        download_count: count,
        browser_download_url: url,
      } = asset;
      const architecture =
        /^(?:windows|darwin|linux)-(x86_64|aarch64)--/.exec(name)?.[1] ?? "";
      assets.push({
        name,
        architecture,
        kind: classifyAsset(name),
        bytes: size,
        count,
        url,
      });
    }
    releases.push({
      tag: release.tag_name,
      published: release.published_at,
      prerelease: release.prerelease,
      ...summary(assets),
      assets,
    });
  }
  return {
    collected: new Date().toISOString(),
    repository: `${owner}/${repository}`,
    releases,
  };
}

function toCsv(releases) {
  const rows = [
    [
      "tag",
      "published",
      "prerelease",
      "name",
      "architecture",
      "kind",
      "bytes",
      "downloads",
      "url",
    ],
  ];
  for (const { tag, published, prerelease, assets } of releases) {
    for (const { name, architecture, kind, bytes, count, url } of assets)
      rows.push([
        tag,
        published,
        prerelease,
        name,
        architecture,
        kind,
        bytes,
        count,
        url,
      ]);
  }
  return (
    rows
      .map((row) =>
        row
          .map((field) => `"${String(field).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: { csv: { type: "string" }, json: { type: "string" } },
  });
  const report = await collect();
  console.log(
    `GitHub release asset downloads as of ${report.collected} UTC. Windows setup and AppImage include updates. Source archives have no asset counts.`,
  );
  console.table(
    report.releases.map(({ tag, published, downloads, installers, other }) => ({
      Release: tag,
      "Published UTC": published.slice(0, 10),
      ...Object.fromEntries(
        installerTypes.map((type) => [type, downloads[type] ?? "—"]),
      ),
      Installers: installers,
      "Other files": other,
    })),
  );
  if (values.csv) await writeFile(values.csv, toCsv(report.releases));
  if (values.json)
    await writeFile(values.json, JSON.stringify(report, null, 2) + "\n");
}
