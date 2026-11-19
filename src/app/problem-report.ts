import { providers, type ProviderId } from "./providers";

export interface ReportEnvironment {
  version: string;
  os: string;
  architecture: string;
  webviewVersion: string | null;
  enabledTypes: ProviderId[];
}

export interface ResourceSnapshot extends ReportEnvironment {
  uptimeSeconds: number;
  mainResidentBytes: number | null;
  mainPrivateResidentBytes: number | null;
  appWebviewPrivateResidentBytes: number | null;
  serviceWebviewPrivateResidentBytes: number | null;
  sharedWebviewPrivateResidentBytes: number | null;
  mainCpuPercent: number | null;
  activeServices: number;
  webviewProcesses: number | null;
}

// Swiph3l: The editable fields are prose, not a log import. Drop entire suspect
// lines so spaces, quotes, and cookie separators cannot expose a partial value.
const privateLine = [
  /(?:[a-z][\w+.-]*:\/\/|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?]|\s|$)|[?&][\w.-]+=|[\w.+-]+@[\w.-]+|(?:^|\W)@[\w.-]+)/i,
  /(?:[a-z]:[\\/]|\\\\|(?:^|[\s("'=])(?:~?\/[^\s/]+|\.\.?[\\/]))/i,
  /(?:%[\w()]+%[\\/]|(?:^|\s)(?:\$[\w]+[\\/]|[\w.-]+[\\/][\w.-]+)|^\s*>)/,
  /^\s*[\p{L}\d_.-]+(?:\s+[\p{L}\d_.-]+){0,2}:\s+\S/u,
  /(?:\b(?:bearer|basic|cookie|set-cookie|authorization|password|passwd|secret|credential|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?id|user[_ -]?id|username|account[_ -]?id|message[_ -]?content)\b[\s"']*[:=]|\b(?:bearer|basic)\s+[\w+/=-]+|\b[\w.%-]+\s*=\s*\S)/i,
  /\b(?:eyJ[\w-]+\.[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|xox[bpars]-\S+|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}|\d{7,}|(?:\d{1,3}\.){3}\d{1,3})\b/i,
  /(?:\b[A-Za-z\d_+/-]{24,}\b|<[^>]+>|^\s*[{[]|-----BEGIN |-----END )/,
];

export function redactNarrative(input: string): string {
  const normalized = input
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(
      /[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
      "",
    );
  // A structured log, quoted message dump, or multiline credential can carry
  // unidentified continuation values. Suppress the entire pasted block.
  if (
    /^\s*[[{>"“«„]|^\s*(?:authorization|cookie|password|secret|token)\s*[:=]\s*$/im.test(
      normalized,
    )
  )
    return "[redacted]";
  // An unterminated key is sensitive through the end of the input.
  return normalized
    .replace(
      /-----BEGIN [^\n]*?-----[\s\S]*?(?:-----END [^\n]*?-----|$)/gi,
      "[redacted]",
    )
    .split("\n")
    .map((line) => {
      let decoded = line;
      for (let pass = 0; pass < 2 && decoded.includes("%"); pass++) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          return "[redacted]";
        }
      }
      return privateLine.some((pattern) => pattern.test(decoded)) ||
        /\b(?:token|password|secret|api[_ -]?key|user[_ -]?id|username|account[_ -]?id)\s+(?:is\s+)?\S/i.test(
          decoded,
        )
        ? "[redacted]"
        : line.trim();
    })
    .join("\n")
    .trim()
    .slice(0, 4000);
}

function reportVersion(value: unknown): string {
  return typeof value === "string" &&
    /^\d+(?:\.\d+){1,5}(?:(?:-(?:alpha|beta|rc)(?:\.\d+)?)| (?:beta|dev|canary|stable))?$/i.test(
      value,
    )
    ? value
    : "Unavailable";
}

export function makeProblemReport(
  description: string,
  steps: string,
  sample?: ReportEnvironment,
): string {
  const textBlock = (value: string) =>
    redactNarrative(value)
      .split("\n")
      .map((line) => "    " + line)
      .join("\n");
  const sections = [
    "# Chat+ problem report",
    "## Description",
    textBlock(description),
  ];
  if (steps.trim()) sections.push("## Steps to reproduce", textBlock(steps));
  if (sample) {
    // Swiph3l: Select individual fields again at the export boundary. The About
    // snapshot, user-defined service names, profile IDs and event history stay local.
    const systems = ["windows", "linux", "macos"];
    const architectures = [
      "x86",
      "x86_64",
      "aarch64",
      "arm",
      "riscv64",
      "powerpc64",
      "s390x",
    ];
    const types = [
      ...new Set(
        sample.enabledTypes.filter((type) => Object.hasOwn(providers, type)),
      ),
    ];
    sections.push(
      "## Environment",
      [
        "- Chat+ version: " + reportVersion(sample.version),
        "- OS: " + (systems.includes(sample.os) ? sample.os : "Unavailable"),
        "- Architecture: " +
          (architectures.includes(sample.architecture)
            ? sample.architecture
            : "Unavailable"),
        "- WebView runtime: " + reportVersion(sample.webviewVersion),
        "- Enabled service types: " +
          (types.map((type) => providers[type].name).join(", ") || "None"),
      ].join("\n"),
    );
  }
  return sections.join("\n\n") + "\n";
}
