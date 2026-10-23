import { visibleElement } from "./dom";
import { probeWhatsAppReadStructure } from "./whatsapp-read-probe";
import type { ProviderUnreadAdapter } from "./types";
import type { ProviderHostWindow } from "../provider-unread";

const listSelector = '#pane-side [role="grid"], #pane-side [role="list"]';
const badgeSelector =
  '[data-testid="icon-unread-count"], [data-testid="unread-count"], [data-icon="unread-count"]';

// Swiph3l: Inspect accessibility metadata only on dedicated unread badge elements.
// Arbitrary row labels can be contact names or previews, even when their text
// happens to say "2 unread messages". Never inspect those labels or QR/session data.
const unreadLabels = [
  /^unread messages?$/i,
  /^nieprzeczytan\p{L}* wiadomo\p{L}*$/iu,
  /^mensajes? (?:no le[ií]dos?|sin leer)$/i,
  /^ungelesene? nachrichten?$/i,
  /^messages? non lus?$/i,
  /^未読(?:の)?メッセージ(?:\s*件)?$/,
  /^(?:則)?未讀(?:訊息|消息)$/,
];

function positiveUnreadLabel(label: string): boolean {
  const numbers = label.match(/[0-9]+/g);
  if (numbers && !numbers.some((number) => Number(number) > 0)) return false;
  const semantic = label
    .replace(/[0-9]+\+?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return unreadLabels.some((pattern) => pattern.test(semantic));
}

function visible(document: Document, element: Element): boolean {
  return (
    !element.closest('[aria-hidden="true"]') &&
    visibleElement(document, element)
  );
}

function unreadBadge(row: Element, document: Document): boolean {
  for (const badge of row.querySelectorAll(badgeSelector)) {
    if (!visible(document, badge)) continue;
    const count = badge.textContent?.trim() ?? "";
    if (/^[1-9][0-9]*\+?$/.test(count)) return true;
    const label = badge.getAttribute("aria-label") ?? "";
    if (positiveUnreadLabel(label)) return true;
  }
  return false;
}

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
    snapshot() {
      scheduleProbe();
      const lists = [...document.querySelectorAll(listSelector)].filter(
        (list) => visible(document, list),
      );
      const positive = lists.some((list) =>
        [...list.querySelectorAll('[role="row"], [role="listitem"]')].some(
          (row) => visible(document, row) && unreadBadge(row, document),
        ),
      );
      // Swiph3l: WhatsApp lists may be virtualized, filtered, archived or collapsed. Even
      // aria-rowcount cannot prove the entire account has zero unread. Visible
      // row counts are lower bounds, so never present their sum as a total.
      return {
        hasUnread: positive ? true : null,
        count: null,
        conversations: [],
        currentConversation: null,
      };
    },
    providerUnreadZero: () => false,
    // Swiph3l: No authenticated, privacy-safe current-chat/message identity has been
    // verified. Focus, selected rows and title text cannot acknowledge reads.
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
          "aria-label",
          "aria-hidden",
          "data-testid",
          "data-icon",
          "hidden",
          "style",
          "class",
          ...(diagnostics ? ["aria-selected", "data-id", "id"] : []),
        ],
      });
      return () => {
        disposed = true;
        tag = null;
        cancelProbe();
        observer?.disconnect();
      };
    },
  };
}
