import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "./settings";
import type { Language } from "../i18n";

export interface ExternalLinkPrompt {
  requestId: string;
  url: string;
  origin: string;
  insecureHttp: boolean;
  theme: Theme;
  language: Language;
}

export const externalLinks = {
  prompt: () => invoke<ExternalLinkPrompt>("get_external_link_prompt"),
  ready: (requestId: string) =>
    invoke<void>("external_link_prompt_ready", { requestId }),
  // Swiph3l: Only the native retained request may choose the URL to open.
  respond: (requestId: string, accepted: boolean) =>
    invoke<void>("respond_external_link_prompt", { requestId, accepted }),
};
