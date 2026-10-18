import { t } from "../i18n";

export interface AttachmentDownload {
  serviceId: string;
  state: string;
  path?: string;
}

// Swiph3l: Native download events contain a chosen local destination, never a provider
// URL. Keep it only in the current status text; no history, logging or storage.
export function attachmentDownloadStatus(
  event: AttachmentDownload,
): string | null {
  const path = typeof event.path === "string" && event.path ? event.path : null;
  if (event.state === "completed")
    return path
      ? t("downloads.completed", { path })
      : t("downloads.completedNoPath");
  if (event.state === "failed" || event.state === "unavailable")
    return path ? t("downloads.failed", { path }) : t("downloads.failedNoPath");
  const state =
    event.state === "requested" || event.state === "in-progress"
      ? t("downloads.inProgress")
      : event.state === "paused"
        ? t("downloads.paused")
        : event.state === "cancelled"
          ? t("downloads.cancelled")
          : null;
  if (state === null) return null;
  return path ? `${state}\n${t("downloads.destination", { path })}` : state;
}
