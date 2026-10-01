export type ProviderId =
  "synology-chatplus" | "synology-chat" | "slack" | "discord";
export interface ServiceConfig {
  id: string;
  provider: ProviderId;
  name: string;
  url: string;
  enabled: boolean;
  notifications: boolean;
}
export const providers = {
  "synology-chatplus": {
    name: "ChatPlus",
    icon: "CP",
    experimental: false,
    urlMode: "server",
    urlLabel: "Server URL",
    defaultUrl: "",
  },
  "synology-chat": {
    name: "Synology Chat",
    icon: "SC",
    experimental: true,
    urlMode: "server",
    urlLabel: "Server URL",
    defaultUrl: "",
  },
  slack: {
    name: "Slack",
    icon: "S",
    experimental: true,
    urlMode: "workspace",
    urlLabel: "Workspace URL",
    defaultUrl: "https://app.slack.com/",
  },
  discord: {
    name: "Discord",
    icon: "D",
    experimental: true,
    urlMode: "fixed",
    urlLabel: "",
    defaultUrl: "https://discord.com/app/",
  },
} as const;
