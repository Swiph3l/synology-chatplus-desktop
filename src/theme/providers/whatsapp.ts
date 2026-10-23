import { visibleElement } from "./dom";
import type { ProviderUnreadAdapter } from "./types";

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
  return {
    source: "whatsapp-dom",
    snapshot() {
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
    isViewingNotification: () => false,
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
        ],
      });
      return () => observer?.disconnect();
    },
  };
}
