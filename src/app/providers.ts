export type ProviderId =
  "synology-chatplus" | "synology-chat" | "slack" | "discord" | "mattermost";
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
    notifications: true,
    urlMode: "server",
    urlLabel: "Server URL",
    defaultUrl: "",
  },
  "synology-chat": {
    name: "Synology Chat",
    icon: "SC",
    experimental: true,
    notifications: true,
    urlMode: "server",
    urlLabel: "Server URL",
    defaultUrl: "",
  },
  slack: {
    name: "Slack",
    icon: "S",
    experimental: true,
    notifications: false,
    urlMode: "workspace",
    urlLabel: "Workspace URL",
    defaultUrl: "https://app.slack.com/",
  },
  discord: {
    name: "Discord",
    icon: "D",
    experimental: true,
    notifications: true,
    urlMode: "fixed",
    urlLabel: "",
    defaultUrl: "https://discord.com/app/",
  },
  mattermost: {
    name: "Mattermost",
    icon: "M",
    experimental: true,
    notifications: false,
    urlMode: "server",
    urlLabel: "Server URL",
    defaultUrl: "",
  },
} as const;
