import { invoke } from "@tauri-apps/api/core";
export interface NotificationPermission {
  webviewState: string;
  granted: boolean;
  state: "enabled" | "blocked" | "not-registered" | "unavailable";
  bridgeAvailable: boolean;
  message: string;
  authority?: "windows-native" | "native-plugin";
  lastSendSucceeded?: boolean | null;
}
export const notifications = {
  openSettings: () => invoke<void>("open_notification_settings"),
  sendTest: (sound: boolean) =>
    invoke<void>("send_test_notification", { sound }),
  isPermissionGranted: (serviceId?: string | null) =>
    invoke<NotificationPermission>("get_notification_permission", {
      serviceId,
    }),
  requestPermission: (serviceId?: string | null) =>
    invoke<NotificationPermission>("request_notification_permission", {
      serviceId,
    }),
};
