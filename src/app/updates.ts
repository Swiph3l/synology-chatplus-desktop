import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
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
  messageCode: string;
  lastSuccessfulCheck: number | null;
}
export function updateStatusText(state: UpdateSnapshot): string {
  switch (state.phase) {
    case "checking":
      return t("updates.footer.checking");
    case "current":
      return t("updates.footer.current");
    case "available":
      return t("updates.footer.available", {
        version: state.latestVersion || state.currentVersion,
      });
    case "downloading":
      return t("updates.footer.downloading");
    case "ready":
      return t("updates.footer.ready");
    case "installing":
      return t("updates.footer.installing");
    case "error":
      return t("updates.footer.error");
    default:
      return "";
  }
}
export function updateMessage(state: UpdateSnapshot): string {
  switch (state.messageCode || state.phase) {
    case "checking":
      return t("updates.status.checking");
    case "current":
      return t("updates.status.current");
    case "available":
      return t("updates.status.available");
    case "unconfigured":
      return t("updates.status.unconfigured");
    case "channel-changed":
      return t("updates.status.channelChanged");
    case "check-failed":
      return t("updates.status.checkFailed");
    case "metadata-invalid":
      return t("updates.status.metadataInvalid");
    case "downloading":
      return t("updates.status.downloading");
    case "ready":
      return t("updates.status.ready");
    case "cancelled":
      return t("updates.status.cancelled");
    case "download-failed":
      return t("updates.status.downloadFailed");
    case "installing":
      return t("updates.status.installing");
    case "install-failed":
      return t("updates.status.installFailed");
    case "error":
      return t("updates.failure");
    default:
      return "";
  }
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
