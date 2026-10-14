import type { ProviderUnreadAdapter } from "./types";

// Swiph3l: Messenger now uses Facebook's messages surface. No authenticated current DOM
// has been audited. Generic Facebook navigation badges, contact labels, title
// counters and virtualized row absence cannot establish Messenger unread state.
// Real browser Notification events remain authoritative arrival evidence through
// the shared native coordinator; this adapter never manufactures a DOM signal.
export function createMessengerAdapter(
  _document: Document,
): ProviderUnreadAdapter {
  return {
    source: "messenger-dom",
    snapshot: () => ({
      hasUnread: null,
      count: null,
      conversations: [],
      currentConversation: null,
    }),
    providerUnreadZero: () => false,
    readContext: () => null,
    contentContext: () => null,
    interactionContext: () => null,
    isViewingNotification: () => false,
    observe: () => () => {},
  };
}
