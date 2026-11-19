import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/settings/support"; export * from "./src/app/problem-report";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "support",
  plugins: [
    {
      name: "local-shell",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({
          path: "native",
          namespace: "mock",
        }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents:
            "export const invoke = (...args) => globalThis.invoke(...args)",
        }));
      },
    },
  ],
});
const sample = {
  version: "1.0.4",
  os: "windows",
  architecture: "x86_64",
  webviewVersion: "142.0.3595.65",
  uptimeSeconds: 72,
  mainResidentBytes: null,
  mainPrivateResidentBytes: 16777216,
  appWebviewPrivateResidentBytes: 8388608,
  serviceWebviewPrivateResidentBytes: null,
  sharedWebviewPrivateResidentBytes: null,
  mainCpuPercent: 11.4,
  activeServices: 2,
  enabledTypes: ["discord", "unknown", "discord", "mattermost"],
  webviewProcesses: null,
  username: "private-user",
  url: "https://private.invalid/?token=secret",
  logs: ["private conversation"],
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
function fixture(onInvoke = () => sample) {
  const { window, document } = parseHTML(
    '<html><body><div id="support"></div></body></html>',
  );
  const create = document.createElement.bind(document);
  window.HTMLTextAreaElement.prototype.setSelectionRange = function (
    start,
    end,
  ) {
    this.selectionStart = start;
    this.selectionEnd = end;
  };
  document.createElement = (tag) => {
    const el = create(tag);
    if (tag === "dialog") {
      el.showModal = () => {
        el.open = true;
      };
      el.close = () => {
        el.open = false;
        el.dispatchEvent(new window.Event("close"));
      };
    }
    return el;
  };
  const calls = [];
  const ctx = {
    document,
    window,
    invoke: async (cmd, args) => {
      calls.push([cmd, structuredClone(args)]);
      return onInvoke(cmd, args);
    },
    setTimeout: () => assert.fail("No scheduled monitoring"),
    setInterval: () => assert.fail("No periodic monitoring"),
  };
  runInNewContext(bundle.outputFiles[0].text, ctx);
  const root = document.getElementById("support");
  const close = ctx.support.mountSupport(root);
  return {
    window,
    document,
    calls,
    close,
    api: ctx.support,
    get: (selector) => document.querySelector(selector),
    openResources(open) {
      const d = root.querySelector("details");
      d.open = open;
      d.dispatchEvent(new window.Event("toggle"));
    },
    input(el) {
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
  };
}

test("single resource snapshots run only on demand and ignore late results after closing", async () => {
  let finish;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(f.calls.length, 0);
  f.openResources(true);
  assert.equal(f.calls.length, 0, "expanding the disclosure does not sample");
  f.get("[data-refresh]").click();
  assert.equal(f.calls.length, 1);
  f.get("[data-refresh]").click();
  assert.equal(f.calls.length, 1);
  f.close();
  finish(sample);
  await turn();
  assert.equal(f.get("dl").textContent, "");
  f.get("[data-refresh]").click();
  assert.equal(f.calls.length, 1);
  f.openResources(true);
  assert.equal(f.calls.length, 1);
  f.get("[data-refresh]").click();
  finish(sample);
  await turn();
  assert.equal(f.calls.length, 2);
  assert.match(f.get("dl").textContent, /16 MiB/);
  assert.equal(
    [...f.get("dl").querySelectorAll("dd")].filter(
      (el) => el.textContent === "Unavailable",
    ).length,
    2,
  );
  f.window.dispatchEvent(new f.window.Event("pagehide"));
  await turn();
  assert.equal(f.calls.length, 2);
  assert.equal(f.get("dl").textContent, "");
});

async function measureMemory(overrides) {
  const f = fixture(() => ({ ...sample, ...overrides }));
  f.openResources(true);
  f.get("[data-refresh]").click();
  await turn();
  return {
    rows: Object.fromEntries(
      [...f.get("dl").querySelectorAll("dt")].map((term) => [
        term.textContent,
        term.nextElementSibling.textContent,
      ]),
    ),
    scope: f.get(".support-help").textContent,
  };
}

test("Windows reports dedicated and shared WebViews separately and never substitutes host working set", async () => {
  const { rows, scope } = await measureMemory({
    mainResidentBytes: 99 * 1024 ** 2,
    mainPrivateResidentBytes: null,
    appWebviewPrivateResidentBytes: null,
    serviceWebviewPrivateResidentBytes: 12 * 1024 ** 2,
    sharedWebviewPrivateResidentBytes: 7 * 1024 ** 2,
  });
  assert.equal(rows["Main process private RAM"], "Unavailable");
  assert.equal(rows["Dedicated interface WebView RAM"], "Unavailable");
  assert.equal(rows["Dedicated service WebView RAM"], "12 MiB");
  assert.equal(rows["Shared WebView profile RAM"], "7 MiB");
  assert.equal(
    Object.values(rows).filter((value) => value === "7 MiB").length,
    1,
  );
  assert.ok(!Object.values(rows).includes("99 MiB"));
  assert.match(scope, /same WebView profile.*counts all its processes once/);
  const withoutShared = await measureMemory({
    serviceWebviewPrivateResidentBytes: 0,
    sharedWebviewPrivateResidentBytes: null,
  });
  assert.equal(withoutShared.rows["Dedicated service WebView RAM"], "0 MiB");
  assert.equal(withoutShared.rows["Shared WebView profile RAM"], undefined);
  const sharedZero = await measureMemory({
    sharedWebviewPrivateResidentBytes: 0,
  });
  assert.equal(sharedZero.rows["Shared WebView profile RAM"], "0 MiB");
});

test("macOS and Linux preserve the host resident measurement and its scope", async () => {
  for (const os of ["macos", "linux"]) {
    const { rows, scope } = await measureMemory({
      os,
      mainResidentBytes: 40 * 1024 ** 2,
    });
    assert.equal(rows["Main process memory"], "40 MiB");
    assert.equal(rows["Main process private RAM"], undefined);
    assert.equal(rows["Dedicated service WebView RAM"], undefined);
    assert.match(scope, /Resident memory includes shared pages/);
  }
});

test("a hidden document neither starts a sample nor receives the result of an earlier one", async () => {
  let finish;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let hidden = false;
  Object.defineProperty(f.document, "hidden", { get: () => hidden });
  f.openResources(true);
  f.get("[data-refresh]").click();
  hidden = true;
  f.document.dispatchEvent(new f.window.Event("visibilitychange"));
  assert.equal(f.get("details").open, false);
  f.openResources(true);
  f.get("[data-refresh]").click();
  assert.equal(f.calls.length, 1);
  hidden = false;
  f.document.dispatchEvent(new f.window.Event("visibilitychange"));
  finish(sample);
  await turn();
  assert.equal(f.calls.length, 1);
  assert.equal(f.get("dl").textContent, "");
});

test("Markdown projects explicit environment fields and redacts sensitive narratives", () => {
  const f = fixture();
  const text =
    "Window closes\nCookie: sid=privateCookie; other=hidden\nAuthorization: Basic cDp3\nhttps://private.invalid/path?token=privateToken\nalice@private.invalid\nC:\\Users\\Alice Smith\\report\n/home/alice/report\nUser ID: private-user\napi_key=personalsecret\nhttps%253A%252F%252Fexample.net%252Fsecret\n-----BEGIN PRIVATE KEY-----\nshortword\n-----END PRIVATE KEY-----\n@privateperson";
  const report = f.api.makeProblemReport(text, "Switch theme", sample);
  assert.match(report, /Window closes/);
  assert.match(report, /Switch theme/);
  assert.match(report, /Discord, Mattermost/);
  assert.match(report, /142\.0\.3595\.65/);
  assert.doesNotMatch(
    report,
    /private|shortword|Alice|home\/alice|personalsecret|example\.net|username|conversation|unknown|https/i,
  );
  assert.equal(
    f.api.redactNarrative("Authorization:\nshort-personal-value"),
    "[redacted]",
  );
  const poisoned = f.api.makeProblemReport("Test", "", {
    ...sample,
    os: "/home/private",
    architecture: "secret",
    webviewVersion: "untrusted/secret",
    version: "<unsafe>",
  });
  assert.doesNotMatch(poisoned, /private|secret|unsafe|untrusted/);
  for (const text of [
    "Open %USERPROFILE%/private",
    "See fixtures/private.txt",
    "Alice: private conversation",
    "> private conversation",
  ]) {
    assert.doesNotMatch(f.api.redactNarrative(text), /private|Alice/);
  }
  assert.match(
    f.api.makeProblemReport("Test", "", {
      ...sample,
      webviewVersion: "142.0.3595.65 dev",
    }),
    /142\.0\.3595\.65 dev/,
  );
  assert.doesNotMatch(
    f.api.makeProblemReport("Issue", ""),
    /Environment|runtime|Enabled service/,
  );
});

test("export and clipboard use the reviewed Markdown; the bug form receives only its fixed destination", async () => {
  const f = fixture((cmd) =>
    cmd === "export_problem_report" ? "ChatPlus-report.md" : sample,
  );
  f.get("[data-report]").click();
  assert.equal(f.get("[data-review]").disabled, true);
  assert.equal(f.get("[data-export]").hidden, true);
  f.get("[data-export]").click();
  f.get("[data-copy]").click();
  f.get("[data-issues]").click();
  assert.equal(f.calls.length, 0);
  const description = f.get("#problem-description");
  description.value = "Window closes\nCookie: secret-cookie";
  f.input(description);
  f.get("[data-review]").click();
  await turn();
  const preview = f.get("#problem-preview");
  assert.equal(f.calls.length, 0);
  assert.match(preview.value, /Window closes/);
  assert.doesNotMatch(preview.value, /secret-cookie/);
  assert.equal(preview.selectionStart, 0);
  assert.equal(f.get("[data-export]").hidden, false);
  f.get("[data-edit]").click();
  assert.equal(preview.value, "");
  f.get("#report-include").checked = true;
  f.get("[data-review]").click();
  await turn();
  assert.match(preview.value, /## Environment/);
  f.get("[data-export]").click();
  await turn();
  assert.match(f.get("[data-status]").textContent, /Downloads/);
  f.get("[data-copy]").click();
  await turn();
  assert.match(f.get("[data-status]").textContent, /Report copied/);
  f.get("[data-issues]").click();
  await turn();
  f.get("[data-issues]").click();
  assert.deepEqual(f.calls, [
    ["get_report_environment", undefined],
    ["export_problem_report", { report: preview.value }],
    ["copy_problem_report", { report: preview.value }],
    ["copy_problem_report", { report: preview.value }],
    ["open_project_link", { link: "bug-report" }],
  ]);
  assert.match(f.get("[data-status]").textContent, /Paste the report/);
  f.get("[data-close]").click();
  assert.equal(f.get("dialog"), null);
});

async function reviewedReport(onInvoke) {
  const f = fixture(onInvoke);
  f.get("[data-report]").click();
  const description = f.get("#problem-description");
  description.value =
    "The dialog closes unexpectedly.\nhttps://private.invalid/?token=secret-value";
  f.input(description);
  f.get("[data-review]").click();
  await turn();
  return f;
}

test("unavailable clipboard selects the preview and leaves opening the issue form to a second explicit click", async () => {
  const f = await reviewedReport((cmd) => {
    if (cmd === "copy_problem_report") throw Error("Clipboard unavailable");
  });
  const primary = f.get("[data-issues]");
  primary.click();
  await turn();
  const preview = f.get("#problem-preview");
  assert.equal(preview.selectionStart, 0);
  assert.equal(preview.selectionEnd, preview.value.length);
  assert.match(f.get("[data-status]").textContent, /selected report manually/);
  assert.equal(primary.textContent, "Open issue form");
  assert.deepEqual(f.calls, [
    ["copy_problem_report", { report: preview.value }],
  ]);
  primary.click();
  await turn();
  assert.deepEqual(f.calls[1], ["open_project_link", { link: "bug-report" }]);
  assert.equal(primary.disabled, true);
});

test("a failed browser launch preserves the successful copy and retries opening without copying again", async () => {
  let attempts = 0;
  const f = await reviewedReport((cmd) => {
    if (cmd === "open_project_link" && ++attempts === 1)
      throw Error("No browser");
  });
  const primary = f.get("[data-issues]");
  primary.click();
  primary.click();
  await turn();
  assert.match(f.get("[data-status]").textContent, /Report copied\..*browser/i);
  assert.equal(primary.textContent, "Open issue form");
  primary.click();
  await turn();
  assert.equal(attempts, 2);
  assert.equal(
    f.calls.filter(([command]) => command === "copy_problem_report").length,
    1,
  );
  assert.equal(primary.disabled, true);
});

test("closing or editing during clipboard access prevents a late browser launch for the obsolete preview", async () => {
  for (const action of ["[data-edit]", "[data-close]"]) {
    let finish;
    const f = await reviewedReport(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.get("[data-issues]").click();
    f.get("[data-issues]").click();
    f.get("[data-copy]").click();
    f.get(action).click();
    finish();
    await turn();
    assert.deepEqual(
      f.calls.map(([cmd]) => cmd),
      ["copy_problem_report"],
    );
  }
});

test("changing the draft or closing during a requested report snapshot invalidates its preview", async () => {
  let finish;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.get("[data-report]").click();
  const description = f.get("#problem-description");
  description.value = "First";
  f.input(description);
  f.get("#report-include").checked = true;
  f.get("[data-review]").click();
  description.value = "Second";
  f.input(description);
  finish(sample);
  await turn();
  assert.equal(f.get("#problem-preview").value, "");
  f.get("[data-review]").click();
  f.get("[data-close]").click();
  finish(sample);
  await turn();
  assert.equal(f.get("dialog"), null);
  assert.deepEqual(
    f.calls.map((row) => row[0]),
    ["get_report_environment", "get_report_environment"],
  );
});
