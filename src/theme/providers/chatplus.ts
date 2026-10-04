import { createViewContext, eventInside, visibleElement } from "./dom";
import type { ProviderUnreadAdapter } from "./types";

const tabSelector = '[id^="sidebar-tab-item-"]';
const indicatorSelector = '[data-testid="tab-item-indicator"]';
const viewSelector = "body.eos-scope .message-viewer-scrollbar";

function projectHostPresentation(document: Document) {
  const window = document.defaultView;
  const keys = ["hasFocus", "hidden", "visibilityState"] as const;
  const originals = keys.map((key) =>
    Object.getOwnPropertyDescriptor(document, key),
  );
  const browserHasFocus = document.hasFocus.bind(document);
  const originalReader = (key: "hidden" | "visibilityState") => {
    for (
      let owner: object | null = document;
      owner;
      owner = Object.getPrototypeOf(owner)
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor)
        return descriptor.get
          ? () => descriptor.get!.call(document)
          : () => descriptor.value;
    }
    return () => undefined;
  };
  const browserHidden = originalReader("hidden");
  const browserVisibility = originalReader("visibilityState");
  const browserVisible = () =>
    browserHidden() !== true && browserVisibility() === "visible";
  let foreground: boolean | undefined;
  const hidden = () => foreground !== true || !browserVisible();
  const visibilityState = () => (hidden() ? "hidden" : "visible");
  const hasFocus = () => !hidden() && browserHasFocus();
  const descriptors: PropertyDescriptor[] = [
    { configurable: true, writable: true, value: hasFocus },
    { configurable: true, get: hidden },
    { configurable: true, get: visibilityState },
  ];
  const restore = () => {
    keys.forEach((key, index) => {
      const current = Object.getOwnPropertyDescriptor(document, key);
      if (
        !current ||
        (index === 0
          ? current.value !== hasFocus
          : current.get !== descriptors[index].get)
      )
        return;
      const original = originals[index];
      if (original) Object.defineProperty(document, key, original);
      else Reflect.deleteProperty(document, key);
    });
  };
  let projected = false;
  if (window) {
    try {
      // Swiph3l: A minimized/background child WebView can stay logically focused and visible. Native foreground must reach the provider's public browser APIs before its scripts run; gating our bridge alone cannot repair upstream notification eligibility.
      keys.forEach((key, index) =>
        Object.defineProperty(document, key, descriptors[index]),
      );
      projected = true;
    } catch {
      // Swiph3l: Browser-owned non-configurable properties must stay intact; undo a partial projection instead of leaving inconsistent public focus/visibility.
      restore();
    }
  }
  let lastFocus = browserVisible() && browserHasFocus();
  let lastVisibility = browserVisible() ? "visible" : "hidden";
  let ownEvent: Event | undefined;
  const dispatch = (target: Document | Window, type: string) => {
    ownEvent = new (window?.Event ?? Event)(type);
    try {
      target.dispatchEvent(ownEvent);
    } finally {
      ownEvent = undefined;
    }
  };
  const sync = () => {
    const nextFocus = hasFocus();
    const nextVisibility = visibilityState();
    const focusChanged = nextFocus !== lastFocus;
    const visibilityChanged = nextVisibility !== lastVisibility;
    lastFocus = nextFocus;
    lastVisibility = nextVisibility;
    if (window && focusChanged && !nextFocus) dispatch(window, "blur");
    if (visibilityChanged) dispatch(document, "visibilitychange");
    if (window && focusChanged && nextFocus) dispatch(window, "focus");
  };
  const focusChanged = (event: Event) => {
    if (!projected || event === ownEvent) return;
    if (event.type === "focus" && !hasFocus()) {
      // Swiph3l: Logical child focus must not reactivate a hidden provider; restore can expose focus only when the original browser is genuinely focused and visible too.
      event.stopImmediatePropagation();
      return;
    }
    lastFocus = hasFocus();
  };
  const visibilityChanged = (event: Event) => {
    if (!projected || event === ownEvent) return;
    if (foreground !== true) {
      event.stopImmediatePropagation();
      return;
    }
    lastVisibility = visibilityState();
    const nextFocus = hasFocus();
    if (nextFocus !== lastFocus && window) {
      lastFocus = nextFocus;
      dispatch(window, nextFocus ? "focus" : "blur");
    }
  };
  if (projected) {
    window?.addEventListener("focus", focusChanged, true);
    window?.addEventListener("blur", focusChanged, true);
    document.addEventListener("visibilitychange", visibilityChanged, true);
  }
  return {
    setForeground(value: boolean) {
      foreground = value;
      if (projected) sync();
    },
    dispose() {
      window?.removeEventListener("focus", focusChanged, true);
      window?.removeEventListener("blur", focusChanged, true);
      document.removeEventListener("visibilitychange", visibilityChanged, true);
      restore();
      projected = false;
    },
  };
}

export function createChatplusAdapter(
  document: Document,
): ProviderUnreadAdapter {
  const presentation = projectHostPresentation(document);
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
    onHostForegroundChanged: presentation.setForeground,
    observe(changed) {
      const stop = contexts.observe(changed);
      return () => {
        stop();
        presentation.dispose();
      };
    },
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
