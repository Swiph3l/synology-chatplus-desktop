import { invoke } from "@tauri-apps/api/core";
export interface NotificationPermission {
  webviewState: string;
  granted: boolean;
  state: "enabled" | "blocked" | "not-registered" | "unavailable";
  bridgeAvailable: boolean;
  message: string;
}
export const notifications = {
  openSettings: () => invoke<void>("open_notification_settings"),
  sendTest: (sound: boolean) =>
    invoke<void>("send_test_notification", { sound }),
  isPermissionGranted: () =>
    invoke<NotificationPermission>("get_notification_permission"),
  requestPermission: () =>
    invoke<NotificationPermission>("request_notification_permission"),
};
