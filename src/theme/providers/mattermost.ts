import { createViewContext, eventInside, visibleElement } from "./dom";
import { verifyMattermostReadZero } from "./mattermost-read-state";
import type { ProviderUnreadAdapter } from "./types";
import type { ProviderHostWindow } from "../provider-unread";

interface Options {
  verifyReadZero?: typeof verifyMattermostReadZero;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
}

// Swiph3l: Older Mattermost releases put message text in Notification.tag. Use
// documented same-origin read counters instead of guessing a post from that text.
// No token, cookie, private store, message body or contact list is read/exported.
export function createMattermostAdapter(
  document: Document,
  options: Options = {},
): ProviderUnreadAdapter {
  const view = document.defaultView;
  const configured = (
    view as (Window & { __chatplusServiceBase?: string }) | null
  )?.__chatplusServiceBase;
  const base = (() => {
    try {
      if (!configured || !view) return null;
      const url = new URL(configured);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.origin !== view.location.origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return null;
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
      return url;
    } catch {
      return null;
    }
  })();
  const verify = options.verifyReadZero ?? verifyMattermostReadZero;
  const fetcher = view?.fetch?.bind(view);
  let disposed = false;
  let foreground = false;
  let generation = 0;
  let incoming = 0;
  let readThrough = 0;
  let epoch = 0;
  const contexts = createViewContext(
    document,
    "#postListContent",
    "mattermost-view",
  );
  let zero: { key: string; epoch: number; checkedAt: number } | null = null;
  let pending: {
    key: string;
    epoch: number;
    controller: AbortController;
  } | null = null;
  let nextAllowedAt = 0;
  let changed = () => {};
  const diagnostic = (verified: boolean) => {
    try {
      (
        view as (Window & ProviderHostWindow) | null
      )?.chrome?.webview?.postMessage(
        JSON.stringify({
          chatplusUnreadDiagnostic: 1,
          source: "mattermost-dom",
          event: "read-state-checked",
          reason: verified ? "verified-zero" : "unverified-zero",
          generation,
        }),
      );
    } catch {
      // The exact origin/session bridge may already be gone; no raw error is logged.
    }
  };

  const scope = () => {
    if (!base || !view) return null;
    const route = view.location.pathname;
    if (
      !route.startsWith(base.pathname) ||
      !/^[^/]+\/(?:channels|messages)\/[^/]+\/?$/.test(
        route.slice(base.pathname.length),
      )
    )
      return null;
    const roots = [
      ...document.querySelectorAll<HTMLElement>("#postListContent"),
    ];
    const scrollers = [
      ...document.querySelectorAll<HTMLElement>("#postListScrollContainer"),
    ];
    if (roots.length !== 1 || scrollers.length !== 1) return null;
    const root = roots[0];
    const scroller = scrollers[0];
    if (
      !root.contains(scroller) ||
      !visibleElement(document, root) ||
      !visibleElement(document, scroller)
    )
      return null;
    const bounds = scroller.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    if (!hit || !scroller.contains(hit)) return null;
    const posts = [...root.querySelectorAll('[data-testid="postView"][id]')];
    if (
      posts.length === 0 ||
      posts.some((post) => !/^post_[a-z0-9]{26}$/.test(post.id))
    )
      return null;
    return {
      // Drain queued mutations before accepting a server receipt. Even an edit
      // or detach/reinsert of the same post/root revokes the previous gesture.
      key: `${contexts.key(root)}:${posts.at(-1)!.id}`,
      scroller,
    };
  };
  const active = () =>
    !disposed &&
    foreground &&
    document.visibilityState === "visible" &&
    document.hasFocus();
  const currentZero = () =>
    zero !== null &&
    zero.epoch === epoch &&
    Date.now() - zero.checkedAt <= 1_500 &&
    active() &&
    scope()?.key === zero.key;
  const invalidate = () => {
    zero = null;
    pending?.controller.abort();
    pending = null;
    nextAllowedAt = 0;
  };
  const request = (key: string) => {
    if (!base || !fetcher || !view || !active() || incoming <= readThrough)
      return;
    if (pending?.key === key && pending.epoch === epoch) return;
    if (currentZero() || Date.now() < nextAllowedAt) return;
    invalidate();
    nextAllowedAt = Date.now() + 5_000;
    const candidate = { key, epoch, controller: new AbortController() };
    pending = candidate;
    const valid = () =>
      pending === candidate &&
      !candidate.controller.signal.aborted &&
      candidate.epoch === epoch &&
      active() &&
      scope()?.key === candidate.key;
    const deadline = view.setTimeout(
      () => candidate.controller.abort(),
      options.requestTimeoutMs ?? 8_000,
    );
    void (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await verify({
            base: new URL(base),
            fetch: fetcher,
            signal: candidate.controller.signal,
          });
          if (!valid()) return;
          diagnostic(result === true);
          if (result === true) {
            zero = { key, epoch: candidate.epoch, checkedAt: Date.now() };
            changed();
            return;
          }
          if (attempt === 0) {
            // A provider read updater may settle after the input handler. Retry
            // the same bounded server query; elapsed time itself is never proof.
            await new Promise<void>((resolve) => {
              const done = () => {
                view.clearTimeout(timer);
                candidate.controller.signal.removeEventListener("abort", done);
                resolve();
              };
              const timer = view.setTimeout(done, options.retryDelayMs ?? 700);
              candidate.controller.signal.addEventListener("abort", done, {
                once: true,
              });
            });
            if (!valid()) return;
          }
        }
      } catch {
        // Missing auth, incompatible versions and unavailable metadata stay unknown.
      } finally {
        view.clearTimeout(deadline);
        if (pending === candidate) pending = null;
      }
    })();
  };

  return {
    source: "mattermost-dom",
    snapshot: () => ({
      // Metadata is used only as an authoritative zero oracle. It does not
      // manufacture initial unread counts or browser notification content.
      hasUnread: currentZero() ? false : null,
      count: null,
    }),
    providerUnreadZero: currentZero,
    readContext: () => scope()?.key ?? null,
    contentContext: () => scope()?.key ?? null,
    interactionContext(event) {
      const current = scope();
      if (!current) return null;
      const editors = [
        ...document.querySelectorAll<HTMLElement>(
          "#create_post #post_textbox:not([disabled])",
        ),
      ].filter((editor) => visibleElement(document, editor));
      if (
        !eventInside(event, current.scroller) &&
        !(editors.length === 1 && eventInside(event, editors[0]))
      )
        return null;
      if (event.isTrusted) {
        // Swiph3l: Reuse only the same short-lived scoped receipt while native
        // work completes. Repeated input cannot bypass the query cooldown.
        request(current.key);
      }
      return current.key;
    },
    // Legacy text tags cannot identify a current message for foreground suppression.
    isViewingNotification: () => false,
    onReadAccepted(_arrivals, completeThrough) {
      // Swiph3l: A later accepted token can precede an earlier pending one.
      // Only native's complete boundary may stop queries/consume this receipt.
      if (completeThrough === undefined) return;
      readThrough = Math.max(readThrough, completeThrough);
      zero = null;
    },
    onHostForegroundChanged(value, nextGeneration = 0, nextIncoming = 0) {
      if (
        foreground !== value ||
        generation !== nextGeneration ||
        incoming !== nextIncoming
      ) {
        epoch += 1;
        invalidate();
      }
      foreground = value;
      generation = nextGeneration;
      incoming = nextIncoming;
    },
    observe(callback) {
      changed = callback;
      const update = () => {
        const key = scope()?.key;
        if (
          (pending !== null && pending.key !== key) ||
          (zero !== null && zero.key !== key) ||
          !active()
        )
          invalidate();
        callback();
      };
      const stop = contexts.observe(update);
      document.addEventListener("visibilitychange", update, true);
      view?.addEventListener("blur", update, true);
      return () => {
        disposed = true;
        invalidate();
        stop();
        document.removeEventListener("visibilitychange", update, true);
        view?.removeEventListener("blur", update, true);
      };
    },
  };
}
