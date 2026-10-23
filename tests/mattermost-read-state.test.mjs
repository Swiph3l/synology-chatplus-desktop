import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["src/theme/providers/mattermost-read-state.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { verifyMattermostReadZero } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

const opaque = (value) => value.toString(36).padStart(26, "0");
const teamA = opaque(5001);
const teamB = opaque(5002);
const user = opaque(9001);
const mentions = [
  "mention_count",
  "mention_count_root",
  "urgent_mention_count",
];
const teamCounters = [
  "msg_count",
  "msg_count_root",
  "mention_count",
  "mention_count_root",
  "thread_count",
  "thread_mention_count",
  "thread_urgent_mention_count",
];

function member(number) {
  return {
    channel_id: opaque(number),
    user_id: user,
    msg_count: 12,
    msg_count_root: 9,
    mention_count: 0,
    mention_count_root: 0,
    urgent_mention_count: 0,
    notify_props: { mark_unread: "all" },
  };
}

function channel(number, team = teamA, type = "O") {
  return {
    id: opaque(number),
    team_id: team,
    type,
    delete_at: 0,
    total_msg_count: 12,
    total_msg_count_root: 9,
    header: "Synthetic ignored header",
    purpose: "Synthetic ignored purpose",
  };
}

function team(id) {
  return {
    team_id: id,
    ...Object.fromEntries(teamCounters.map((field) => [field, 0])),
  };
}

function response(value, url, options = {}) {
  const result = new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...options,
  });
  Object.defineProperty(result, "url", { value: url.href });
  return result;
}

function fixture(options = {}) {
  const members = options.members ?? [
    member(1),
    member(2),
    member(3),
    member(4),
  ];
  const channels = options.channels ?? [
    channel(1),
    channel(2, teamB, "P"),
    channel(3, "", "D"),
    channel(4, "", "G"),
  ];
  const firstTeams = options.firstTeams ?? [team(teamA), team(teamB)];
  const secondTeams = options.secondTeams ?? [team(teamB), team("")];
  const config = options.config ?? { Version: "11.7.2" };
  const license = options.license ?? {
    IsLicensed: "false",
    CompanyName: "Synthetic ignored company",
  };
  const controller = new AbortController();
  const calls = [];
  const fetch = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    let value;
    if (url.pathname.endsWith("/config/client")) value = config;
    else if (url.pathname.endsWith("/license/client")) value = license;
    else if (url.pathname.endsWith("/channel_members")) {
      const page = Number(url.searchParams.get("page"));
      value = options.page
        ? options.page(page)
        : members.slice(page * 200, (page + 1) * 200);
    } else if (url.pathname.endsWith("/channels")) value = channels;
    else if (url.pathname.endsWith("/teams/unread"))
      value = url.searchParams.has("exclude_team") ? secondTeams : firstTeams;
    else assert.fail("Unexpected endpoint");
    return (
      (await options.respond?.({ url, init, value, calls, controller })) ??
      response(value, url)
    );
  };
  return {
    calls,
    controller,
    members,
    channels,
    firstTeams,
    secondTeams,
    config,
    license,
    run: () =>
      verifyMattermostReadZero({
        base: new URL(options.base ?? "https://mattermost.example.test/chat/"),
        fetch,
        signal: controller.signal,
      }),
  };
}

test("complete metadata proves zero across teams, muted channels, direct/group messages and followed threads", async () => {
  const f = fixture();
  f.members[2].notify_props.mark_unread = "mention";
  assert.equal(await f.run(), true);
  assert.deepEqual(
    f.calls.map(({ url }) => url.pathname),
    [
      "config/client",
      "license/client",
      "users/me/channel_members",
      "users/me/channels",
      "users/me/teams/unread",
      "users/me/teams/unread",
      "config/client",
      "license/client",
    ].map((part) => `/chat/api/v4/${part}`),
  );
  assert.equal(f.calls[0].url.search, "?format=old");
  assert.equal(f.calls[1].url.search, "?format=old");
  assert.equal(f.calls[2].url.search, "?page=0&per_page=200");
  assert.equal(f.calls[4].url.search, "?include_collapsed_threads=true");
  assert.equal(f.calls[5].url.searchParams.get("exclude_team"), teamA);
  for (const { init } of f.calls) {
    assert.deepEqual(Object.keys(init).sort(), [
      "cache",
      "credentials",
      "method",
      "redirect",
      "signal",
    ]);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(init.signal, f.controller.signal);
  }
});

