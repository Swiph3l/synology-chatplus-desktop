import { readWhatsAppAttention } from "./whatsapp-attention";
import { probeWhatsAppReadStructure } from "./whatsapp-read-probe";
import type { ProviderUnreadAdapter } from "./types";
import type { ProviderHostWindow } from "../provider-unread";

export function createWhatsAppAdapter(
  document: Document,
): ProviderUnreadAdapter {
  const view = document.defaultView as
    | (Window &
        ProviderHostWindow & { __chatplusNotificationDiagnostics?: boolean })
    | null;
  const diagnostics = view?.__chatplusNotificationDiagnostics === true;
  let foreground = false;
  let generation = 0;
  let disposed = false;
  let tag: string | null = null;
  let tagReceivedAt = 0;
  let pendingProbe: number | null = null;
  let lastProbe: string | null = null;
  let sawPositiveAttention = false;
  const cancelProbe = () => {
    if (pendingProbe !== null) view?.clearTimeout(pendingProbe);
    pendingProbe = null;
  };
  const scheduleProbe = () => {
    if (
      !diagnostics ||
      !view ||
      disposed ||
      !foreground ||
      tag === null ||
      pendingProbe !== null
    )
      return;
    // Swiph3l: This QA-only trailing sample observes structural flags, never read
    // state. A timer cannot acknowledge anything. Keep only the latest incoming
    // opaque tag briefly; no contact/message text or identifier is exported.
    pendingProbe = view.setTimeout(() => {
      pendingProbe = null;
      if (
        disposed ||
        !foreground ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        tag === null
      )
        return;
      if (Date.now() - tagReceivedAt > 120_000) {
        tag = null;
        return;
      }
      const reasons = probeWhatsAppReadStructure(document, tag);
      const key = `${generation}:${JSON.stringify(reasons)}`;
      const bridge = view.chrome?.webview;
      if (key === lastProbe || !bridge) return;
      try {
        for (const reason of reasons)
          bridge.postMessage(
            JSON.stringify({
              chatplusUnreadDiagnostic: 1,
              source: "whatsapp-dom",
              event: "read-structure-checked",
              reason,
              generation,
            }),
          );
        lastProbe = key;
      } catch {
        // A revoked bridge stays unknown; raw page data/errors never enter logs.
      }
    }, 150);
  };
  return {
    source: "whatsapp-dom",
    // Swiph3l: WhatsApp owns this scoped counter. Browser events still deliver
    // banners, but cannot latch an unrelated all-chat unread dot behind it.
    tracksNotificationArrivals: false,
    snapshot() {
      scheduleProbe();
      // Swiph3l: A later publisher zero may reflect reading on the phone while
      // Web stays on its home screen. Keep initial-zero readiness stricter, but
      // do not require an open message pane after a ready positive was observed.
      const attention = readWhatsAppAttention(document, {
        allowReadyZeroAfterPositive: sawPositiveAttention,
      });
      if (attention.hasUnread === true) sawPositiveAttention = true;
      return {
        ...attention,
        conversations: [],
        currentConversation: null,
      };
    },
    providerUnreadZero: () => false,
    // Swiph3l: Attention zero is not a current-chat/message or all-chat read proof.
    // Keep these capabilities unavailable; only the explicitly scoped counter changes.
    readContext: () => null,
    contentContext: () => null,
    interactionContext: () => null,
    onNotificationObserved(notification) {
      if (
        diagnostics &&
        !disposed &&
        typeof notification.tag === "string" &&
        notification.tag.length > 0 &&
        notification.tag.length <= 512
      ) {
        tag = notification.tag;
        tagReceivedAt = Date.now();
        lastProbe = null;
        scheduleProbe();
      }
    },
    isViewingNotification: () => false,
    onHostForegroundChanged(value, nextGeneration = 0) {
      foreground = value;
      generation = nextGeneration;
      if (!foreground) cancelProbe();
      else scheduleProbe();
    },
    observe(changed) {
      const Observer = document.defaultView?.MutationObserver;
      const observer = Observer ? new Observer(() => changed()) : null;
      observer?.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "role",
          "aria-hidden",
          "aria-busy",
          "data-testid",
          "data-id",
          "hidden",
          "style",
          "class",
          "id",
          "lang",
          ...(diagnostics ? ["aria-selected", "data-icon"] : []),
        ],
      });
      return () => {
        disposed = true;
        sawPositiveAttention = false;
        tag = null;
        cancelProbe();
        observer?.disconnect();
      };
    },
  };
}
