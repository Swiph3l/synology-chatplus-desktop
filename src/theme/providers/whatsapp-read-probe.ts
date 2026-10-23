import { visibleElement } from "./dom";

export const whatsappReadProbeReasons = [
  "whatsapp-chat-tag-recognized",
  "whatsapp-message-key-tag-recognized",
  "whatsapp-tag-unrecognized",
  "whatsapp-main-recognized",
  "whatsapp-main-missing",
  "whatsapp-main-ambiguous",
  "whatsapp-chat-list-recognized",
  "whatsapp-chat-list-missing",
  "whatsapp-chat-list-ambiguous",
  "whatsapp-selected-row-recognized",
  "whatsapp-selected-row-missing",
  "whatsapp-selected-row-ambiguous",
  "whatsapp-unread-badge-present",
  "whatsapp-unread-badge-missing",
  "whatsapp-selected-unread-badge-present",
  "whatsapp-selected-unread-badge-missing",
  "whatsapp-main-message-key-recognized",
  "whatsapp-main-message-key-missing",
  "whatsapp-tag-matches-main-message",
  "whatsapp-tag-unmatched-main-message",
  "whatsapp-scroll-node-recognized",
  "whatsapp-scroll-node-missing",
  "whatsapp-scroll-node-ambiguous",
  "whatsapp-latest-candidate-visible",
  "whatsapp-latest-candidate-unavailable",
] as const;

export type WhatsAppReadProbeReason = (typeof whatsappReadProbeReasons)[number];

const MAX_NODES = 512;
const jid =
  "[A-Za-z0-9][A-Za-z0-9.:-]{0,190}@(?:c\\.us|s\\.whatsapp\\.net|lid|g\\.us|broadcast|newsletter)";
const chatTag = new RegExp(`^${jid}$`);
const messageKey = new RegExp(
  `^(?:false|true)_${jid}_[A-Za-z0-9-]{1,128}(?:_(?:in|out))?(?:_${jid})?$`,
);
const badgeSelector =
  '[data-testid="icon-unread-count"], [data-testid="unread-count"], [data-icon="unread-count"]';

function visible(document: Document, element: Element): boolean {
  return (
    !element.closest('[aria-hidden="true"]') &&
    visibleElement(document, element)
  );
}

function nodes(
  document: Document,
  root: ParentNode,
  selector: string,
): Element[] {
  const found = root.querySelectorAll(selector);
  if (found.length > MAX_NODES) return [];
  return [...found].filter((element) => visible(document, element));
}

// Swiph3l: Diagnostic only. These flags cannot acknowledge a notification or prove
// global zero. Public MsgKey serialization is [fromMe, remote, id, ...].join("_").
// Compare the complete opaque incoming tag; never split/extract a phone number,
// inspect contact/message labels, or return DOM attributes or conversation IDs.
export function probeWhatsAppReadStructure(
  document: Document,
  tag: string,
): readonly WhatsAppReadProbeReason[] {
  const reasons: WhatsAppReadProbeReason[] = [];
  const bounded = typeof tag === "string" && tag.length <= 512;
  const isChat = bounded && chatTag.test(tag);
  const isMessage = bounded && messageKey.test(tag);
  reasons.push(
    isChat
      ? "whatsapp-chat-tag-recognized"
      : isMessage
        ? "whatsapp-message-key-tag-recognized"
        : "whatsapp-tag-unrecognized",
  );

  const lists = nodes(
    document,
    document,
    '#pane-side [role="grid"], #pane-side [role="list"]',
  );
  reasons.push(
    lists.length === 1
      ? "whatsapp-chat-list-recognized"
      : lists.length === 0
        ? "whatsapp-chat-list-missing"
        : "whatsapp-chat-list-ambiguous",
  );
  const rows =
    lists.length === 1
      ? nodes(document, lists[0], '[role="row"], [role="listitem"]')
      : [];
  const selected = rows.filter(
    (row) =>
      row.matches('[aria-selected="true"]') ||
      nodes(document, row, '[role="gridcell"][aria-selected="true"]').length >
        0,
  );
  reasons.push(
    selected.length === 1
      ? "whatsapp-selected-row-recognized"
      : selected.length === 0
        ? "whatsapp-selected-row-missing"
        : "whatsapp-selected-row-ambiguous",
    rows.some((row) => nodes(document, row, badgeSelector).length > 0)
      ? "whatsapp-unread-badge-present"
      : "whatsapp-unread-badge-missing",
    selected.length === 1 &&
      nodes(document, selected[0], badgeSelector).length > 0
      ? "whatsapp-selected-unread-badge-present"
      : "whatsapp-selected-unread-badge-missing",
  );

  const mains = nodes(document, document, "#main");
  reasons.push(
    mains.length === 1
      ? "whatsapp-main-recognized"
      : mains.length === 0
        ? "whatsapp-main-missing"
        : "whatsapp-main-ambiguous",
  );
  const main = mains.length === 1 ? mains[0] : null;
  const candidates = main ? nodes(document, main, "[data-id]") : [];
  const messages: Element[] = [];
  let matches = false;
  for (const candidate of candidates) {
    const opaque = candidate.getAttribute("data-id");
    if (opaque === null || opaque.length > 512 || !messageKey.test(opaque))
      continue;
    messages.push(candidate);
    if (
      (isChat &&
        (opaque.startsWith(`false_${tag}_`) ||
          opaque.startsWith(`true_${tag}_`))) ||
      (isMessage && opaque === tag)
    )
      matches = true;
  }
  reasons.push(
    messages.length > 0
      ? "whatsapp-main-message-key-recognized"
      : "whatsapp-main-message-key-missing",
    matches
      ? "whatsapp-tag-matches-main-message"
      : "whatsapp-tag-unmatched-main-message",
  );

  const scrolls = new Set<Element>();
  for (const message of messages) {
    let node: Element | null = message.parentElement;
    for (
      let depth = 0;
      node && main?.contains(node) && depth < 32;
      depth += 1
    ) {
      const style = document.defaultView?.getComputedStyle(node);
      if (
        /^(?:auto|scroll)$/.test(style?.overflowY ?? "") &&
        Number.isFinite(node.scrollHeight) &&
        Number.isFinite(node.clientHeight) &&
        node.clientHeight > 0 &&
        node.scrollHeight > node.clientHeight
      )
        scrolls.add(node);
      node = node.parentElement;
    }
  }
  reasons.push(
    scrolls.size === 1
      ? "whatsapp-scroll-node-recognized"
      : scrolls.size === 0
        ? "whatsapp-scroll-node-missing"
        : "whatsapp-scroll-node-ambiguous",
  );
  let latestVisible = false;
  if (scrolls.size === 1 && messages.length > 0) {
    const scroll = [...scrolls][0];
    const candidate = messages.at(-1)!;
    const position = scroll.scrollTop;
    const bounds = scroll.getBoundingClientRect();
    const item = candidate.getBoundingClientRect();
    const hit = document.elementFromPoint?.(
      item.left + item.width / 2,
      item.top + item.height / 2,
    );
    latestVisible =
      scroll.contains(candidate) &&
      Number.isFinite(position) &&
      position >= 0 &&
      scroll.scrollHeight - scroll.clientHeight - position <= 3 &&
      item.top >= bounds.top &&
      item.bottom <= bounds.bottom &&
      hit !== null &&
      hit !== undefined &&
      candidate.contains(hit);
  }
  reasons.push(
    latestVisible
      ? "whatsapp-latest-candidate-visible"
      : "whatsapp-latest-candidate-unavailable",
  );
  return reasons;
}