test("configured subpaths are preserved with or without a trailing slash", async () => {
  const f = fixture({
    base: "https://mattermost.example.test/deployment/nested",
  });
  assert.equal(await f.run(), true);
  assert.ok(
    f.calls.every(({ url }) =>
      url.href.startsWith(
        "https://mattermost.example.test/deployment/nested/api/v4/",
      ),
    ),
  );
});

test("only the exact audited server version reaches authenticated count endpoints", async () => {
  for (const Version of [
    undefined,
    null,
    "",
    "11.7.1",
    "11.7.2-custom",
    "11.8.0",
    11.72,
  ]) {
    const f = fixture({ config: { Version } });
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls[0].url.pathname.endsWith("/config/client"));
  }
});

test("licensed, missing or malformed license metadata cannot admit replica-backed read zeros", async () => {
  for (const IsLicensed of [undefined, null, "", "true", "FALSE", false, 0]) {
    const f = fixture({ license: { IsLicensed } });
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(({ url }) => !url.pathname.includes("/users/me/")));
  }
});

test("license or version changes after count collection invalidate an otherwise complete zero", async () => {
  for (const changed of ["license", "version"]) {
    const config = { Version: "11.7.2" };
    const license = { IsLicensed: "false" };
    const f = fixture({
      config,
      license,
      respond({ url }) {
        if (
          url.pathname.endsWith("/teams/unread") &&
          url.searchParams.has("exclude_team")
        ) {
          if (changed === "license") license.IsLicensed = "true";
          else config.Version = "11.8.0";
        }
      },
    });
    assert.equal(await f.run(), null);
    assert.ok(f.calls.some(({ url }) => url.searchParams.has("exclude_team")));
    assert.equal(
      f.calls.filter(({ url }) => url.pathname.endsWith("/config/client"))
        .length,
      2,
    );
    assert.equal(f.calls.length, changed === "license" ? 8 : 7);
  }
});

test("a failed final license check cannot reuse the earlier unlicensed response", async () => {
  const f = fixture({
    respond({ url, value, calls }) {
      if (url.pathname.endsWith("/license/client") && calls.length > 2)
        return response(value, url, { status: 500 });
    },
  });
  assert.equal(await f.run(), null);
  assert.equal(f.calls.length, 8);
});

for (const [name, change] of [
  [
    "muted direct message",
    (f) => {
      f.members[2].notify_props.mark_unread = "mention";
      f.channels[2].total_msg_count += 1;
    },
  ],
  [
    "muted group message",
    (f) => {
      f.members[3].notify_props.mark_unread = "mention";
      f.channels[3].total_msg_count += 1;
    },
  ],
  ["reply without a new root", (f) => (f.channels[0].total_msg_count += 1)],
  [
    "root count despite matching total",
    (f) => (f.channels[0].total_msg_count_root += 1),
  ],
  ["member ahead of server metadata", (f) => (f.members[0].msg_count += 1)],
]) {
  test(`${name} cannot become zero even when every aggregate unread counter is zero`, async () => {
    const f = fixture();
    change(f);
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 4);
  });
}

for (const field of mentions) {
  test(`member ${field} prevents a clear independently of message totals`, async () => {
    const f = fixture();
    f.members[0][field] = 1;
    assert.equal(await f.run(), null);
  });
}

