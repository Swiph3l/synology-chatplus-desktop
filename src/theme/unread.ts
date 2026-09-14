// ChatPlus TabItem renders this marker from its unread state. Never inspect
// message text, flashing document titles or internal Vue/backend APIs.
(() => {
  if (window.top !== window) return;
  const tabSelector = '[id^="sidebar-tab-item-"]';
  let header: Element | null = null;
  let last: boolean | undefined;
  let scheduled = false;
  const report = () => {
    scheduled = false;
    if (!header?.isConnected) return;
    const tabs = header.querySelectorAll(tabSelector);
    if (!tabs.length) return; // unavailable is not equivalent to read
    const unread = [...tabs].some((tab) =>
      tab.querySelector('[data-testid="tab-item-indicator"]'),
    );
    if (last === unread) return;
    last = unread;
    const webview = (
      window as unknown as {
        chrome?: { webview?: { postMessage: (value: unknown) => void } };
      }
    ).chrome?.webview;
    // Wry's first WebMessageReceived handler requires a string payload.
    webview?.postMessage(JSON.stringify({ chatplusUnread: 1, unread }));
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
