import type {
  ProviderNotification,
  ProviderUnreadAdapter,
  ProviderUnreadSnapshot,
} from "./providers/types";

export interface ProviderHostWindow {
  __chatplusSetForeground?: (
    foreground: boolean,
    generation: number,
    incomingSequence?: number,
  ) => void;
  __chatplusIsViewingNotification?: (
    notification: ProviderNotification,
  ) => boolean;
  __chatplusAcceptRead?: (arrivals: number[]) => void;
  __chatplusCompleteArrival?: (arrival: number) => void;
  chrome?: { webview?: { postMessage: (value: unknown) => void } };
}

export function installUnreadAdapter(
  adapter: ProviderUnreadAdapter,
  document: Document,
  host: ProviderHostWindow,
) {
  let lastKey: string | undefined;
  let lastDiagnosticKey: string | undefined;
  let duplicateDiagnosticKey: string | undefined;
  let disposed = false;
  let scheduled = false;
  let foreground = false;
  let generation = 0;
  let interaction: string | null = null;
  let interactionContent: string | null = null;
  let interactionSequence = 0;
  let lastUnread: boolean | null = null;
  let interactionSawUnread = false;
  let incomingSequence = 0;
  let pendingRead: {
    context: string;
    content: string;
    generation: number;
    incomingSequence: number;
    sequence: number;
    sawUnread: boolean;
  } | null = null;
  const unseenArrivals = new Map<number, ProviderNotification | null>();
  const acceptedArrivals = new Set<number>();
  let arrivalOverflow = false;
  const revokeRead = () => {
    interaction = null;
    interactionContent = null;
    interactionSawUnread = false;
    pendingRead = null;
  };
  const post = (payload: object): boolean => {
    if (disposed || !host.chrome?.webview) return false;
    try {
      host.chrome.webview.postMessage(JSON.stringify(payload));
      return true;
    } catch {
      // Navigation can revoke the native bridge. A later observation may retry;
      // a failed send must not reserve a dedup key or manufacture read evidence.
      return false;
    }
  };
  const diagnostic = (
    event: "detected" | "normalized" | "duplicate-suppressed",
    reason: "provider-observation" | "unchanged-state",
  ) =>
    post({
      chatplusUnreadDiagnostic: 1,
      source: adapter.source,
      event,
      reason,
      generation,
    });
  const normalize = (
    state: ProviderUnreadSnapshot,
  ): ProviderUnreadSnapshot => ({
    hasUnread:
      state.hasUnread === true
        ? true
        : state.hasUnread === false
          ? false
          : null,
    // Current providers expose dots/overlapping mentions, not reliable message
    // totals. Preserve unknown and reject malformed counts rather than inventing zero.
    count:
      state.hasUnread === true &&
      Number.isSafeInteger(state.count) &&
      state.count! > 0 &&
      state.count! <= 0xffffffff
        ? state.count
        : null,
  });
  const retain = (
    arrival: number,
    notification: ProviderNotification | null,
  ) => {
    if (acceptedArrivals.has(arrival)) return;
    // Swiph3l: Never evict an unproven arrival to manufacture a read zero.
    // Saturated history requires a proven provider-wide zero to recover.
    if (!unseenArrivals.has(arrival) && unseenArrivals.size >= 256) {
      arrivalOverflow = true;
      return;
    }
    unseenArrivals.set(arrival, notification);
  };
  const visible = () =>
    foreground && document.visibilityState === "visible" && document.hasFocus();
  const publish = (
    hasUnread: boolean,
    count: number | null,
    reason: string,
    acknowledgement: number | null = null,
    readArrivals: number[] = [],
    proofOnly = false,
    readScope?: "provider-zero",
  ) => {
    const arrivals =
      acknowledgement === null
        ? []
        : [...new Set(readArrivals)].filter(
            (arrival) => Number.isSafeInteger(arrival) && arrival > 0,
          );
    // State equality is separate from exact read-token equality. A new arrival
    // proof cannot disappear merely because its provider badge is unchanged.
    const proofKey = [...arrivals].sort((a, b) => a - b).join(",");
    const key = `${hasUnread ? 1 : 0}:${count ?? "dot"}:${proofOnly ? "proof" : "state"}:${readScope ?? "exact"}:${acknowledgement === null ? "observation" : `${acknowledgement}:${interactionSequence}:${proofKey}`}`;
    if (lastKey === key) {
      if (
        duplicateDiagnosticKey !== key &&
        diagnostic("duplicate-suppressed", "unchanged-state")
      )
        duplicateDiagnosticKey = key;
      return;
    }
    if (
      post({
        chatplusUnread: 1,
        source: adapter.source,
        hasUnread,
        count,
        reason,
        acknowledgement,
        readArrivals: arrivals,
        proofOnly: proofOnly || undefined,
        readScope,
      })
    ) {
      lastKey = key;
      duplicateDiagnosticKey = undefined;
    }
  };
  const report = () => {
    scheduled = false;
    if (disposed) return;
    const state = normalize(adapter.snapshot());
    const diagnosticKey = `${state.hasUnread === null ? "unknown" : Number(state.hasUnread)}:${state.count ?? "dot"}`;
    if (lastDiagnosticKey !== diagnosticKey) {
      diagnostic("detected", "provider-observation");
      if (diagnostic("normalized", "provider-observation"))
        lastDiagnosticKey = diagnosticKey;
    }
    if (!visible()) revokeRead();
    if (state.hasUnread === true) {
      // Swiph3l: Input before a new message cannot acknowledge it; a gesture is retained only when it already observed the unread being read.
      if (lastUnread !== true && !interactionSawUnread) interaction = null;
    }
    // Swiph3l: Foreground trusted interaction is conversation-specific read evidence;
    // service selection or retained WebView focus alone is not.
    const content = adapter.contentContext();
    const genuineRead =
      visible() &&
      interaction !== null &&
      adapter.readContext() === interaction &&
      content !== null &&
      interactionContent === content;
    const readArrivals: number[] = [];
    // Swiph3l: Synology does not expose reliable notification tags. A proven provider
    // zero plus fresh conversation input can retire completed arrivals without
    // inventing a tag mapping; native generation checks still protect pending arrivals.
    const providerZero =
      genuineRead &&
      state.hasUnread === false &&
      adapter.providerUnreadZero?.() === true;
    if (genuineRead) {
      // Swiph3l: Changed content may be an old avatar or another message. Retry retained native tags against actual visible rows; unrelated DOM changes cannot read unseen arrivals.
      for (const [arrival, notification] of unseenArrivals)
        if (
          providerZero ||
          (notification && adapter.isViewingNotification(notification))
        )
          readArrivals.push(arrival);
    }
    // Swiph3l: Read proofs are fresh for this gesture. Native revalidation may reject a stale foreground snapshot, so only its acknowledgement can retire retained event tags.
    const acknowledged =
      genuineRead &&
      (providerZero ||
        (!arrivalOverflow &&
          (unseenArrivals.size === 0 || readArrivals.length > 0)));
    if (state.hasUnread === null) {
      // Swiph3l: Missing aggregate UI cannot become zero, but an exact current-message read must still progress independently of another unread/unknown conversation.
      if (acknowledged && readArrivals.length > 0) {
        publish(
          false,
          null,
          "native-read-proof",
          generation,
          readArrivals,
          true,
        );
        interaction = null;
        interactionSawUnread = false;
      }
      return;
    }
    if (state.hasUnread) {
      lastUnread = true;
      const partialRead = acknowledged && readArrivals.length > 0;
      publish(
        true,
        state.count,
        "badge-present",
        partialRead ? generation : null,
        readArrivals,
      );
      if (partialRead) {
        interaction = null;
        interactionSawUnread = false;
      }
      return;
    }
    publish(
      false,
      null,
      acknowledged ? "user-read-acknowledgement" : "provider-empty",
      acknowledged ? generation : null,
      readArrivals,
      false,
      providerZero ? "provider-zero" : undefined,
    );
    lastUnread = false;
    if (acknowledged) {
      // Swiph3l: A trusted read can beat native query completion. Retain only this
      // exact gesture context so completion can retry it without a clear timer.
      if (providerZero && unseenArrivals.size > 0)
        pendingRead = {
          context: interaction!,
          content: interactionContent!,
          generation,
          incomingSequence,
          sequence: interactionSequence,
          sawUnread: interactionSawUnread,
        };
      interaction = null;
    }
    interactionSawUnread = false;
  };
  const schedule = () => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(report);
  };
  host.__chatplusSetForeground = (value, nextGeneration, nextIncoming = 0) => {
    if (disposed || !Number.isSafeInteger(nextGeneration) || nextGeneration < 0)
      return;
    // Swiph3l: Queued native snapshots may arrive out of order; old visibility must never revive a revoked conversation gesture.
    if (nextGeneration < generation) return;
    const newArrival =
      Number.isSafeInteger(nextIncoming) && nextIncoming > incomingSequence;
    if (value !== foreground || generation !== nextGeneration || newArrival) {
      revokeRead();
    }
    if (newArrival) {
      incomingSequence = nextIncoming;
      retain(nextIncoming, null);
    }
    foreground = value;
    generation = nextGeneration;
    adapter.onHostForegroundChanged?.(value);
    schedule();
  };
  host.__chatplusIsViewingNotification = (notification) => {
    if (disposed) return false;
    const arrival = notification.arrival;
    if (Number.isSafeInteger(arrival) && arrival! > 0) {
      if (arrival! > incomingSequence) {
        // Swiph3l: A notification query can beat its queued native projection;
        // revoke prior input here too so an old gesture cannot read a new event.
        revokeRead();
      }
      incomingSequence = Math.max(incomingSequence, arrival!);
      retain(arrival!, notification);
    }
    // Swiph3l: Renderer visibility may be stale by native callback time. This query only retains tags/returns evidence; it cannot mint a lasting read proof.
    return visible() && adapter.isViewingNotification(notification);
  };
  host.__chatplusAcceptRead = (arrivals) => {
    if (disposed || !Array.isArray(arrivals) || arrivals.length > 256) return;
    for (const arrival of arrivals) {
      if (!Number.isSafeInteger(arrival) || arrival <= 0) continue;
      unseenArrivals.delete(arrival);
      acceptedArrivals.add(arrival);
      // Swiph3l: Bounded accepted history prevents late retries from restoring retired tags; eviction can only retain extra unread, never acknowledge an unseen event.
      if (acceptedArrivals.size > 256)
        acceptedArrivals.delete(acceptedArrivals.values().next().value!);
    }
    // Swiph3l: Saturation may have omitted the newest pending token locally;
    // emptying retained tags is not confirmation that native finished that arrival.
    if (
      unseenArrivals.size === 0 &&
      (pendingRead === null ||
        acceptedArrivals.has(pendingRead.incomingSequence))
    ) {
      arrivalOverflow = false;
      pendingRead = null;
    }
    schedule();
  };
  host.__chatplusCompleteArrival = (arrival) => {
    if (disposed) return;
    if (!visible()) {
      revokeRead();
      return;
    }
    const candidate = pendingRead;
    if (
      !Number.isSafeInteger(arrival) ||
      arrival <= 0 ||
      arrival > incomingSequence ||
      candidate === null ||
      candidate.generation !== generation ||
      candidate.incomingSequence !== incomingSequence ||
      adapter.readContext() !== candidate.context ||
      adapter.contentContext() !== candidate.content
    )
      return;
    // Swiph3l: Native still filters pending arrivals. Completion only retries a
    // valid earlier conversation gesture; it cannot manufacture new read input.
    interaction = candidate.context;
    interactionContent = candidate.content;
    interactionSequence = candidate.sequence;
    interactionSawUnread = candidate.sawUnread;
    lastKey = undefined;
    schedule();
  };
  const interact = (event: Event) => {
    if (disposed || !event.isTrusted || !visible()) return;
    if (
      event instanceof KeyboardEvent &&
      ["Alt", "Control", "Meta", "Shift", "Tab"].includes(event.key)
    )
      return;
    const context = adapter.interactionContext(event);
    if (context === null) return;
    interaction = context;
    interactionContent = adapter.contentContext();
    interactionSawUnread = normalize(adapter.snapshot()).hasUnread === true;
    interactionSequence += 1;
    schedule();
  };
  document.addEventListener("pointerdown", interact, true);
  document.addEventListener("click", interact, true);
  document.addEventListener("keydown", interact, true);
  document.addEventListener("beforeinput", interact, true);
  document.addEventListener("input", interact, true);
  document.addEventListener("wheel", interact, true);
  const presentationChanged = (event: Event) => {
    // A child document can lose focus while its native frame stays foreground.
    // Restoring it is presentation, never continuation of an earlier read gesture.
    if (event.type === "blur" || event.type === "focus" || !visible())
      revokeRead();
    schedule();
  };
  document.defaultView?.addEventListener("blur", presentationChanged, true);
  document.defaultView?.addEventListener("focus", presentationChanged, true);
  document.addEventListener("visibilitychange", presentationChanged, true);
  adapter.onHostForegroundChanged?.(false);
  const stop = adapter.observe(schedule);
  schedule();
  return () => {
    disposed = true;
    stop();
    document.removeEventListener("pointerdown", interact, true);
    document.removeEventListener("click", interact, true);
    document.removeEventListener("keydown", interact, true);
    document.removeEventListener("beforeinput", interact, true);
    document.removeEventListener("input", interact, true);
    document.removeEventListener("wheel", interact, true);
    document.defaultView?.removeEventListener(
      "blur",
      presentationChanged,
      true,
    );
    document.defaultView?.removeEventListener(
      "focus",
      presentationChanged,
      true,
    );
    document.removeEventListener("visibilitychange", presentationChanged, true);
    delete host.__chatplusSetForeground;
    delete host.__chatplusIsViewingNotification;
    delete host.__chatplusAcceptRead;
    delete host.__chatplusCompleteArrival;
  };
}
