export function bridgeMessages() {
  const messages = [];
  const diagnostics = [];
  const allMessages = [];
  return {
    messages,
    diagnostics,
    allMessages,
    postMessage(value) {
      const payload = JSON.parse(value);
      allMessages.push(payload);
      // Telemetry shares the bridge with unread state. Retain it for its own
      // assertions without treating it as a state transition or dropping any
      // other bridge message, including notification payloads.
      if (payload.chatplusUnreadDiagnostic === 1) diagnostics.push(payload);
      else messages.push(payload);
    },
  };
}
