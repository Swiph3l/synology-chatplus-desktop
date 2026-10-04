import {
  createViewContext,
  eventInside,
  explicitlyHidden,
  visibleElement,
} from "./dom";
import type { ProviderUnreadAdapter } from "./types";

const sidebarSelector = ".syno-chat .channel-list-main";
const viewSelector = ".syno-chat .msg-panel .chat-msgview";

// Swiph3l: These selectors come from Synology's readable Chat 2.2 server templates, not ChatPlus. Changed/unavailable surfaces remain unknown until their shape is recognized.
export function createSynologyChatAdapter(
  document: Document,
): ProviderUnreadAdapter {
  const viewWindow = document.defaultView;
  const keys = ["hidden", "visibilityState"] as const;
  const originals = keys.map((key) =>
    Object.getOwnPropertyDescriptor(document, key),
  );
  const originalReader = (key: (typeof keys)[number]) => {
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
  let hostForeground: boolean | undefined;
  const hidden = () =>
    hostForeground !== true ||
    browserHidden() === true ||
    browserVisibility() !== "visible";
  const visibilityState = () => (hidden() ? "hidden" : "visible");
  const getters = [hidden, visibilityState];
  const restore = () => {
    keys.forEach((key, index) => {
      if (
        Object.getOwnPropertyDescriptor(document, key)?.get !== getters[index]
      )
        return;
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(document, key, descriptor);
      else Reflect.deleteProperty(document, key);
    });
  };
  let projected = false;
  let ownVisibilityEvent: Event | undefined;
  let lastVisibility =
    browserHidden() === true || browserVisibility() !== "visible"
      ? "hidden"
      : "visible";
  if (viewWindow) {
    try {
      // Swiph3l: Audited Chat ActiveDetector uses document.hidden/visibilitychange to activate its read updater and server session. A logically visible minimized WebView must not mark the current conversation read upstream.
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: hidden,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: visibilityState,
      });
      projected = true;
    } catch {
      // Swiph3l: Browser-owned non-configurable properties must stay intact; roll back a partial projection instead of changing provider private state.
      restore();
    }
  }
  const visibilityChanged = (event: Event) => {
    if (!projected || event === ownVisibilityEvent) return;
    if (hostForeground !== true) {
      // Swiph3l: Native document visibility can remain visible for an inactive child WebView; it must not override the main window's background/minimized state.
      event.stopImmediatePropagation();
    } else lastVisibility = visibilityState();
  };
  if (projected)
    document.addEventListener("visibilitychange", visibilityChanged, true);
  const contexts = createViewContext(
    document,
    viewSelector,
    "synology-chat-view",
  );
  const snapshot = () => {
    const sidebar = document.querySelector(sidebarSelector);
    if (!sidebar?.querySelector(".channel-list-view"))
      return { hasUnread: null, count: null };
    const rows = [
      ...sidebar.querySelectorAll(".channel-list-view .channel-list-item"),
    ];
    const groups = [...sidebar.querySelectorAll(".channel-list-group .unread")];
    const groupNumbers = groups.map((badge) =>
      [...badge.classList].find((name) => /^number-\d+$/.test(name)),
    );
    // Swiph3l: Named-channel number badges count mentions while highlight includes ordinary unread; Starred repeats channel rows, so summing badges would both miss messages and double-count channels.
    const positive =
      rows.some(
        (row) =>
          row.classList.contains("highlight") ||
          row.classList.contains("highlight-mention"),
      ) ||
      groupNumbers.some((value) => value !== undefined && value !== "number-0");
    // Swiph3l: The audited Chat sidebar always mounts Channels and Conversations, with Starred/Chatbot optional. A missing group's rows cannot be inferred empty from its mention-only zero badge.
    const containers = [...sidebar.querySelectorAll(".channel-list-container")];
    const complete =
      containers.length >= 2 &&
      groups.length === containers.length &&
      containers.every(
        (container) =>
          container.querySelector(".channel-list-view") !== null &&
          container.querySelector(".channel-list-group .unread") !== null,
      );
    return {
      hasUnread: positive
        ? true
        : complete && groupNumbers.every((value) => value !== undefined)
          ? false
          : null,
      count: null,
    };
  };
  const view = () => {
    if (
      snapshot().hasUnread === null ||
      !/^#channels\/\d+$/.test(document.defaultView?.location?.hash ?? "")
    )
      return null;
    const candidates = [
      ...document.querySelectorAll<HTMLElement>(viewSelector),
    ].filter((element) => visibleElement(document, element));
    return candidates.length === 1 ? candidates[0] : null;
  };
  return {
    source: "synology-chat-dom",
    snapshot,
    onHostForegroundChanged(foreground) {
      hostForeground = foreground;
      if (!projected) return;
      const next = visibilityState();
      if (lastVisibility === next) return;
      lastVisibility = next;
      ownVisibilityEvent = new (viewWindow?.Event ?? Event)("visibilitychange");
      try {
        document.dispatchEvent(ownVisibilityEvent);
      } finally {
        ownVisibilityEvent = undefined;
      }
    },
    observe(changed) {
      const stop = contexts.observe(changed);
      return () => {
        stop();
        document.removeEventListener(
          "visibilitychange",
          visibilityChanged,
          true,
        );
        restore();
        projected = false;
      };
    },
    contentContext() {
      const current = view();
      return current ? contexts.key(current) : null;
    },
    readContext() {
      const current = view();
      const panel = current?.closest(".msg-panel");
      const newestButton = panel?.querySelector(
        ".chat-msg-top-toolbar .new-message-btn",
      );
      const content = current?.querySelector(
        ".mcontentwrapper > .contentwrapper",
      );
      if (
        !current ||
        !panel ||
        !newestButton ||
        !content ||
        !explicitlyHidden(document, newestButton) ||
        !current.querySelector(".msg-wrap[data-post-id]") ||
        [...document.querySelectorAll(".syno-chat .ext-el-mask")].some((mask) =>
          visibleElement(document, mask),
        )
      )
        return null;
      // Swiph3l: Chat uses transformed FleXcroll wrappers, not native scrollTop. Its hidden newest/scroll-bottom button plus a physically visible content end prove the current route is at latest.
      const bounds = current.getBoundingClientRect();
      const end = content.getBoundingClientRect();
      if (
        ![bounds.top, bounds.bottom, end.bottom].every(Number.isFinite) ||
        end.bottom <= bounds.top ||
        end.bottom > bounds.bottom + 1
      )
        return null;
      return contexts.key(current);
    },
    interactionContext(event) {
      const current = view();
      return current && eventInside(event, current)
        ? contexts.key(current)
        : null;
    },
    // Swiph3l: Audited Synology Chat notifications have no conversation tag. Generic titles and sender names cannot safely identify a conversation for toast suppression.
    isViewingNotification: () => false,
  };
}
