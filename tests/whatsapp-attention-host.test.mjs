import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

const built = await build({
  entryPoints: ["src/theme/provider-unread.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "attentionHost",
});
let nextEpoch = 0;

function fixture({ crypto = true, fail = false } = {}) {
  const tasks = [],
    messages = [],
    listeners = new Map();
  let value = 2,
    changed,
    failed = fail;
  const host = {
    chrome: {
      webview: {
        postMessage(message) {
          if (failed) throw new Error("revoked bridge");
          messages.push(JSON.parse(message));
        },
      },
    },
  };
  const document = {
    visibilityState: "hidden",
    hasFocus: () => false,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
  };
  const context = {
    queueMicrotask: (callback) => tasks.push(callback),
    KeyboardEvent: class {},
    ...(crypto
      ? {
          crypto: {
            randomUUID: () =>
              `00000000-0000-4000-8000-${String(++nextEpoch).padStart(12, "0")}`,
          },
        }
      : {}),
  };
  runInNewContext(built.outputFiles[0].text, context);
  const stop = context.attentionHost.installUnreadAdapter(
    {
      source: "whatsapp-dom",
      tracksNotificationArrivals: false,
      snapshot: () => ({
        hasUnread: value === null ? null : value > 0,
        count: value,
        unreadScope: "notification-attention",
      }),
      observe(callback) {
        changed = callback;
        return () => {};
      },
      readContext: () => null,
      contentContext: () => null,
      interactionContext: () => null,
      isViewingNotification: () => false,
    },
    document,
    host,
  );
  const flush = () => {
    while (tasks.length) tasks.shift()();
  };
  flush();
  return {
    host,
    document,
    listeners,
    messages,
    stop,
    flush,
    rows: () => messages.filter((row) => row.chatplusUnread === 1),
    value(next) {
      value = next;
      changed();
      flush();
    },
    fail(next) {
      failed = next;
    },
  };
}

test("WhatsApp counter observations publish in background without any global read proof", (t) => {
  const f = fixture();
  t.after(f.stop);
  f.value(0);
  f.value(null);
  const rows = f.rows();
  assert.deepEqual(
    rows.map((row) => row.hasUnread),
    [true, false, null],
  );
  assert.equal(rows[0].count, 2);
  assert.equal(rows[1].count, null);
  assert.ok(
    rows.every(
      (row) =>
        row.certainty === "unknown" &&
        row.unreadScope === "notification-attention",
    ),
  );
  assert.ok(
    rows.every(
      (row) => row.observationEpoch === f.host.__chatplusUnreadObservationEpoch,
    ),
  );
  assert.ok(
    rows.every((row) =>
      [
        "acknowledgement",
        "readArrivals",
        "proofOnly",
        "readScope",
        "currentConversation",
        "conversations",
        "unattributedUnread",
      ].every((key) => !(key in row)),
    ),
  );
  assert.ok(
    rows.every(
      (row, index) =>
        index === 0 || row.providerRevision > rows[index - 1].providerRevision,
    ),
  );
});

test("fresh native boundaries republish an unchanged official counter after local Read all", (t) => {
  const f = fixture();
  t.after(f.stop);
  f.host.__chatplusSetForeground(false, 1, 1);
  f.flush();
  f.host.__chatplusAcknowledgeAllLocal(1);
  const before = f.rows().at(-1);
  f.host.__chatplusSetForeground(false, 2, 2);
  f.flush();
  const after = f.rows().at(-1);
  assert.equal(after.count, before.count);
  assert.ok(after.providerRevision > before.providerRevision);
  const length = f.rows().length;
  f.host.__chatplusSetForeground(false, 2, 2);
  f.flush();
  assert.equal(
    f.rows().length,
    length,
    "duplicate boundary remains deduplicated",
  );
});

test("an early notification query rechecks attention without retaining arrival read tokens", (t) => {
  const f = fixture();
  t.after(f.stop);
  const before = f.rows().at(-1).providerRevision;
  assert.equal(
    f.host.__chatplusIsViewingNotification({
      tag: "opaque-private-tag",
      arrival: 8,
    }),
    false,
  );
  f.flush();
  assert.ok(f.rows().at(-1).providerRevision > before);
  assert.doesNotMatch(
    JSON.stringify(f.rows()),
    /opaque-private-tag|readArrivals/,
  );
});

test("failed attention transport retries and unavailable document identity stays unknown", (t) => {
  const f = fixture({ fail: true });
  t.after(f.stop);
  assert.equal(f.rows().length, 0);
  f.fail(false);
  f.value(2);
  assert.equal(f.rows().length, 1);
  const unavailable = fixture({ crypto: false });
  t.after(unavailable.stop);
  unavailable.value(0);
  assert.equal(unavailable.rows().length, 0);
});

test("document epochs are isolated, immutable and cannot be replaced by page code", (t) => {
  const first = fixture(),
    second = fixture();
  t.after(first.stop);
  t.after(second.stop);
  assert.notEqual(
    first.host.__chatplusUnreadObservationEpoch,
    second.host.__chatplusUnreadObservationEpoch,
  );
  assert.throws(() =>
    Object.defineProperty(first.host, "__chatplusUnreadObservationEpoch", {
      value: "stale",
    }),
  );
  assert.throws(() => {
    first.host.__chatplusUnreadObservationEpoch = "stale";
  });
});

test("focus and service selection cannot invent a different official counter", (t) => {
  const f = fixture();
  t.after(f.stop);
  const before = f.rows().length;
  f.host.__chatplusSetForeground(true, 3, 0);
  f.flush();
  assert.equal(f.rows().length, before);
  f.host.__chatplusMarkCurrentRead();
  f.flush();
  assert.equal(f.rows().length, before);
  assert.equal(f.rows().at(-1).hasUnread, true);
});
