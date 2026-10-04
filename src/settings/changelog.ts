import changelog from "../../CHANGELOG.md?raw";
import { t } from "../i18n";

export interface ReleaseNotes {
  version: string;
  detail: string;
  sections: { heading: string; items: string[] }[];
}
export function parseChangelog(markdown: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = [];
  let release: ReleaseNotes | undefined;
  let section: ReleaseNotes["sections"][number] | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const version = /^##\s+(\d+\.\d+\.\d+(?:-[\w.]+)?)(.*)$/.exec(line);
    if (version) {
      release = {
        version: version[1],
        detail: version[2].trim().replace(/^[—-]\s*/, ""),
        sections: [],
      };
      releases.push(release);
      section = undefined;
    } else if (release && /^###\s+/.test(line)) {
      section = { heading: line.replace(/^###\s+/, "").trim(), items: [] };
      release.sections.push(section);
    } else if (section && /^-\s+/.test(line)) {
      section.items.push(line.replace(/^-\s+/, ""));
    } else if (section && /^\s{2,}\S/.test(line) && section.items.length) {
      section.items[section.items.length - 1] += ` ${line.trim()}`;
    }
  }
  return releases;
}
export function renderChangelog(container: HTMLElement, source = changelog) {
  container.replaceChildren();
  const intro = document.createElement("p");
  intro.className = "subtitle";
  intro.textContent = t("changelog.intro");
  container.append(intro);
  for (const release of parseChangelog(source)) {
    const article = document.createElement("article");
    article.className = "changelog-release";
    const title = document.createElement("h2");
    title.textContent = `ChatPlus ${release.version}`;
    article.append(title);
    if (release.detail) {
      const detail = document.createElement("small");
      detail.textContent =
        release.detail === "prepared, not published"
          ? t("changelog.prepared")
          : release.detail;
      article.append(detail);
    }
    for (const section of release.sections) {
      const title = document.createElement("h3");
      title.textContent =
        section.heading === "Added"
          ? t("changelog.features")
          : section.heading === "Changed"
            ? t("changelog.improvements")
            : section.heading === "Fixed"
              ? t("changelog.fixes")
              : t("changelog.notes");
      const list = document.createElement("ul");
      for (const item of section.items) {
        const entry = document.createElement("li");
        // Swiph3l: Release notes come from the shipped source of truth; textContent keeps future Markdown/HTML from executing in Settings.
        entry.textContent = item;
        list.append(entry);
      }
      article.append(title, list);
    }
    container.append(article);
  }
}
