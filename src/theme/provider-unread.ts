import type {
  ProviderNotification,
  ProviderUnreadAdapter,
  ProviderUnreadSnapshot,
} from "./providers/types";
import { currentReadArrivals, readCapabilities } from "./providers/read";

export interface ProviderHostWindow {
  readonly __chatplusUnreadObservationEpoch?: string;
  __chatplusSetForeground?: (
    foreground: boolean,
    generation: number,
    incomingSequence?: number,
  ) => void;
  __chatplusIsViewingNotification?: (
    notification: ProviderNotification,
  ) => boolean;
  __chatplusAcceptRead?: (arrivals: number[], completeThrough?: number) => void;
  __chatplusCompleteArrival?: (arrival: number) => void;
  __chatplusMarkCurrentRead?: () => boolean;
  __chatplusReadAllStep?: (
    operation: string,
  ) => import("./providers/discord-read").InboxReadStatus;
  __chatplusAcknowledgeAllLocal?: (through: number) => void;
  __chatplusPrepareToastRead?: (
    notification: ProviderNotification,
    expectedGeneration: number,
    expectedIncoming: number,
  ) => boolean;
  chrome?: { webview?: { postMessage: (value: unknown) => void } };
}

export function installUnreadAdapter(
  adapter: ProviderUnreadAdapter,
  document: Document,
  host: ProviderHostWindow,
) {
  let lastKey: string | undefined;
  let lastAttentionKey: string | undefined;
  let lastConversationReadKey: string | undefined;
  let lastDiagnosticKey: string | undefined;
  let duplicateDiagnosticKey: string | undefined;
  let readContextDiagnosticGeneration = -1;
  const readContextDiagnostics = new Set<string>();
  let disposed = false;
  let scheduled = false;
  let foreground = false;
  let generation = 0;
  let interaction: string | null = null;
  let interactionContent: string | null = null;
  let interactionSequence = 0;
  let lastUnread: boolean | null = null;
  let interactionSawUnread = false;
  let toastRead: {
    notification: ProviderNotification;
    generation: number;
    incoming: number;
    expires: number;
    context: string | null;
    content: string | null;
  } | null = null;
  let incomingSequence = 0;
  let localAcknowledgedThrough = 0;
  let providerRevision = 0;
  let evidenceKey: string | undefined;
  let observedState: ProviderUnreadSnapshot = { hasUnread: null, count: null };
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
  let observationEpoch: string | null = null;
  if (adapter.source === "whatsapp-dom") {
    try {
      const epoch = globalThis.crypto?.randomUUID();
      if (epoch) {
        // Swiph3l: Native checks this document-owned nonce before accepting a
        // counter snapshot; delayed packets from a replaced document stay stale.
        Object.defineProperty(host, "__chatplusUnreadObservationEpoch", {
          get: () => epoch,
          configurable: false,
        });
        observationEpoch = epoch;
      }
    } catch {
      // Without a document identity, retain unknown rather than weaken ordering.
    }
  }
  const revokeRead = () => {
    interaction = null;
    interactionContent = null;
    interactionSawUnread = false;
    pendingRead = null;
    toastRead = null;
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
    // Swiph3l: Current providers expose dots/overlapping mentions, not reliable message
    // totals. Preserve unknown and reject malformed counts rather than inventing zero.
    count:
      state.hasUnread === true &&
      Number.isSafeInteger(state.count) &&
      state.count! > 0 &&
      state.count! <= 0xffffffff
        ? state.count
        : null,
    conversations: state.conversations,
    currentConversation: state.currentConversation ?? adapter.readContext(),
    unreadScope: state.unreadScope,
    unattributedUnread: state.unattributedUnread,
  });
  const observeState = () => {
    observedState = normalize(adapter.snapshot());
    const next = JSON.stringify(observedState);
    if (next !== evidenceKey) {
      providerRevision += 1;
      evidenceKey = next;
    }
    return observedState;
  };
  const retain = (
    arrival: number,
    notification: ProviderNotification | null,
  ) => {
    if (arrival <= localAcknowledgedThrough || acceptedArrivals.has(arrival))
      return;
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
    hasUnread: boolean | null,
    count: number | null,
    reason: string,
    acknowledgement: number | null = null,
    readArrivals: number[] = [],
    proofOnly = false,
    readScope?: "provider-zero" | "conversation-read",
    proposalKey?: string,
  ) => {
    const arrivals =
      acknowledgement === null
        ? []
        : [...new Set(readArrivals)].filter(
            (arrival) => Number.isSafeInteger(arrival) && arrival > 0,
          );
    // Swiph3l: State equality is separate from exact read-token equality. A new arrival
    // proof cannot disappear merely because its provider badge is unchanged.
    const proofKey = [...arrivals].sort((a, b) => a - b).join(",");
    const key =
      proposalKey ??
      `${providerRevision}:${hasUnread === null ? "unknown" : Number(hasUnread)}:${count ?? "dot"}:${proofOnly ? "proof" : "state"}:${readScope ?? "exact"}:${acknowledgement === null ? "observation" : `${acknowledgement}:${interactionSequence}:${proofKey}`}`;
    if (lastKey === key) {
      if (
        duplicateDiagnosticKey !== key &&
        diagnostic("duplicate-suppressed", "unchanged-state")
      )
        duplicateDiagnosticKey = key;
      return true;
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
        providerRevision,
        certainty:
          observedState.hasUnread === null
            ? "unknown"
            : observedState.hasUnread
              ? "known-unread"
              : "known-read",
        currentConversation: observedState.currentConversation,
        conversations: observedState.conversations,
        unreadScope: observedState.unreadScope,
        unattributedUnread: observedState.unattributedUnread,
      })
    ) {
      lastKey = key;
      duplicateDiagnosticKey = undefined;
      return true;
    }
    return false;
  };
  const publishConversationRead = (
    state: ProviderUnreadSnapshot,
    context: string,
    content: string,
    reason: string,
  ) => {
    const key = JSON.stringify([
      "conversation-read",
      generation,
      incomingSequence,
      context,
      content,
      providerRevision,
    ]);
    // Swiph3l: Repeated pane input cannot reread the same native owner. Keep one
    // successful proposal apart from observations; changed evidence can retry.
    if (lastConversationReadKey === key) return true;
    const sent = publish(
      state.hasUnread,
      state.count,
      reason,
      generation,
      [],
      false,
      "conversation-read",
      key,
    );
    if (sent) lastConversationReadKey = key;
    return sent;
  };
  const publishAttention = (state: ProviderUnreadSnapshot) => {
    if (observationEpoch === null) return;
    const key = `${providerRevision}:${incomingSequence}:${state.hasUnread === null ? "unknown" : Number(state.hasUnread)}:${state.count ?? "dot"}`;
    if (key === lastAttentionKey) return;
    // Swiph3l: WhatsApp's own notification counter has a narrower scope than
    // all chats. Its zero is attention state, never a message-read proof.
    if (
      post({
        chatplusUnread: 1,
        source: adapter.source,
        unreadScope: "notification-attention",
        hasUnread: state.hasUnread,
        count: state.count,
        certainty: "unknown",
        providerRevision,
        observationEpoch,
        reason: "notification-attention",
      })
    )
      lastAttentionKey = key;
  };
  const report = () => {
    scheduled = false;
    if (disposed) return;
    const state = observeState();
    const diagnosticKey = `${state.hasUnread === null ? "unknown" : Number(state.hasUnread)}:${state.count ?? "dot"}`;
    if (lastDiagnosticKey !== diagnosticKey) {
      diagnostic("detected", "provider-observation");
      if (diagnostic("normalized", "provider-observation"))
        lastDiagnosticKey = diagnosticKey;
    }
    if (
      adapter.source === "whatsapp-dom" &&
      state.unreadScope === "notification-attention"
    ) {
      revokeRead();
      publishAttention(state);
      return;
    }
    if (!visible()) revokeRead();
    if (state.hasUnread === true) {
      // Swiph3l: Input before a new message cannot acknowledge it; a gesture is retained only when it already observed the unread being read.
      if (lastUnread !== true && !interactionSawUnread) interaction = null;
    }
    // Swiph3l: Read evidence stays conversation-specific. Service selection or
    // retained WebView focus alone is insufficient, including Discord view proof.
    const viewedConversation =
      adapter.source === "discord-dom" &&
      state.currentConversation !== null &&
      state.currentConversation !== undefined &&
      state.conversations?.some(
        (conversation) =>
          conversation.id === state.currentConversation &&
          conversation.hasUnread === false,
      ) === true;
    // Swiph3l: Discord's mapped read row and latest visible pane are a read
    // candidate without another message click. Other providers still require
    // their trusted input, and pending proofs recheck every mutation.
    const checkRead =
      visible() &&
      (viewedConversation ||
        interaction !== null ||
        pendingRead !== null ||
        toastRead !== null);
    const content = checkRead ? adapter.contentContext() : null;
    const context = checkRead ? adapter.readContext() : null;
    if (toastRead !== null) {
      if (
        !visible() ||
        toastRead.generation !== generation ||
        toastRead.incoming !== incomingSequence ||
        Date.now() > toastRead.expires ||
        (toastRead.context !== null &&
          (toastRead.context !== context || toastRead.content !== content))
      ) {
        toastRead = null;
      } else if (
        context !== null &&
        content !== null &&
        adapter.isViewingNotification(toastRead.notification)
      ) {
        toastRead.context = context;
        toastRead.content = content;
        if (
          state.currentConversation === context &&
          state.conversations?.some(
            (entry) => entry.id === context && entry.hasUnread === false,
          )
        ) {
          // Swiph3l: A native toast is only intent. The exact retained message
          // must actually appear unobscured at latest in its mapped DM before a
          // scoped local read proposal; native still checks prior DM ownership.
          publishConversationRead(
            state,
            context,
            content,
            "toast-view-read-proof",
          );
          toastRead = null;
          interaction = null;
          interactionSawUnread = false;
          return;
        }
      }
    }
    // Swiph3l: Returning to the same pane/content cannot revive a proof after an
    // observed navigation, replacement or scroll away from latest. Keep new input.
    if (
      pendingRead !== null &&
      (pendingRead.context !== context || pendingRead.content !== content)
    )
      pendingRead = null;
    const genuineRead =
      visible() &&
      interaction !== null &&
      context === interaction &&
      content !== null &&
      interactionContent === content;
    if (
      visible() &&
      viewedConversation &&
      !genuineRead &&
      context !== null &&
      content !== null &&
      state.currentConversation === context
    ) {
      // Swiph3l: This reads only the matching previously observed DM owner.
      // Native foreground/generation checks reject queued proof after arrivals;
      // an incomplete sidebar never becomes provider-wide zero here. A gesture
      // for older content cannot block this fresh provider/view evidence.
      publishConversationRead(
        state,
        context,
        content,
        "conversation-view-read-proof",
      );
      interaction = null;
      interactionSawUnread = false;
      lastUnread = state.hasUnread;
      return;
    }
    const readArrivals: number[] = [];
    // Swiph3l: Synology does not expose reliable notification tags. A proven provider
    // zero plus fresh conversation input can retire completed arrivals without
    // inventing a tag mapping; native generation checks still protect pending arrivals.
    const providerZero =
      genuineRead &&
      state.hasUnread === false &&
      adapter.providerUnreadZero?.() === true;
    const conversationRead =
      genuineRead &&
      adapter.source === "discord-dom" &&
      state.currentConversation === context &&
      state.conversations?.some(
        (conversation) =>
          conversation.id === context && conversation.hasUnread === false,
      ) === true;
    if (conversationRead && !providerZero) {
      // Swiph3l: A partial DM list is not global zero. Fresh input may read only
      // its exact observed conversation while native retains every other owner.
      publishConversationRead(
        state,
        context!,
        content!,
        "conversation-read-acknowledgement",
      );
      interaction = null;
      interactionSawUnread = false;
      lastUnread = state.hasUnread;
      return;
    }
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
    // Swiph3l: Exact and provider-zero proofs can beat native query completion.
    // Retain only this fresh gesture; completion must revalidate its whole scope.
    if (acknowledged && unseenArrivals.size > 0)
      pendingRead = {
        context: interaction!,
        content: interactionContent!,
        generation,
        incomingSequence,
        sequence: interactionSequence,
        sawUnread: interactionSawUnread,
      };
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
      } else publish(null, null, "provider-unknown");
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
      if (adapter.source === "whatsapp-dom") {
        // Swiph3l: A new event can follow a local Read all without changing the
        // official counter. Repost fresh scoped evidence, not the old suppression.
        providerRevision += 1;
        lastAttentionKey = undefined;
      }
      if (adapter.tracksNotificationArrivals !== false)
        retain(nextIncoming, null);
    }
    foreground = value;
    generation = nextGeneration;
    adapter.onHostForegroundChanged?.(value, generation, incomingSequence);
    schedule();
  };
  host.__chatplusMarkCurrentRead = () => {
    // Swiph3l: The native menu owns keyboard focus. Its explicit action still
    // requires the selected foreground service and a provider-mapped latest pane.
    if (
      disposed ||
      !foreground ||
      document.visibilityState !== "visible" ||
      readCapabilities(adapter.source).current !== "local"
    )
      return false;
    const state = observeState();
    const arrivals = currentReadArrivals(adapter, unseenArrivals);
    // Swiph3l: Discord's DM badge uses scoped DOM evidence, not unclassified
    // browser arrivals. An explicit current action may acknowledge a complete
    // DM zero only from a stable, latest mapped conversation.
    const context = adapter.readContext();
    const content = adapter.contentContext();
    const scopedZero =
      adapter.tracksNotificationArrivals === false &&
      state.hasUnread === false &&
      adapter.providerUnreadZero?.() === true &&
      context !== null &&
      content !== null &&
      adapter.readContext() === context &&
      adapter.contentContext() === content;
    const scopedConversation =
      adapter.source === "discord-dom" &&
      context !== null &&
      content !== null &&
      state.currentConversation === context &&
      state.conversations?.some(
        (conversation) =>
          conversation.id === context && conversation.hasUnread === false,
      ) === true &&
      adapter.readContext() === context &&
      adapter.contentContext() === content;
    if (arrivals.length === 0 && !scopedZero && !scopedConversation)
      return false;
    revokeRead();
    interactionSequence += 1;
    return publish(
      scopedConversation ? state.hasUnread : (state.hasUnread ?? false),
      state.count,
      "explicit-current-local",
      generation,
      arrivals,
      scopedConversation ? false : state.hasUnread === null,
      scopedZero
        ? "provider-zero"
        : scopedConversation
          ? "conversation-read"
          : undefined,
    );
  };
  host.__chatplusPrepareToastRead = (
    notification,
    expectedGeneration,
    expectedIncoming,
  ) => {
    if (
      disposed ||
      adapter.source !== "discord-dom" ||
      !visible() ||
      expectedGeneration !== generation ||
      expectedIncoming !== incomingSequence ||
      !/^[0-9]{17,20}$/.test(notification?.tag ?? "")
    )
      return false;
    toastRead = {
      notification: { tag: notification.tag },
      generation,
      incoming: incomingSequence,
      expires: Date.now() + 10_000,
      context: null,
      content: null,
    };
    schedule();
    return true;
  };
  host.__chatplusReadAllStep = (operation) => {
    if (
      disposed ||
      !foreground ||
      document.visibilityState !== "visible" ||
      readCapabilities(adapter.source).all !== "provider"
    )
      return "unavailable";
    const result = adapter.readAllStep?.(operation) ?? "unavailable";
    if (result !== "submitted") return result;
    // Swiph3l: Disabled may mean a pending request, not a successful read. The
    // public action must also leave fresh complete provider evidence of zero;
    // partial/unknown DOM and network errors cannot clear the captured baseline.
    return observeState().hasUnread === false &&
      (adapter.providerAllUnreadZero?.() ?? adapter.providerUnreadZero?.()) ===
        true
      ? "submitted"
      : "waiting";
  };
  host.__chatplusAcknowledgeAllLocal = (through) => {
    if (disposed || !Number.isSafeInteger(through) || through < 0) return;
    // Swiph3l: Keep the explicit action's boundary so late queries cannot restore
    // acknowledged tokens, while newer arrivals remain eligible to become unread.
    localAcknowledgedThrough = Math.max(localAcknowledgedThrough, through);
    revokeRead();
    for (const arrival of unseenArrivals.keys())
      if (arrival <= through) unseenArrivals.delete(arrival);
    if (incomingSequence <= through) arrivalOverflow = false;
    lastKey = undefined;
  };
  host.__chatplusIsViewingNotification = (notification) => {
    if (disposed) return false;
    const arrival = notification.arrival;
    if (Number.isSafeInteger(arrival) && arrival! > 0) {
      if (arrival! > incomingSequence) {
        // Swiph3l: A notification query can beat its queued native projection;
        // revoke prior input here too so an old gesture cannot read a new event.
        revokeRead();
        if (adapter.source === "whatsapp-dom") {
          providerRevision += 1;
          lastAttentionKey = undefined;
          schedule();
        }
      }
      incomingSequence = Math.max(incomingSequence, arrival!);
      if (adapter.tracksNotificationArrivals !== false)
        retain(arrival!, notification);
    }
    // Swiph3l: Renderer visibility may be stale by native callback time. This query only retains tags/returns evidence; it cannot mint a lasting read proof.
    // Swiph3l: Observation may capture QA metadata while backgrounded; it does
    // not supply view/read proof or bypass the native foreground requirement.
    adapter.onNotificationObserved?.(notification);
    return visible() && adapter.isViewingNotification(notification);
  };
  host.__chatplusAcceptRead = (arrivals, completeThrough) => {
    if (disposed || !Array.isArray(arrivals) || arrivals.length > 256) return;
    const accepted: number[] = [];
    for (const arrival of arrivals) {
      if (!Number.isSafeInteger(arrival) || arrival <= 0) continue;
      accepted.push(arrival);
      unseenArrivals.delete(arrival);
      acceptedArrivals.add(arrival);
      // Swiph3l: Bounded accepted history prevents late retries from restoring retired tags; eviction can only retain extra unread, never acknowledge an unseen event.
      if (acceptedArrivals.size > 256)
        acceptedArrivals.delete(acceptedArrivals.values().next().value!);
    }
    adapter.onReadAccepted?.(
      accepted,
      Number.isSafeInteger(completeThrough) && completeThrough! > 0
        ? completeThrough
        : undefined,
    );
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
    toastRead = null;
    if (
      event instanceof KeyboardEvent &&
      ["Alt", "Control", "Meta", "Shift", "Tab"].includes(event.key)
    )
      return;
    const context = adapter.interactionContext(event);
    const content = context === null ? null : adapter.contentContext();
    if (adapter.source === "discord-dom") {
      const reason =
        context === null
          ? "conversation-unmapped"
          : adapter.readContext() !== context || content === null
            ? "latest-unavailable"
            : "conversation-ready";
      if (readContextDiagnosticGeneration !== generation) {
        readContextDiagnosticGeneration = generation;
        readContextDiagnostics.clear();
      }
      if (
        !readContextDiagnostics.has(reason) &&
        post({
          chatplusUnreadDiagnostic: 1,
          source: adapter.source,
          event: "read-context-checked",
          reason,
          generation,
        })
      )
        readContextDiagnostics.add(reason);
    }
    if (context === null) return;
    interaction = context;
    interactionContent = content;
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
    // Swiph3l: A child document can lose focus while its native frame stays foreground.
    // Restoring it is presentation, never continuation of an earlier read gesture.
    const prepared = event.type === "focus" && visible() ? toastRead : null;
    if (event.type === "blur" || event.type === "focus" || !visible())
      revokeRead();
    // Provider onclick may refocus its document after native activation. Preserve
    // only that existing bounded intent; focus itself never creates read intent.
    if (prepared) toastRead = prepared;
    schedule();
  };
  document.defaultView?.addEventListener("blur", presentationChanged, true);
  document.defaultView?.addEventListener("focus", presentationChanged, true);
  document.addEventListener("visibilitychange", presentationChanged, true);
  adapter.onHostForegroundChanged?.(false, generation, incomingSequence);
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
    delete host.__chatplusMarkCurrentRead;
    delete host.__chatplusReadAllStep;
    delete host.__chatplusAcknowledgeAllLocal;
    delete host.__chatplusPrepareToastRead;
  };
}
