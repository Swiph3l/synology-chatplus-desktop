import {
  installUnreadAdapter,
  type ProviderHostWindow,
} from "./provider-unread";
import { createChatplusAdapter } from "./providers/chatplus";
import { createSynologyChatAdapter } from "./providers/synology-chat";
import { createDiscordAdapter } from "./providers/discord";
import { createWhatsAppAdapter } from "./providers/whatsapp";
import { createMessengerAdapter } from "./providers/messenger";
import { createMattermostAdapter } from "./providers/mattermost";
import type { ProviderId } from "../app/providers";

(() => {
  if (window.top !== window) return;
  const installed = Symbol.for("chatplus.unread.installed");
  const host = window as unknown as ProviderHostWindow & {
    __chatplusProvider?: ProviderId;
    [installed]?: boolean;
  };
  if (host[installed]) return;
  // Swiph3l: Provider markup and read rules are different; sharing the host lifecycle must never make Synology Chat or Discord use ChatPlus selectors.
  const adapters = {
    "synology-chatplus": createChatplusAdapter,
    "synology-chat": createSynologyChatAdapter,
    discord: createDiscordAdapter,
    whatsapp: createWhatsAppAdapter,
    messenger: createMessengerAdapter,
    mattermost: createMattermostAdapter,
  };
  const provider = host.__chatplusProvider ?? "synology-chatplus";
  const adapter = Object.hasOwn(adapters, provider)
    ? adapters[provider as keyof typeof adapters]
    : undefined;
  if (!adapter) return;
  const dispose = installUnreadAdapter(adapter(document), document, host);
  host[installed] = true;
  const leave = (event: PageTransitionEvent) => {
    if (!event.isTrusted || event.persisted) return;
    window.removeEventListener("pagehide", leave);
    dispose();
    delete host[installed];
  };
  window.addEventListener("pagehide", leave);
})();
