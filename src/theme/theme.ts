/**
 * ChatPlus Desktop — Theme Manager
 *
 * Manages Light, Dark, and System theme selection.
 * The selected theme CSS is injected into the WebView before the page is
 * revealed to prevent white flashes on startup.
 *
 * Status: Placeholder — implementation pending.
 */

export type Theme = 'light' | 'dark' | 'system';

/**
 * Returns the resolved theme ('light' or 'dark') based on the user's
 * preference and the system color scheme when 'system' is selected.
 */
export function resolveTheme(preference: Theme): 'light' | 'dark' {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return preference;
}

/**
 * Loads and injects the appropriate theme CSS into the document.
 * Call this before revealing the WebView window to avoid flash of unstyled content.
 *
 * @param preference - The user's theme preference.
 */
export async function applyTheme(preference: Theme): Promise<void> {
  // TODO: Implement CSS injection via Tauri's WebView API.
  const resolved = resolveTheme(preference);
  console.debug(`[theme] Applying theme: ${resolved} (preference: ${preference})`);
}
