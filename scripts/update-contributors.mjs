import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const start = "<!-- contributors:start -->";
const end = "<!-- contributors:end -->";
const usernamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const repositoryPattern = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const platformNames = { windows: "Windows", macos: "macOS", linux: "Linux" };
const markdown = (value) => value.replace(/[\\`*_[\]<>]/g, "\\$&");

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

// Swiph3l: About and README use the same reviewed registry. Keep generation local
// and deterministic; GitHub activity counts are not a measure of contribution.
function section(registry, english) {
  requireValue(
    Array.isArray(registry.contributors) && Array.isArray(registry.forks),
    "contributors.json must contain contributors and forks arrays.",
  );
  const people = new Map();
  const usernames = new Set();
  const creditLines = registry.contributors.map((contributor) => {
    requireValue(
      typeof contributor.id === "string" &&
        idPattern.test(contributor.id) &&
        !people.has(contributor.id),
      "Contributor IDs must be unique, stable lowercase identifiers.",
    );
    requireValue(
      typeof contributor.name === "string" &&
        contributor.name.trim().length > 0 &&
        contributor.name.length <= 80 &&
        !/[\u0000-\u001f\u007f]/.test(contributor.name) &&
        typeof contributor.username === "string" &&
        usernamePattern.test(contributor.username) &&
        !usernames.has(contributor.username.toLowerCase()),
      `Invalid or duplicate public identity for contributor ${contributor.id}.`,
    );
    requireValue(
      Array.isArray(contributor.contributions) &&
        contributor.contributions.length > 0 &&
        new Set(contributor.contributions).size ===
          contributor.contributions.length,
      `Contributor ${contributor.id} needs distinct contribution roles.`,
    );
    const roles = contributor.contributions.map((role) => {
      const label = english[`about.contribution.${role}`];
      requireValue(
        typeof role === "string" &&
          /^[a-z][a-z0-9-]*$/.test(role) &&
          typeof label === "string" &&
          label.trim().length > 0,
        `Add a translated about.contribution.${role} label before crediting this role.`,
      );
      return markdown(label);
    });
    people.set(contributor.id, contributor);
    usernames.add(contributor.username.toLowerCase());
    return `- [${markdown(contributor.name)}](https://github.com/${contributor.username}) — ${roles.join("; ")}.`;
  });
  const forkIds = new Set();
  const variantLines = registry.forks.map((fork) => {
    const contributor = people.get(fork.contributorId);
    requireValue(
      typeof fork.id === "string" &&
        idPattern.test(fork.id) &&
        !forkIds.has(fork.id) &&
        contributor &&
        typeof fork.owner === "string" &&
        usernamePattern.test(fork.owner) &&
        typeof fork.repository === "string" &&
        repositoryPattern.test(fork.repository) &&
        Object.hasOwn(platformNames, fork.platform),
      `Invalid community variant or contributor reference: ${fork.id}.`,
    );
    forkIds.add(fork.id);
    const platform = platformNames[fork.platform];
    return `- [${platform} community variant by ${markdown(contributor.name)}](https://github.com/${fork.owner}/${fork.repository})`;
  });
  return [
    start,
    "",
    "## Contributors",
    "",
    "Thank you to the people whose accepted work helps maintain and improve ChatPlus Desktop.",
    "Credits recognize reviewed code, ports, translations, testing and documentation.",
    "",
    ...creditLines,
    "",
    "Community variants:",
    "",
    ...variantLines,
    "",
    "[Fork this project](https://github.com/Swiph3l/synology-chatplus-desktop/fork) to build a variant,",
    "or [contribute code, a translation, testing or documentation](CONTRIBUTING.md).",
    "This list and About are generated from [contributors.json](contributors.json); see the",
    "[credit workflow](CONTRIBUTING.md#contributor-credit) when adding a person or variant.",
    end,
  ].join("\n");
}

try {
  const args = process.argv.slice(2);
  requireValue(
    args.length === 0 || (args.length === 1 && args[0] === "--check"),
    "Usage: node scripts/update-contributors.mjs [--check]",
  );
  const [registrySource, englishSource, readmeSource] = await Promise.all([
    readFile(new URL("contributors.json", root), "utf8"),
    readFile(new URL("src/i18n/en.json", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
  ]);
  const readme = readmeSource.replace(/\r\n/g, "\n");
  requireValue(
    readme.split(start).length === 2 &&
      readme.split(end).length === 2 &&
      readme.indexOf(start) < readme.indexOf(end),
    "README.md must contain exactly one ordered contributors marker block.",
  );
  const generated = section(
    JSON.parse(registrySource),
    JSON.parse(englishSource),
  );
  const updated =
    readme.slice(0, readme.indexOf(start)) +
    generated +
    readme.slice(readme.indexOf(end) + end.length);
  if (args.includes("--check")) {
    requireValue(
      readme === updated,
      "README contributor credits are out of sync. Run npm run contributors:update.",
    );
    console.log("README contributor credits match the reviewed registry.");
  } else if (readme !== updated) {
    await writeFile(new URL("README.md", root), updated);
    console.log(
      `Updated contributor credits in ${fileURLToPath(new URL("README.md", root))}.`,
    );
  } else {
    console.log("README contributor credits are already current.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
