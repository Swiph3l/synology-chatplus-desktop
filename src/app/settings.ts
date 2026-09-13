import { invoke } from "@tauri-apps/api/core";
export type Theme = "system" | "light" | "dark";
export interface Settings {
  serverUrl: string;
  theme: Theme;
  autostart: boolean;
  minimizeToTray: boolean;
  closeToTray: boolean;
  externalLinks: boolean;
  automaticUpdates: boolean;
  updateChannel: "stable" | "pre-release";
  desktopNotifications: boolean;
  notificationPreview: "full" | "sender" | "generic";
  notificationSound: boolean;
  unreadTitle: boolean;
  unreadTray: boolean;
}
export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) =>
  invoke<void>("save_settings", { settings });
