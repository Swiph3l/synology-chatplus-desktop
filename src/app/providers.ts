export type ProviderId =
  "synology-chatplus" | "synology-chat" | "slack" | "discord" | "mattermost";
export type NamedNotificationColor =
  | "auto"
  | "blue"
  | "cyan"
  | "green"
  | "amber"
  | "orange"
  | "red"
  | "purple"
  | "magenta";
// Custom colors cross the persistence boundary only after #rrggbb validation.
export type NotificationColor = NamedNotificationColor | `#${string}`;
export interface ServiceConfig {
  id: string;
  provider: ProviderId;
  name: string;
  url: string;
  enabled: boolean;
  notifications: boolean;
  notificationColor?: NotificationColor;
}
export interface ProviderDefinition {
  name: string;
  icon: string;
  experimental: boolean;
  notifications: boolean;
  urlMode: "server" | "workspace" | "fixed";
  urlLabel: string;
  defaultUrl: string;
  defaultNotificationColor?: Exclude<NotificationColor, "auto">;
}
export const providers = {
  "synology-chatplus": {
    name: "Synology ChatPlus",
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
} as const satisfies Record<ProviderId, ProviderDefinition>;

export function serviceSupportsNotifications(
  service: Pick<ServiceConfig, "id" | "provider" | "url">,
  fixtureServiceIds?: ReadonlySet<string>,
): boolean {
  if (providers[service.provider].notifications) return true;
  if (service.provider !== "mattermost" || !fixtureServiceIds?.has(service.id))
    return false;
  try {
    const url = new URL(service.url);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "17830" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
