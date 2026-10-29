import {
  installExternalLinks,
  type ExternalLinkPolicy,
} from "./external-links";
import { nativeBridge, type NativeBridgeHost } from "./native-bridge";

(() => {
  if (window.top !== window) return;
  const host = window as unknown as NativeBridgeHost & {
    __chatplusExternalLinkPolicy?: ExternalLinkPolicy;
    __chatplusExternalLinkBridge?: () => void;
  };
  const policy = host.__chatplusExternalLinkPolicy;
  const bridge = nativeBridge(host);
  if (!policy || typeof bridge?.postMessage !== "function") return;
  const postMessage = bridge.postMessage.bind(bridge);
  host.__chatplusExternalLinkBridge?.();
  host.__chatplusExternalLinkBridge = installExternalLinks(
    document,
    policy,
    postMessage,
  );
})();
