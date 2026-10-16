import type { ProviderUnreadAdapter } from "./types";

export interface ProviderReadCapabilities {
  current: "local" | "unsupported";
  all: "local" | "unsupported";
}

// Swiph3l: These are ChatPlus acknowledgements, never claims about server-side
// state. Unverified providers stay unavailable until safe UI read semantics are audited.
export function readCapabilities(
  source: ProviderUnreadAdapter["source"],
): ProviderReadCapabilities {
  return {
    current: source === "discord-dom" ? "local" : "unsupported",
    all: ["chatplus-dom", "synology-chat-dom", "discord-dom"].includes(source)
      ? "local"
      : "unsupported",
  };
}

export function currentReadArrivals(
  adapter: ProviderUnreadAdapter,
  arrivals: ReadonlyMap<
    number,
    Parameters<ProviderUnreadAdapter["isViewingNotification"]>[0] | null
  >,
): number[] {
  if (readCapabilities(adapter.source).current !== "local") return [];
  const context = adapter.readContext();
  const content = adapter.contentContext();
  if (context === null || content === null) return [];
  const read = [...arrivals]
    .filter(
      ([, notification]) =>
        notification && adapter.isViewingNotification(notification),
    )
    .map(([arrival]) => arrival);
  // Swiph3l: Provider route/root replacement during a query must not widen its scope.
  return adapter.readContext() === context &&
    adapter.contentContext() === content
    ? read
    : [];
}
