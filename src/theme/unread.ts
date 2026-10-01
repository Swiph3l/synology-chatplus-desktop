// ChatPlus TabItem renders this marker from its unread state. Never inspect
// message text, flashing document titles or internal Vue/backend APIs.
(() => {
  if (window.top !== window) return;
  const tabSelector = '[id^="sidebar-tab-item-"]';
  const indicatorSelector = '[data-testid="tab-item-indicator"]';
  let header: Element | null = null;
  let lastKey: string | undefined;
  let scheduled = false;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  const webview = (
    window as unknown as {
      chrome?: { webview?: { postMessage: (value: unknown) => void } };
    }
  ).chrome?.webview;
  const publish = (
    source: "chatplus-dom",
    hasUnread: boolean,
    count: number | null,
    reason: string,
  ) => {
    const key = `${source}:${hasUnread ? 1 : 0}:${count ?? "dot"}`;
    if (lastKey === key) return;
    lastKey = key;
    webview?.postMessage(
      JSON.stringify({
        chatplusUnread: 1,
        source,
        hasUnread,
        count,
        reason,
      }),
    );
  };
  const domState = () => {
    if (!header?.isConnected) return null;
    const tabs = [...header.querySelectorAll(tabSelector)];
    if (!tabs.length) return null;
    const badges = tabs
      .map((tab) => tab.querySelector(indicatorSelector))
      .filter((value): value is Element => Boolean(value));
    if (!badges.length)
      return { hasUnread: false, count: null as number | null };
    return { hasUnread: true, count: null as number | null };
  };
  const confirmCleared = () => {
    clearTimer = null;
    const state = domState();
    if (state && !state.hasUnread) {
      publish("chatplus-dom", false, null, "confirmed-badge-removed");
    }
  };
  const report = () => {
    scheduled = false;
    const state = domState();
    if (state) {
      if (state.hasUnread) {
        if (clearTimer !== null) {
          clearTimeout(clearTimer);
          clearTimer = null;
        }
        publish("chatplus-dom", true, state.count, "badge-present");
      } else if (clearTimer === null) {
        clearTimer = setTimeout(confirmCleared, 250);
      }
      return;
    }
    // Missing sidebar state is unknown; keep the last observation during reconnect.
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(report);
    }
  };
  const observer = new MutationObserver(schedule);
  const discover = (records: MutationRecord[] = []) => {
    if (header?.isConnected) return;
    observer.disconnect();
    const selector = "body.eos-scope " + tabSelector;
    const tab = records.length
      ? records
          .flatMap((record) => [...record.addedNodes])
          .filter((node): node is Element => node instanceof Element)
          .map((node) =>
            node.matches(selector) ? node : node.querySelector(selector),
          )
          .find(Boolean)
      : document.querySelector(selector);
    header = tab?.parentElement ?? null;
    if (header) {
      observer.observe(header, { childList: true, subtree: true });
      schedule();
    }
  };
  // Discovery checks only after insertion/removal, never polls the full DOM.
  new MutationObserver(discover).observe(document, {
    childList: true,
    subtree: true,
  });
  discover();
})();
