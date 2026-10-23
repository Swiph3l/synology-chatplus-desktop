import type { ProviderUnreadAdapter } from "./types";

export interface ProviderReadCapabilities {
  current: "local" | "unsupported";
  all: "local" | "provider" | "unsupported";
}

// Swiph3l: Local acknowledgements and a verified public provider action have
// different semantics. Local all-read is an explicit acknowledgement of captured
// ChatPlus arrivals, independent of any provider DOM or server-side read support.
export function readCapabilities(
  source: ProviderUnreadAdapter["source"],
): ProviderReadCapabilities {
  return {
    current: source === "discord-dom" ? "local" : "unsupported",
    all:
      source === "discord-dom"
        ? "provider"
        : [
              "chatplus-dom",
              "synology-chat-dom",
              "whatsapp-dom",
              "messenger-dom",
            ].includes(source)
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
