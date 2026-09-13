import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Theme } from "../app/settings";
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}
export async function bindShellTheme() {
  await listen<Theme>("theme-changed", ({ payload }) => applyTheme(payload));
  applyTheme(await invoke<Theme>("get_shell_theme"));
}
