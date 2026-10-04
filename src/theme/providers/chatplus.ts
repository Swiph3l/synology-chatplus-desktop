import { createViewContext, eventInside, visibleElement } from "./dom";
import type { ProviderUnreadAdapter } from "./types";

const tabSelector = '[id^="sidebar-tab-item-"]';
const indicatorSelector = '[data-testid="tab-item-indicator"]';
const viewSelector = "body.eos-scope .message-viewer-scrollbar";

export function createChatplusAdapter(
  document: Document,
): ProviderUnreadAdapter {
  const contexts = createViewContext(document, viewSelector, "chatplus-view");
  const snapshot = () => {
    const firstTab = document.querySelector(`body.eos-scope ${tabSelector}`);
    const header = firstTab?.parentElement;
    const tabs = header?.querySelectorAll(tabSelector);
    if (!header?.isConnected || !tabs?.length)
      return { hasUnread: null, count: null };
    // Swiph3l: ChatPlus tabs aggregate provider unread; their dot/text is not an audited message count, and checking only the selected tab would miss other conversations.
    return {
      hasUnread: [...tabs].some(
        (tab) => tab.querySelector(indicatorSelector) !== null,
      ),
      count: null,
    };
  };
  const view = () => {
    if (snapshot().hasUnread === null) return null;
    const candidates = [
      ...document.querySelectorAll<HTMLElement>(viewSelector),
    ].filter(
      (element) =>
        !element.closest('[data-testid="thread-viewer-comments-section"]') &&
        visibleElement(document, element) &&
        element.clientHeight > 0,
    );
    // Swiph3l: An ambiguous pane/thread layout cannot prove which conversation the user is reading.
    return candidates.length === 1 ? candidates[0] : null;
  };
  const viewport = (current: HTMLElement) => {
    // Swiph3l: The audited viewer may wrap the real native scroller. A wrapper with scrollTop=0 and matching heights cannot prove that its nested conversation is at latest.
    const candidates = [
      current,
      ...current.querySelectorAll<HTMLElement>("*"),
    ].filter(
      (element) =>
        element.clientHeight > 0 &&
        ["auto", "scroll"].includes(
          document.defaultView?.getComputedStyle(element).overflowY ?? "",
        ) &&
        visibleElement(document, element),
    );
    return candidates.length === 1 ? candidates[0] : null;
  };
  return {
    source: "chatplus-dom",
    snapshot,
    observe: contexts.observe,
    contentContext() {
      const current = view();
      return current && viewport(current) ? contexts.key(current) : null;
    },
    readContext() {
      const current = view();
      if (!current) return null;
      const scroll = viewport(current);
      if (!scroll) return null;
      const { clientHeight, scrollHeight, scrollTop } = scroll;
      if (
        ![clientHeight, scrollHeight, scrollTop].every(Number.isFinite) ||
        scrollHeight < clientHeight ||
        scrollTop < 0 ||
        Math.abs(scrollHeight - clientHeight - scrollTop) > 1
      )
        return null;
      return contexts.key(current);
    },
    interactionContext(event) {
      const current = view();
      const scroll = current && viewport(current);
      return current && scroll && eventInside(event, scroll)
        ? contexts.key(current)
        : null;
    },
    // Swiph3l: Audited ChatPlus DOM exposes aggregate tab unread but no verified notification-tag/conversation mapping; selection cannot suppress an unrelated conversation's toast.
    isViewingNotification: () => false,
  };
}
