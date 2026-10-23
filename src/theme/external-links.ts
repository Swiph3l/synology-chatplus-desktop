import type { ProviderId } from "../app/providers";

export interface ExternalLinkPolicy {
  provider: ProviderId;
  origin: string;
}

const MAX_URL_LENGTH = 16_384;

function externalTarget(
  anchor: HTMLAnchorElement,
  document: Document,
  policy: ExternalLinkPolicy,
): string | null {
  if (
    anchor.hasAttribute("download") ||
    anchor.isContentEditable ||
    anchor.getAttribute("aria-disabled") === "true" ||
    anchor.closest("[inert]")
  )
    return null;
  const href = anchor.getAttribute("href");
  if (!href || href.length > MAX_URL_LENGTH) return null;
  let target: URL;
  try {
    target = new URL(href, document.baseURI);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.href.length > MAX_URL_LENGTH
  )
    return null;
  if (target.origin === policy.origin) return null;
  // Swiph3l: Slack's public workspace navigation spans subdomains. Discord's
  // signed attachment URLs keep their related, authenticated download view.
  if (
    target.protocol === "https:" &&
    !target.port &&
    ((policy.provider === "slack" &&
      (target.hostname === "slack.com" ||
        target.hostname.endsWith(".slack.com"))) ||
      (policy.provider === "discord" &&
        ["cdn.discordapp.com", "media.discordapp.net"].includes(
          target.hostname,
        ) &&
        /^\/attachments\/[^/]+\/[^/]+\/[^/]+/.test(target.pathname)))
  )
    return null;
  return target.href;
}

export function installExternalLinks(
  document: Document,
  policy: ExternalLinkPolicy,
  postMessage: (message: string) => void,
): () => void {
  const target = document.defaultView ?? document;
  const click = (raw: Event) => {
    const event = raw as MouseEvent;
    if (
      !event.isTrusted ||
      !event.cancelable ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement =>
          !!node &&
          (node as Element).nodeType === 1 &&
          (node as Element).localName === "a" &&
          (node as Element).hasAttribute("href"),
      );
    if (!anchor || anchor.ownerDocument !== document || !anchor.isConnected)
      return;
    const href = externalTarget(anchor, document, policy);
    if (!href) return;
    try {
      // Swiph3l: Send before consuming the click. If the native bridge is absent
      // or unavailable, ordinary navigation still reaches the native fallback.
      postMessage(JSON.stringify({ chatplusExternalLink: 1, href }));
    } catch {
      return;
    }
    // Only this explicit external link belongs to ChatPlus. Prevent a provider's
    // delegated handler from opening a second popup or swallowing the request.
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  target.addEventListener("click", click, true);
  return () => target.removeEventListener("click", click, true);
}
