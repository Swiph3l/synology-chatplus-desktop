export interface ServiceUnreadState {
  hasUnread: boolean;
  generation?: number;
  source?: string | null;
  lastArrival?: number | null;
  lastReadEvidence?: number | null;
}

export interface UnreadSnapshot {
  revision: number;
  services: Record<string, ServiceUnreadState>;
  aggregate: ServiceUnreadState;
}

export function acceptUnreadSnapshot(
  current: UnreadSnapshot,
  incoming: UnreadSnapshot,
): UnreadSnapshot {
  // Swiph3l: Native events and startup IPC can arrive out of order; an older
  // snapshot must not resurrect a sidebar dot already cleared in the tray.
  return incoming.revision >= current.revision ? incoming : current;
}
