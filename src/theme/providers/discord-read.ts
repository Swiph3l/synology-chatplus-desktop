export type InboxReadStatus =
  "waiting" | "submitted" | "confirmation" | "unavailable";

const inboxNames = new Set([
  "Inbox",
  "Skrzynka odbiorcza",
  "Posteingang",
  "Bandeja de entrada",
  "Boîte de réception",
  "受信トレイ",
  "收件匣",
]);
const unreadNames = new Set([
  "Unreads",
  "Nieprzeczytane",
  "Ungelesen",
  "Sin leer",
  "Non lus",
  "未読",
  "未讀",
]);
const markNames = new Set([
  "Mark Inbox As Read",
  "Mark Inbox as Read",
  "Oznacz skrzynkę odbiorczą jako przeczytaną",
  "Posteingang als gelesen markieren",
  "Marcar bandeja de entrada como leída",
  "Marquer la boîte de réception comme lue",
  "受信トレイを既読にする",
  "將收件匣標記為已讀",
]);

function visible(element: HTMLElement, document: Document): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const view = document.defaultView;
  if (!view) return false;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const style = view.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  const rect = element.getBoundingClientRect();
  return (
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function controls(root: ParentNode, document: Document): HTMLElement[] {
  const found = [
    ...root.querySelectorAll<HTMLElement>(
      'button, [role="button"], [role="tab"]',
    ),
  ];
  return found.length <= 128
    ? found.filter((element) => visible(element, document))
    : [];
}

function named(element: HTMLElement, names: Set<string>): boolean {
  return (
    names.has(element.getAttribute("aria-label") ?? "") ||
    names.has(element.getAttribute("title") ?? "")
  );
}

function namedControls(document: Document, names: Set<string>): HTMLElement[] {
  const selector = [...names]
    .flatMap((name) => [`[aria-label="${name}"]`, `[title="${name}"]`])
    .join(",");
  return [...document.querySelectorAll<HTMLElement>(selector)].filter(
    (element) =>
      element.matches('button, [role="button"]') &&
      visible(element, document) &&
      enabled(element),
  );
}

function enabled(element: HTMLElement): boolean {
  return (
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true"
  );
}

// Swiph3l: Use Discord's public Inbox controls, never its stores, tokens or APIs.
// Exact control names and a unique Inbox root fail closed when provider UI changes;
// message/contact text is neither read nor used to discover an action.
export function createDiscordInboxRead(document: Document) {
  let operation: string | null = null;
  let opened = false;
  let tabSelected = false;
  let clicked: HTMLElement | null = null;
  let settled = false;
  return (nextOperation: string): InboxReadStatus => {
    if (!/^[0-9]{1,20}$/.test(nextOperation)) return "unavailable";
    if (nextOperation !== operation) {
      operation = nextOperation;
      opened = false;
      tabSelected = false;
      clicked = null;
      settled = false;
    }
    if (
      document.querySelector(
        '[role="alertdialog"], [role="dialog"][aria-modal="true"]',
      )
    )
      return "confirmation";
    const candidates = [
      ...document.querySelectorAll<HTMLElement>(
        '[class*="recentMentionsPopout_"], [role="dialog"][aria-label]',
      ),
    ].filter(
      (root) =>
        visible(root, document) &&
        (root.className
          .split(/\s+/)
          .some((name) => name.startsWith("recentMentionsPopout_")) ||
          named(root, inboxNames)),
    );
    const roots = candidates.filter(
      (root) =>
        !candidates.some((other) => other !== root && other.contains(root)),
    );
    if (roots.length !== 1) {
      if (roots.length > 1 || clicked) return "unavailable";
      if (opened) return "waiting";
      const openers = namedControls(document, inboxNames);
      if (openers.length !== 1) return "unavailable";
      openers[0].click();
      opened = true;
      return "waiting";
    }
    const root = roots[0];
    if (
      [
        ...root.querySelectorAll<HTMLElement>(
          '[role="alert"], [aria-invalid="true"]',
        ),
      ].some((element) => visible(element, document))
    )
      return "unavailable";
    const found = controls(root, document);
    const tabs = found.filter(
      (control) =>
        control.getAttribute("role") === "tab" &&
        (control.id === "unreads-tab" ||
          control.getAttribute("data-list-item-id")?.endsWith("___unreads") ||
          named(control, unreadNames) ||
          unreadNames.has(control.textContent?.trim() ?? "")),
    );
    if (tabs.length !== 1) return "unavailable";
    if (tabs[0].getAttribute("aria-selected") !== "true") {
      if (clicked || !enabled(tabs[0])) return "unavailable";
      if (tabSelected) return "waiting";
      tabs[0].click();
      tabSelected = true;
      return "waiting";
    }
    const marks = found.filter(
      (control) =>
        control.getAttribute("role") !== "tab" && named(control, markNames),
    );
    if (!clicked) {
      if (marks.length !== 1 || !enabled(marks[0])) return "unavailable";
      clicked = marks[0];
      clicked.click();
      return "waiting";
    }
    // Swiph3l: A click or disappearing/renamed/replaced action cannot prove a
    // successful read. Keep the same scoped control; the host additionally
    // requires a fresh reliable provider-wide zero before acknowledging arrivals.
    if (marks.length !== 1 || marks[0] !== clicked || !root.contains(clicked))
      return "unavailable";
    if (enabled(clicked)) return "waiting";
    if (!settled) {
      settled = true;
      return "waiting";
    }
    return "submitted";
  };
}
