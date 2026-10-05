import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/app/unread.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { acceptUnreadSnapshot } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("the frontend mirror preserves complete authoritative snapshots through multi-service arrival and read transitions", () => {
  const snapshots = [
    { revision: 0, services: {}, aggregate: { hasUnread: false } },
    {
      revision: 1,
      services: { first: { hasUnread: true, generation: 1 } },
      aggregate: { hasUnread: true },
    },
    {
      revision: 2,
      services: {
        first: { hasUnread: true, generation: 1 },
        second: { hasUnread: true, generation: 1 },
      },
      aggregate: { hasUnread: true },
    },
    {
      revision: 3,
      services: {
        first: { hasUnread: false, generation: 2, lastReadEvidence: 123 },
        second: { hasUnread: true, generation: 1 },
      },
      aggregate: { hasUnread: true },
    },
    {
      revision: 4,
      services: {
        first: { hasUnread: false, generation: 2, lastReadEvidence: 123 },
        second: { hasUnread: false, generation: 2, lastReadEvidence: 456 },
      },
      aggregate: { hasUnread: false },
    },
  ];
  let mirrored = snapshots[0];
  for (const native of snapshots) {
    mirrored = acceptUnreadSnapshot(mirrored, native);
    assert.equal(mirrored, native, "mirror retains the native snapshot itself");
    assert.equal(
      mirrored.aggregate.hasUnread,
      Object.values(mirrored.services).some((state) => state.hasUnread),
      "aggregate/tray metadata matches the per-service/sidebar presentation",
    );
  }
  for (const stale of snapshots.slice(0, -1))
    assert.equal(acceptUnreadSnapshot(mirrored, stale), mirrored);
  assert.equal(mirrored.services.first.lastReadEvidence, 123);
  assert.equal(mirrored.services.second.lastReadEvidence, 456);
});
