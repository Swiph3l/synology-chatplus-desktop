export type ProviderId = "synology-chatplus" | "synology-chat" | "slack";
export interface ServiceConfig {
  id: string;
  provider: ProviderId;
  name: string;
  url: string;
  enabled: boolean;
  notifications: boolean;
}
export const providers = {
  "synology-chatplus": { name: "ChatPlus", icon: "CP", experimental: false },
  "synology-chat": { name: "Synology Chat", icon: "SC", experimental: true },
  slack: { name: "Slack", icon: "S", experimental: true },
} as const;
