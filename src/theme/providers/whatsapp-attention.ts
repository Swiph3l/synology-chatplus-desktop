import { visibleElement } from "./dom";

export interface WhatsAppAttentionState {
  hasUnread: boolean | null;
  count: number | null;
  unreadScope: "notification-attention";
}

const MAX_NODES = 512;
const publishers = ["WhatsApp", "WhatsApp Business"];

// Swiph3l: Public WAWebNotificationIcon formats its attention count with
// BaseL10N.n -> Intl.NumberFormat, then a fixed publisher name. That counter
// excludes muted/archived/locked chats; it is not an all-message read proof.
// Unsupported route titles, loading titles and transient blanks stay unknown.
export function parseWhatsAppAttentionTitle(
  title: string,
  locale?: string,
): number | null {
  if (publishers.includes(title)) return 0;
  const match = /^\(([^()\r\n]{1,64})\) (WhatsApp(?: Business)?)$/u.exec(title);
  if (!match || match[0] !== title) return null;
  try {
    const formatter = new Intl.NumberFormat(locale);
    const plain = new Intl.NumberFormat(locale, { useGrouping: false });
    const digits = new Map<string, string>();
    for (let digit = 0; digit <= 9; digit += 1)
      digits.set(plain.format(digit), String(digit));
    const groups = new Set(
      formatter
        .formatToParts(1_234_567_890)
        .filter((part) => part.type === "group")
        .map((part) => part.value),
    );
    let normalized = "";
    for (const character of match[1]) {
      const digit = digits.get(character);
      if (digit !== undefined) normalized += digit;
      else if (!groups.has(character)) return null;
    }
    const count = Number(normalized);
    return Number.isSafeInteger(count) &&
      count > 0 &&
      count <= 0xffffffff &&
      formatter.format(count) === match[1]
      ? count
      : null;
  } catch {
    return null;
  }
}

function visible(document: Document, element: Element): boolean {
  return (
    !element.closest('[aria-hidden="true"], [aria-busy="true"]') &&
    visibleElement(document, element)
  );
}

function visibleNodes(
  document: Document,
  root: ParentNode,
  selector: string,
): Element[] {
  const found = root.querySelectorAll(selector);
  return found.length > MAX_NODES
    ? []
    : [...found].filter((element) => visible(document, element));
}

function readyList(document: Document): boolean {
  if (document.readyState === "loading") return false;
  const panes = visibleNodes(document, document, "#pane-side");
  if (panes.length !== 1) return false;
  const lists = visibleNodes(
    document,
    panes[0],
    '[role="grid"], [role="list"]',
  );
  return (
    lists.length === 1 &&
    visibleNodes(document, lists[0], '[role="row"], [role="listitem"]').length >
      0
  );
}

function readyConversation(document: Document): boolean {
  const mains = visibleNodes(document, document, "#main");
  if (mains.length !== 1) return false;
  // Swiph3l: The public MessageWrapper renderer emits a bare MsgKey.id and the
  // matching conv-msg- test ID. Inspect only that technical pair, never message
  // text, accessibility labels, contacts, profile images or provider stores.
  return visibleNodes(
    document,
    mains[0],
    '[data-id][data-testid^="conv-msg-"]',
  ).some((element) => {
    const id = element.getAttribute("data-id");
    return (
      id !== null &&
      /^[A-Za-z0-9_-]{1,128}$/.test(id) &&
      element.getAttribute("data-testid") === `conv-msg-${id}`
    );
  });
}

export function readWhatsAppAttention(
  document: Document,
  options: { allowReadyZeroAfterPositive?: boolean } = {},
): WhatsAppAttentionState {
  const unknown: WhatsAppAttentionState = {
    hasUnread: null,
    count: null,
    unreadScope: "notification-attention",
  };
  if (!readyList(document)) return unknown;
  const locale =
    document.documentElement?.getAttribute("lang")?.replaceAll("_", "-") ||
    document.defaultView?.navigator?.language;
  const count = parseWhatsAppAttentionTitle(document.title, locale);
  if (
    count === null ||
    (count === 0 &&
      !options.allowReadyZeroAfterPositive &&
      !readyConversation(document))
  )
    return unknown;
  return {
    hasUnread: count > 0,
    count: count > 0 ? count : null,
    unreadScope: "notification-attention",
  };
}