for (const field of teamCounters) {
  test(`team and DM ${field} are both checked, including followed-thread state`, async () => {
    for (const group of ["firstTeams", "secondTeams"]) {
      const f = fixture();
      f[group].at(-1)[field] = 1;
      assert.equal(await f.run(), null);
    }
  });
}

for (const [name, change] of [
  ["missing direct/group aggregate", (f) => f.secondTeams.pop()],
  ["missing other team", (f) => f.firstTeams.pop()],
  ["duplicate team", (f) => (f.firstTeams[1] = team(teamA))],
  ["unexpected first-response DM group", (f) => f.firstTeams.push(team(""))],
  ["excluded team returned again", (f) => (f.secondTeams[0] = team(teamA))],
  ["missing membership", (f) => f.members.pop()],
  ["missing channel", (f) => f.channels.pop()],
  [
    "archived membership absent from live list",
    (f) => f.members.push(member(8)),
  ],
  ["duplicate channel", (f) => (f.channels[1] = { ...f.channels[0] })],
  [
    "different channel with same counters",
    (f) => (f.channels[1].id = opaque(88)),
  ],
  ["mixed authenticated users", (f) => (f.members[1].user_id = opaque(77))],
  [
    "archived channel unexpectedly present",
    (f) => (f.channels[0].delete_at = 100),
  ],
  ["direct channel with a team ID", (f) => (f.channels[2].team_id = teamA)],
  ["unknown channel kind", (f) => (f.channels[0].type = "unknown")],
]) {
  test(`${name} remains unknown instead of assuming an empty scope`, async () => {
    const f = fixture();
    change(f);
    assert.equal(await f.run(), null);
  });
}

test("required numeric metadata rejects missing, string, negative, fractional and unsafe counts", async () => {
  for (const value of [undefined, "0", -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    for (const location of ["member", "channel", "team"]) {
      const f = fixture();
      if (location === "member") f.members[0].msg_count_root = value;
      else if (location === "channel") f.channels[0].total_msg_count = value;
      else f.secondTeams[1].thread_count = value;
      assert.equal(await f.run(), null);
    }
  }
});

test("full membership pages require an explicit terminal page before channel totals are fetched", async () => {
  for (const size of [200, 201]) {
    const members = Array.from({ length: size }, (_, index) =>
      member(index + 1),
    );
    const f = fixture({
      members,
      channels: members.map((_, index) => channel(index + 1)),
      firstTeams: [team(teamA)],
      secondTeams: [],
    });
    assert.equal(await f.run(), true);
    assert.deepEqual(
      f.calls.slice(2, 4).map(({ url }) => url.searchParams.get("page")),
      ["0", "1"],
    );
    assert.ok(f.calls[4].url.pathname.endsWith("/channels"));
  }
});

test("duplicate or skipped membership pages never prove a complete account", async () => {
  const members = Array.from({ length: 201 }, (_, index) => member(index + 1));
  for (const page of [
    (index) => (index === 0 ? members.slice(0, 200) : [members[0]]),
    (index) => (index === 0 ? members.slice(0, 200) : []),
  ]) {
    const f = fixture({
      members,
      channels: members.map((_, index) => channel(index + 1)),
      page,
    });
    assert.equal(await f.run(), null);
  }
});

test("twenty full pages reach the bound without requesting an unbounded extra page", async () => {
  const f = fixture({
    page: (page) =>
      Array.from({ length: 200 }, (_, index) => member(page * 200 + index + 1)),
  });
  assert.equal(await f.run(), null);
  assert.equal(f.calls.length, 22);
  assert.ok(
    f.calls
      .slice(2)
      .every(({ url }) => url.pathname.endsWith("/channel_members")),
  );
});

test("new totals after the earlier membership snapshot cannot match an old read zero", async () => {
  const f = fixture({
    respond({ url, value }) {
      if (url.pathname.endsWith("/channels")) {
        const changed = structuredClone(value);
        changed[0].total_msg_count += 1;
        changed[0].total_msg_count_root += 1;
        return response(changed, url);
      }
    },
  });
  assert.equal(await f.run(), null);
});

test("no joined team or no memberships is not a vacuous complete zero", async () => {
  for (const options of [
    { members: [], channels: [] },
    { members: [member(1)], channels: [channel(1, "", "D")] },
  ])
    assert.equal(await fixture(options).run(), null);
});

test("credential-bearing or non-web base URLs are rejected before any request", async () => {
  for (const base of [
    "https://user:password@mattermost.example.test/",
    "https://mattermost.example.test/?access_token=synthetic",
    "https://mattermost.example.test/#session",
    "file:///C:/example/",
  ]) {
    const f = fixture({ base });
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 0);
  }
});

