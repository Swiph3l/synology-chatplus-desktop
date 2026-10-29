// Adapted from turbogizzmo's macOS fork, commit b53e860 (GPL-3.0-only).
import type { ProviderHostWindow } from "./provider-unread";
import { nativeBridge } from "./native-bridge";

// WKWebView has no usable web Notification API on macOS. Providers get a
// standards-shaped replacement that forwards to the shell; delivery, muting and
// focus suppression stay native decisions, exactly as with WebView2 on Windows.
export const TITLE_LIMIT = 512;
export const BODY_LIMIT = 4096;
export const TAG_LIMIT = 512;

type Permission = "default" | "granted" | "denied";

export interface WebkitNotificationHost extends ProviderHostWindow {
  Notification?: unknown;
  crypto?: Pick<Crypto, "getRandomValues">;
}

const text = (value: unknown, limit: number) =>
  value === undefined || value === null ? "" : String(value).slice(0, limit);

export function sessionId(host: WebkitNotificationHost): string {
  const bytes = new Uint8Array(16);
  try {
    host.crypto?.getRandomValues(bytes);
  } catch {
    // Random identity only separates page loads; a zeroed id still works for one load.
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function installWebkitNotifications(host: WebkitNotificationHost) {
  const session = sessionId(host);
  let next = 0;

  class ChatPlusNotification extends EventTarget {
    // Granting here only lets providers create notifications; the shell drops
    // them when global, service or macOS notification settings say no.
    static get permission(): Permission {
      return "granted";
    }
    static requestPermission(
      callback?: (permission: Permission) => void,
    ): Promise<Permission> {
      try {
        callback?.("granted");
      } catch {
        // A provider callback failure must not reject the permission promise.
      }
      return Promise.resolve("granted");
    }
    static get maxActions() {
      return 0;
    }

    readonly title: string;
    readonly body: string;
    readonly tag: string;
    readonly icon: string;
    readonly data: unknown;
    readonly silent: boolean | null;
    readonly timestamp = Date.now();
    onclick: ((event: Event) => void) | null = null;
    onshow: ((event: Event) => void) | null = null;
    onclose: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    #id: number;
    #closed = false;

    constructor(title: string, options: NotificationOptions = {}) {
      super();
      if (arguments.length === 0)
        throw new TypeError("Notification requires a title.");
      this.title = text(title, TITLE_LIMIT);
      this.body = text(options.body, BODY_LIMIT);
      // Correlation tags must remain exact; a clipped prefix could identify
      // another notification. Oversized tags carry no conversation evidence.
      const tag = text(options.tag, TAG_LIMIT + 1);
      this.tag = tag.length > TAG_LIMIT ? "" : tag;
      this.icon = text(options.icon, 2048);
      this.data = options.data ?? null;
      this.silent = typeof options.silent === "boolean" ? options.silent : null;
      this.#id = ++next;
      let sent = false;
      const bridge = nativeBridge(host);
      if (bridge) {
        try {
          bridge.postMessage(
            JSON.stringify({
              chatplusNotification: 1,
              session,
              id: this.#id,
              title: this.title,
              body: this.body,
              tag: this.tag,
              silent: this.silent === true,
            }),
          );
          sent = true;
        } catch {
          // A navigating view can revoke the bridge; report the failure like a browser would.
        }
      }
      queueMicrotask(() => this.#fire(sent ? "show" : "error"));
    }

    close() {
      if (this.#closed) return;
      this.#closed = true;
      queueMicrotask(() => this.#fire("close"));
    }

    #fire(type: "show" | "close" | "error") {
      const event = new Event(type);
      const handler = this[`on${type}`];
      try {
        if (typeof handler === "function") handler.call(this, event);
      } catch {
        // Provider handler errors stay inside the provider, as with native events.
      }
      this.dispatchEvent(event);
    }
  }

  Object.defineProperty(host, "Notification", {
    configurable: true,
    writable: true,
    value: ChatPlusNotification,
  });
  return ChatPlusNotification;
}

(() => {
  if (typeof window === "undefined" || window.top !== window) return;
  installWebkitNotifications(window as unknown as WebkitNotificationHost);
})();
