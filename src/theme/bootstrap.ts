import css from "./dark.css?inline";
import type { Theme } from "../app/settings";
declare global {
  interface Window {
    __chatplusTheme?: Theme;
    __chatplusSetTheme?: (theme: Theme) => void;
  }
}
(() => {
  let preference: Theme = window.__chatplusTheme ?? "system";
  const media = matchMedia("(prefers-color-scheme: dark)");
  const style = document.createElement("style");
  style.id = "chatplus-desktop-theme";
  style.textContent = css;
  const apply = () => {
    const root = document.documentElement;
    if (!root) return;
    if (!style.isConnected) root.appendChild(style);
    const resolved =
      preference === "system" ? (media.matches ? "dark" : "light") : preference;
    if (root.dataset.chatplusTheme !== resolved) {
      root.dataset.chatplusTheme = resolved;
    }
  };
  window.__chatplusSetTheme = (theme) => {
    preference = theme;
    apply();
  };
  media.addEventListener("change", apply);
  new MutationObserver(apply).observe(document, {
    childList: true,
    subtree: true,
  });
  apply();
  // Keep target=_blank links within the native navigation policy, including WebView2
  // versions that do not emit new-window events for anchor elements.
  document.addEventListener(
    "click",
    (event) => {
      const anchor = event
        .composedPath()
        .find((node) => node instanceof HTMLAnchorElement) as
        HTMLAnchorElement | undefined;
      if (
        anchor &&
        !anchor.hasAttribute("download") &&
        anchor.target === "_blank" &&
        /^https?:$/.test(new URL(anchor.href).protocol)
      ) {
        event.preventDefault();
        location.assign(anchor.href);
      }
    },
    true,
  );
})();