for (const status of [401, 403, 429, 500]) {
  test(`HTTP ${status} remains unknown`, async () => {
    const f = fixture({
      respond: ({ url, value }) => response(value, url, { status }),
    });
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 1);
  });
}

test("a failed later page and truncated server JSON cannot manufacture completeness", async () => {
  for (const failed of ["page", "channels"]) {
    const members = Array.from({ length: 200 }, (_, index) =>
      member(index + 1),
    );
    const f = fixture({
      members,
      respond({ url, value }) {
        if (failed === "page" && url.searchParams.get("page") === "1")
          return response(value, url, { status: 500 });
        if (failed === "channels" && url.pathname.endsWith("/channels"))
          return new Response('[{"id":', {
            headers: { "content-type": "application/json" },
          });
      },
    });
    assert.equal(await f.run(), null);
  }
});

test("redirects, mismatched response URLs, wrong content types and oversized declarations are rejected", async () => {
  for (const kind of ["redirect", "url", "mime", "size"]) {
    const f = fixture({
      respond({ url, value }) {
        const result = response(
          value,
          kind === "url" ? new URL("https://other.example.test/") : url,
          kind === "mime"
            ? { headers: { "content-type": "text/html" } }
            : kind === "size"
              ? {
                  headers: {
                    "content-type": "application/json",
                    "content-length": String(4 * 1024 * 1024 + 1),
                  },
                }
              : {},
        );
        if (kind === "redirect")
          Object.defineProperty(result, "redirected", { value: true });
        return result;
      },
    });
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 1);
  }
});

test("the streamed byte cap cancels an oversized response even without a Content-Length", async () => {
  let cancelled = false;
  const f = fixture({
    respond() {
      let chunks = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (chunks++ < 6)
              controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
            else controller.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.equal(await f.run(), null);
  assert.equal(cancelled, true);
});

test("pre-abort, interrupted streaming and abort at the final response remain unknown", async () => {
  const before = fixture();
  before.controller.abort();
  assert.equal(await before.run(), null);
  assert.equal(before.calls.length, 0);

  let cancelled = false;
  const waiting = fixture({
    respond: () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  const pending = waiting.run();
  await new Promise(setImmediate);
  waiting.controller.abort();
  assert.equal(await pending, null);
  assert.equal(cancelled, true);

  const late = fixture({
    respond({ calls, controller }) {
      if (calls.length === 8) controller.abort();
    },
  });
  assert.equal(await late.run(), null);
});

test("malformed roots, invalid UTF-8 and response stream errors are unknown", async () => {
  for (const respond of [
    ({ url }) => response({}, url),
    ({ url }) => response(["not a membership"], url),
    () =>
      new Response(new Uint8Array([255]), {
        headers: { "content-type": "application/json" },
      }),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("Synthetic stream failure"));
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  ])
    assert.equal(await fixture({ respond }).run(), null);
});

test("transport failures cannot escape as a successful or unhandled result", async () => {
  const f = fixture({
    respond() {
      throw new Error("Synthetic connectivity failure");
    },
  });
  assert.equal(await f.run(), null);
  assert.equal(f.calls.length, 1);
});
