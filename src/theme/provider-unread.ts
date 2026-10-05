import type {
  ProviderNotification,
  ProviderUnreadAdapter,
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
    const key = `${hasUnread ? 1 : 0}:${count ?? "dot"}:${proofOnly ? "proof" : "state"}:${readScope ?? "exact"}:${acknowledgement === null ? "observation" : `${acknowledgement}:${interactionSequence}`}`;
    if (lastKey === key) return;
    lastKey = key;
    host.chrome?.webview?.postMessage(
      JSON.stringify({
        chatplusUnread: 1,
        source: adapter.source,
        hasUnread,
        count,
        reason,
        acknowledgement,
        readArrivals: acknowledgement === null ? [] : readArrivals,
        proofOnly: proofOnly || undefined,
        readScope,
      }),
    );
  };
  const report = () => {
    scheduled = false;
    if (disposed) return;
    const state = adapter.snapshot();
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
    // Swiph3l: Queued native snapshots may arrive out of order; old visibility must never revive a revoked conversation gesture.
    if (nextGeneration < generation) return;
    const newArrival =
      Number.isSafeInteger(nextIncoming) && nextIncoming > incomingSequence;
    if (value !== foreground || generation !== nextGeneration || newArrival) {
      interaction = null;
      interactionContent = null;
      interactionSawUnread = false;
      pendingRead = null;
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
    const arrival = notification.arrival;
    if (Number.isSafeInteger(arrival) && arrival! > 0) {
      if (arrival! > incomingSequence) {
        // Swiph3l: A notification query can beat its queued native projection;
        // revoke prior input here too so an old gesture cannot read a new event.
        interaction = null;
        interactionContent = null;
        interactionSawUnread = false;
        pendingRead = null;
      }
      incomingSequence = Math.max(incomingSequence, arrival!);
      retain(arrival!, notification);
    }
    // Swiph3l: Renderer visibility may be stale by native callback time. This query only retains tags/returns evidence; it cannot mint a lasting read proof.
    return visible() && adapter.isViewingNotification(notification);
  };
  host.__chatplusAcceptRead = (arrivals) => {
    if (!Array.isArray(arrivals) || arrivals.length > 256) return;
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
    const candidate = pendingRead;
    if (
      !Number.isSafeInteger(arrival) ||
      arrival <= 0 ||
      arrival > incomingSequence ||
      candidate === null ||
      !visible() ||
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
    if (!event.isTrusted || !visible()) return;
    if (
      event instanceof KeyboardEvent &&
      ["Alt", "Control", "Meta", "Shift", "Tab"].includes(event.key)
    )
      return;
    const context = adapter.interactionContext(event);
    if (context === null) return;
    interaction = context;
    interactionContent = adapter.contentContext();
    interactionSawUnread = adapter.snapshot().hasUnread === true;
    interactionSequence += 1;
    schedule();
  };
  document.addEventListener("pointerdown", interact, true);
  document.addEventListener("click", interact, true);
  document.addEventListener("keydown", interact, true);
  document.addEventListener("beforeinput", interact, true);
  document.addEventListener("input", interact, true);
  document.addEventListener("wheel", interact, true);
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
    delete host.__chatplusSetForeground;
    delete host.__chatplusIsViewingNotification;
    delete host.__chatplusAcceptRead;
    delete host.__chatplusCompleteArrival;
  };
}
