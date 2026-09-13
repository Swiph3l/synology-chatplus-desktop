import { invoke } from "@tauri-apps/api/core";
export interface UpdateSnapshot {
  configured: boolean;
  channel: "stable" | "pre-release";
  phase:
    | "idle"
    | "unconfigured"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  currentVersion: string;
  latestVersion: string | null;
  notes: string;
  downloaded: number;
  total: number | null;
  message: string;
  lastSuccessfulCheck: number | null;
}
export const updates = {
  getCurrentVersion: () => invoke<string>("get_current_version"),
  checkForUpdates: () => invoke<UpdateSnapshot>("check_for_updates"),
  getLatestVersion: () => invoke<string | null>("get_latest_version"),
  getState: () => invoke<UpdateSnapshot>("get_update_state"),
  downloadUpdate: () => invoke<void>("download_update"),
  cancelDownload: () => invoke<void>("cancel_update"),
  installUpdate: (confirmed: boolean) =>
    invoke<void>("install_update", { confirmed }),
  downloadAndInstall: (confirmed: boolean) =>
    invoke<void>("download_and_install", { confirmed }),
  openReleasePage: () => invoke<void>("open_release_page"),
  dismiss: () => invoke<void>("dismiss_update"),
};
