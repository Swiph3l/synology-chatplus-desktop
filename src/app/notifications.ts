import { invoke } from "@tauri-apps/api/core";
export interface NotificationPermission {
  granted: boolean;
  state: "granted" | "denied";
  bridgeAvailable: boolean;
  message: string;
}
export const notifications = {
  isPermissionGranted: () =>
    invoke<NotificationPermission>("get_notification_permission"),
  requestPermission: () =>
    invoke<NotificationPermission>("request_notification_permission"),
};
