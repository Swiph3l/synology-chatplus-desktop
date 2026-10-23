export interface ProviderUnreadSnapshot {
  hasUnread: boolean | null;
  count: number | null;
  unreadScope?: "direct-messages";
  unattributedUnread?: boolean;
  conversations?: Array<{
    id: string;
    hasUnread: boolean;
    count?: number | null;
  }>;
  currentConversation?: string | null;
}

export interface ProviderNotification {
  tag: string;
  title?: string;
  arrival?: number;
}

export interface ProviderUnreadAdapter {
  source:
    | "chatplus-dom"
    | "synology-chat-dom"
    | "discord-dom"
    | "whatsapp-dom"
    | "messenger-dom"
    | "mattermost-dom";
  snapshot(): ProviderUnreadSnapshot;
  observe(changed: () => void): () => void;
  readContext(): string | null;
  contentContext(): string | null;
  interactionContext(event: Event): string | null;
  providerUnreadZero?(): boolean;
  providerAllUnreadZero?(): boolean;
  tracksNotificationArrivals?: boolean;
  onReadAccepted?(arrivals: number[], completeThrough?: number): void;
  onNotificationObserved?(notification: ProviderNotification): void;
  isViewingNotification(notification: ProviderNotification): boolean;
  onHostForegroundChanged?(
    foreground: boolean,
    generation?: number,
    incomingSequence?: number,
  ): void;
  readAllStep?(operation: string): import("./discord-read").InboxReadStatus;
}
