import type { NativeBridgeHost } from "./native-bridge";

export const QUEUE_LIMIT = 128;
export const MESSAGE_LIMIT = 16_384;
export const QUEUE_BYTES = 262_144;
export const BATCH_LIMIT = 32;

interface Host extends NativeBridgeHost {
  top: unknown;
  crypto: Pick<Crypto, "getRandomValues">;
  location: { href: string };
  __chatplusUnreadObservationEpoch?: string;
}

// Swiph3l: WebKit pages receive a bounded outbox, never native IPC authority.
// Native eval drains the top document and independently verifies its live URL
// and document identity before applying any packet. Polling never scans the DOM.
export function installWebkitBridge(host: Host) {
  if (host.top !== host || host.__chatplusWebkitBridge) return null;
  const bytes = new Uint8Array(16);
  try {
    host.crypto.getRandomValues(bytes);
  } catch {
    return null;
  }
  const documentId = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  let size = 0;
  const queue: string[] = [];
  const bridge = Object.freeze({
    documentId,
    postMessage(value: unknown) {
      if (typeof value !== "string" || value.length > MESSAGE_LIMIT)
        throw new TypeError("Invalid bridge packet");
      if (queue.length >= QUEUE_LIMIT || size + value.length > QUEUE_BYTES)
        throw new Error("Bridge outbox is full");
      queue.push(value);
      size += value.length;
    },
    drain() {
      const messages = queue.splice(0, BATCH_LIMIT);
      for (const message of messages) size -= message.length;
      return {
        documentId,
        url: host.location.href,
        attentionEpoch: host.__chatplusUnreadObservationEpoch ?? null,
        messages,
      };
    },
  });
  Object.defineProperty(host, "__chatplusWebkitBridge", { value: bridge });
  return bridge;
}

if (typeof window !== "undefined")
  installWebkitBridge(window as unknown as Host);
