export interface NativeMessageBridge {
  postMessage(value: unknown): void;
}

export interface NativeBridgeHost {
  chrome?: { webview?: NativeMessageBridge };
  __chatplusWebkitBridge?: NativeMessageBridge;
}

export function nativeBridge(host: NativeBridgeHost) {
  return host.chrome?.webview ?? host.__chatplusWebkitBridge;
}
