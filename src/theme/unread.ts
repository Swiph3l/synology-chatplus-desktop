// Swiph3l: Provider sidebar markers are the supported read evidence; titles and internal APIs can invent unread or expose private content.
(() => {
  if (window.top !== window) return;
  const tabSelector = '[id^="sidebar-tab-item-"]';
  const indicatorSelector = '[data-testid="tab-item-indicator"]';
  let header: Element | null = null;
  let lastKey: string | undefined;
  let scheduled = false;
  let foreground = false;
  let generation = 0;
  let interacted = false;
  let interactionSequence = 0;
  let lastUnread: boolean | null = null;
  let interactionSawUnread = false;
  const hostWindow = window as unknown as {
    __chatplusSetForeground?: (foreground: boolean, generation: number) => void;
    chrome?: { webview?: { postMessage: (value: unknown) => void } };
  };
  const webview = hostWindow.chrome?.webview;
  const publish = (
    source: "chatplus-dom",
    hasUnread: boolean,
    count: number | null,
    reason: string,
    acknowledgement: number | null = null,
  ) => {
    const key = `${source}:${hasUnread ? 1 : 0}:${count ?? "dot"}:${acknowledgement === null ? "observation" : `${acknowledgement}:${interactionSequence}`}`;
    if (lastKey === key) return;
    lastKey = key;
    webview?.postMessage(
      JSON.stringify({
        chatplusUnread: 1,
        source,
        hasUnread,
        count,
        reason,
        acknowledgement,
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
  const report = () => {
    scheduled = false;
    const state = domState();
    if (state) {
      if (state.hasUnread) {
        // Swiph3l: Input before a new message cannot acknowledge that message; retain input only if it already saw the unread marker being read.
        if (lastUnread !== true && !interactionSawUnread) interacted = false;
        lastUnread = true;
        publish("chatplus-dom", true, state.count, "badge-present");
      } else {
        // Swiph3l: A selected WebView can auto-remove its badge while minimized; require a real provider gesture plus native foreground visibility.
        const acknowledged =
          foreground &&
          interacted &&
          document.visibilityState === "visible" &&
          document.hasFocus();
        publish(
          "chatplus-dom",
          false,
          null,
          acknowledged ? "user-read-acknowledgement" : "provider-empty",
          acknowledged ? generation : null,
        );
        lastUnread = false;
        if (acknowledged) interacted = false;
        interactionSawUnread = false;
      }
      return;
    }
    // Swiph3l: Missing sidebar state is unknown during navigation/reconnect and must preserve cached unread.
  };
  hostWindow.__chatplusSetForeground = (value, nextGeneration) => {
    // Swiph3l: Native callbacks can queue script updates from different threads; an older visibility snapshot cannot restore a revoked gesture.
    if (nextGeneration < generation) return;
    if (value !== foreground || generation !== nextGeneration) {
      interacted = false;
      interactionSawUnread = false;
    }
    foreground = value;
    generation = nextGeneration;
    schedule();
  };
  const interaction = (event: Event) => {
    if (
      !event.isTrusted ||
      !foreground ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    )
      return;
    if (
      event instanceof KeyboardEvent &&
      ["Alt", "Control", "Meta", "Shift", "Tab"].includes(event.key)
    )
      return;
    interacted = true;
    interactionSawUnread = domState()?.hasUnread === true;
    interactionSequence += 1;
    schedule();
  };
  document.addEventListener("pointerdown", interaction, true);
  document.addEventListener("click", interaction, true);
  document.addEventListener("keydown", interaction, true);
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
  // Swiph3l: Observe sidebar mutations instead of polling the full provider DOM, which can be large and changes during reconnect.
  new MutationObserver(discover).observe(document, {
    childList: true,
    subtree: true,
  });
  discover();
})();
