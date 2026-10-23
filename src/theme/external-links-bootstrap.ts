import {
  installExternalLinks,
  type ExternalLinkPolicy,
} from "./external-links";

(() => {
  if (window.top !== window) return;
  const host = window as unknown as {
    __chatplusExternalLinkPolicy?: ExternalLinkPolicy;
    __chatplusExternalLinkBridge?: () => void;
    chrome?: { webview?: { postMessage?: (message: string) => void } };
  };
  const policy = host.__chatplusExternalLinkPolicy;
  const bridge = host.chrome?.webview;
  if (!policy || typeof bridge?.postMessage !== "function") return;
  const postMessage = bridge.postMessage.bind(bridge);
  host.__chatplusExternalLinkBridge?.();
  host.__chatplusExternalLinkBridge = installExternalLinks(
    document,
    policy,
    postMessage,
  );
})();
