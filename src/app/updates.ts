import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
export interface UpdateSnapshot {
  configured: boolean;
  includeBetaUpdates: boolean;
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
const failureCodes = new Set([
  "check-failed",
  "metadata-invalid",
  "release-unavailable",
  "rate-limited",
  "check-timeout",
  "manifest-missing",
  "release-incomplete",
  "version-mismatch",
  "download-failed",
  "install-failed",
  "error",
]);
// Release type is informational here; release ordering and selection belong to
// the updater. Ignore build metadata, whose identifiers can contain hyphens.
export function isPrereleaseVersion(version: string): boolean {
  return /^v?\d+\.\d+\.\d+-/i.test(version.trim().split("+", 1)[0]);
}
export function updateHasError(state: UpdateSnapshot): boolean {
  return state.phase === "error" || failureCodes.has(state.messageCode);
}
export function updatePhaseText(state: UpdateSnapshot): string {
  if (updateHasError(state)) return t("updates.phase.error");
  if (state.messageCode === "no-eligible-release")
    return t("updates.phase.noEligible");
  switch (state.phase) {
    case "checking":
      return t("updates.phase.checking");
    case "current":
      return t("updates.phase.current");
    case "available":
      return t("updates.phase.available");
    case "downloading":
      return t("updates.phase.downloading");
    case "ready":
      return t("updates.phase.ready");
    case "installing":
      return t("updates.phase.installing");
    case "unconfigured":
      return t("updates.phase.unconfigured");
    default:
      return t("updates.phase.idle");
  }
}
export function updateStatusText(state: UpdateSnapshot): string {
  if (updateHasError(state)) return t("updates.footer.error");
  if (state.messageCode === "no-eligible-release")
    return t("updates.footer.noEligible");
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
    case "preference-changed":
      return t("updates.status.preferenceChanged");
    case "check-failed":
      return t("updates.status.checkFailed");
    case "no-eligible-release":
      return t("updates.status.noEligible");
    case "release-unavailable":
      return t("updates.status.releaseUnavailable");
    case "rate-limited":
      return t("updates.status.rateLimited");
    case "check-timeout":
      return t("updates.status.checkTimeout");
    case "manifest-missing":
      return t("updates.status.manifestMissing");
    case "release-incomplete":
      return t("updates.status.releaseIncomplete");
    case "version-mismatch":
      return t("updates.status.versionMismatch");
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
  installUpdate: (
    confirmed: boolean,
    expectedVersion: string,
    expectedIncludeBetaUpdates: boolean,
  ) =>
    invoke<void>("install_update", {
      confirmed,
      expectedVersion,
      expectedIncludeBetaUpdates,
    }),
  downloadAndInstall: (
    confirmed: boolean,
    expectedVersion: string,
    expectedIncludeBetaUpdates: boolean,
  ) =>
    invoke<void>("download_and_install", {
      confirmed,
      expectedVersion,
      expectedIncludeBetaUpdates,
    }),
  openReleasePage: () => invoke<void>("open_release_page"),
  dismiss: () => invoke<void>("dismiss_update"),
};
