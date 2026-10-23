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
  "whatsapp-main-data-id-absent",
  "whatsapp-main-data-id-bounded",
  "whatsapp-main-data-id-over-limit",
  "whatsapp-raw-strict-key-present",
  "whatsapp-raw-strict-key-missing",
  "whatsapp-raw-chat-prefix-match",
  "whatsapp-raw-chat-prefix-missing",
  "whatsapp-strict-key-visible",
  "whatsapp-strict-key-hidden",
  "whatsapp-strict-key-zero-sized",
  "whatsapp-list-aria-selected-present",
  "whatsapp-list-aria-selected-missing",
  "whatsapp-list-aria-current-present",
  "whatsapp-list-aria-current-missing",
  "whatsapp-independent-scroll-present",
  "whatsapp-independent-scroll-missing",
  "whatsapp-independent-scroll-over-limit",
] as const;

export type WhatsAppReadProbeReason = (typeof whatsappReadProbeReasons)[number];

const MAX_NODES = 512;
const MAX_SCROLL_NODES = 2048;
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

function keyVisibility(
  document: Document,
  element: Element,
): "visible" | "hidden" | "zero-sized" {
  if (!element.isConnected || !document.defaultView) return "hidden";
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = document.defaultView.getComputedStyle(node);
    if (
      node.matches('[hidden], [aria-hidden="true"]') ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    )
      return "hidden";
  }
  const bounds = element.getBoundingClientRect();
  return Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
    ? "visible"
    : "zero-sized";
}

function independentScroll(
  document: Document,
  main: Element | null,
): WhatsAppReadProbeReason {
  if (!main) return "whatsapp-independent-scroll-missing";
  const descendants = main.querySelectorAll("*");
  if (descendants.length + 1 > MAX_SCROLL_NODES)
    return "whatsapp-independent-scroll-over-limit";
  // Swiph3l: This discovery scan must not depend on an assumed message-key shape.
  // It observes only bounded element geometry and overflow, never page text.
  for (const node of [main, ...descendants]) {
    if (
      Number.isFinite(node.scrollHeight) &&
      Number.isFinite(node.clientHeight) &&
      node.clientHeight > 0 &&
      node.scrollHeight > node.clientHeight &&
      /^(?:auto|scroll)$/.test(
        document.defaultView?.getComputedStyle(node).overflowY ?? "",
      ) &&
      visible(document, node)
    )
      return "whatsapp-independent-scroll-present";
  }
  return "whatsapp-independent-scroll-missing";
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
  const list = lists.length === 1 ? lists[0] : null;
  // Swiph3l: Raw fixed accessibility-state presence is discovery only. It cannot
  // bind a selected element to a conversation or establish that anything was read.
  reasons.push(
    list?.querySelector('[aria-selected="true"]')
      ? "whatsapp-list-aria-selected-present"
      : "whatsapp-list-aria-selected-missing",
    list?.querySelector('[aria-current="true"], [aria-current="page"]')
      ? "whatsapp-list-aria-current-present"
      : "whatsapp-list-aria-current-missing",
  );
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
  const rawCandidates = main?.querySelectorAll("[data-id]");
  const rawLength = rawCandidates?.length ?? 0;
  reasons.push(
    rawLength > MAX_NODES
      ? "whatsapp-main-data-id-over-limit"
      : rawLength === 0
        ? "whatsapp-main-data-id-absent"
        : "whatsapp-main-data-id-bounded",
  );
  let rawStrict = false;
  let rawPrefix = false;
  const visibility = new Set<"visible" | "hidden" | "zero-sized">();
  if (rawCandidates && rawLength <= MAX_NODES)
    for (const candidate of rawCandidates) {
      const opaque = candidate.getAttribute("data-id");
      if (opaque === null || opaque.length > 512) continue;
      // Swiph3l: Check the complete opaque chat prefix before the stricter assumed
      // MsgKey grammar. Rejected shapes must remain distinguishable from no DOM.
      if (
        isChat &&
        (opaque.startsWith(`false_${tag}_`) ||
          opaque.startsWith(`true_${tag}_`))
      )
        rawPrefix = true;
      if (!messageKey.test(opaque)) continue;
      rawStrict = true;
      visibility.add(keyVisibility(document, candidate));
    }
  reasons.push(
    rawStrict
      ? "whatsapp-raw-strict-key-present"
      : "whatsapp-raw-strict-key-missing",
    rawPrefix
      ? "whatsapp-raw-chat-prefix-match"
      : "whatsapp-raw-chat-prefix-missing",
  );
  for (const category of ["visible", "hidden", "zero-sized"] as const)
    if (visibility.has(category))
      reasons.push(`whatsapp-strict-key-${category}`);
  reasons.push(independentScroll(document, main));
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
