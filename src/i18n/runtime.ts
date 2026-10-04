import { listen } from "@tauri-apps/api/event";
import { getSettings, type Settings } from "../app/settings";
import { setLanguage } from "./index";

export async function initializeLanguage() {
  const settings = await getSettings();
  setLanguage(settings.language);
  await listen<Settings>("settings-changed", ({ payload }) => {
    setLanguage(payload.language);
    window.dispatchEvent(new Event("language-changed"));
  });
}
