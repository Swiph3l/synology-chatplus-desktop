import css from "./dark.css?inline";
import type { Theme } from "../app/settings";
declare global {
  interface Window {
    __chatplusTheme?: Theme;
    __chatplusSetTheme?: (theme: Theme) => void;
    __chatplusThemeBootstrap?: { setTheme: (theme: Theme) => void };
  }
}
(() => {
  // Swiph3l: Native navigation can evaluate the bootstrap again. Reuse its style,
  // observers and handlers instead of opening a second theme lifecycle.
  if (window.__chatplusThemeBootstrap) {
    window.__chatplusThemeBootstrap.setTheme(
      window.__chatplusTheme ?? "system",
    );
    return;
  }
  let preference: Theme = window.__chatplusTheme ?? "system";
  const media = matchMedia("(prefers-color-scheme: dark)");
  const style =
    document.querySelector<HTMLStyleElement>("style#chatplus-desktop-theme") ??
    document.createElement("style");
  style.id = "chatplus-desktop-theme";
  let observedRoot: HTMLElement | null = null;
  const rootObserver = new MutationObserver(() => apply());
  const apply = () => {
    const root = document.documentElement;
    if (!root) return;
    if (root !== observedRoot) {
      rootObserver.disconnect();
      rootObserver.observe(root, {
        childList: true,
        attributes: true,
        attributeFilter: ["data-chatplus-theme"],
      });
      observedRoot = root;
    }
    // Swiph3l: Keep the same node outside the provider-owned head/body. New messages,
    // editors and loading surfaces match CSS immediately, before observer work.
    if (style.textContent !== css) style.textContent = css;
    if (style.hasAttribute("media")) style.removeAttribute("media");
    if (style.disabled) style.disabled = false;
    if (style.parentNode !== root) root.appendChild(style);
    const resolved =
      preference === "system" ? (media.matches ? "dark" : "light") : preference;
    if (root.dataset.chatplusTheme !== resolved) {
      root.dataset.chatplusTheme = resolved;
    }
  };
  window.__chatplusSetTheme = (theme) => {
    preference = theme;
    window.__chatplusTheme = theme;
    apply();
  };
  window.__chatplusThemeBootstrap = { setTheme: window.__chatplusSetTheme };
  media.addEventListener("change", apply);
  // Swiph3l: Observe only document/root replacement and our own style. Provider message
  // mutations do not need stylesheet reinsertion or a subtree-wide DOM scan.
  new MutationObserver(apply).observe(document, {
    childList: true,
  });
  new MutationObserver(apply).observe(style, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["media", "disabled"],
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
