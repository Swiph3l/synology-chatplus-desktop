export interface ProviderUnreadSnapshot {
  hasUnread: boolean | null;
  count: number | null;
}

export interface ProviderNotification {
  tag: string;
  title?: string;
  arrival?: number;
}

export interface ProviderUnreadAdapter {
  source: "chatplus-dom" | "synology-chat-dom" | "discord-dom";
  snapshot(): ProviderUnreadSnapshot;
  observe(changed: () => void): () => void;
  readContext(): string | null;
  contentContext(): string | null;
  interactionContext(event: Event): string | null;
  providerUnreadZero?(): boolean;
  isViewingNotification(notification: ProviderNotification): boolean;
  onHostForegroundChanged?(foreground: boolean): void;
}
