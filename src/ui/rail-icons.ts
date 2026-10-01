import type { ProviderId } from "../app/providers";

const assets: Record<ProviderId, string> = {
  "synology-chatplus": "/providers/synology-chatplus.png",
  "synology-chat": "/providers/synology-chat.png",
  slack: "/providers/slack.svg",
  discord: "/providers/discord.svg",
  mattermost: "/providers/mattermost.svg",
};

export function providerIcon(provider: ProviderId) {
  const icon = document.createElement("img");
  icon.className = "provider-icon";
  if (provider === "mattermost") icon.classList.add("provider-icon-mattermost");
  icon.src = assets[provider];
  icon.alt = "";
  icon.width = 26;
  icon.height = 26;
  icon.draggable = false;
  return icon;
}

export function railIcon(kind: "desktop" | "add" | "settings") {
  const icon = document.createElement("span");
  icon.className = "rail-icon";
  icon.setAttribute("aria-hidden", "true");
  const paths = {
    desktop:
      '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/><path d="M8 9h8m-8 3h5"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    settings:
      '<path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1L9 21h6l.5-2 2-1 2 .5 2-3-1.5-2v-3L21.5 9l-2-3-2 .5-2-1L15 3Z"/><circle cx="12" cy="12" r="3"/>',
  };
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg>`;
  return icon;
}
