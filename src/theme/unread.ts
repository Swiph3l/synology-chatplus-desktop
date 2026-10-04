import {
  installUnreadAdapter,
  type ProviderHostWindow,
} from "./provider-unread";
import { createChatplusAdapter } from "./providers/chatplus";
import { createSynologyChatAdapter } from "./providers/synology-chat";
import { createDiscordAdapter } from "./providers/discord";
import type { ProviderId } from "../app/providers";

(() => {
  if (window.top !== window) return;
  const host = window as unknown as ProviderHostWindow & {
    __chatplusProvider?: ProviderId;
  };
  // Swiph3l: Provider markup and read rules are different; sharing the host lifecycle must never make Synology Chat or Discord use ChatPlus selectors.
  const adapters = {
    "synology-chatplus": createChatplusAdapter,
    "synology-chat": createSynologyChatAdapter,
    discord: createDiscordAdapter,
  };
  const provider = host.__chatplusProvider ?? "synology-chatplus";
  const adapter = Object.hasOwn(adapters, provider)
    ? adapters[provider as keyof typeof adapters]
    : undefined;
  if (adapter) installUnreadAdapter(adapter(document), document, host);
})();
