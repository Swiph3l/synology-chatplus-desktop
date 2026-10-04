export function visibleElement(document: Document, element: Element): boolean {
  if (!element.isConnected || !document.defaultView) return false;
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const style = document.defaultView.getComputedStyle(current);
    if (
      current.hasAttribute("hidden") ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    )
      return false;
  }
  const bounds = element.getBoundingClientRect();
  return (
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

export function explicitlyHidden(
  document: Document,
  element: Element,
): boolean {
  return (
    element.hasAttribute("hidden") ||
    document.defaultView?.getComputedStyle(element).display === "none"
  );
}

export function eventInside(event: Event, element: Element): boolean {
  const target = event.target;
  return (
    target !== null &&
    typeof (target as Node).nodeType === "number" &&
    element.contains(target as Node)
  );
}

// Swiph3l: Providers can reuse a message pane for another conversation. Local DOM/route revisions revoke an old read gesture without inspecting message text or exporting conversation identifiers.
export function createViewContext(
  document: Document,
  selector: string,
  prefix: string,
) {
  const identities = new WeakMap<Element, number>();
  const revisions = new WeakMap<Element, number>();
  let nextIdentity = 0;
  let route = document.defaultView?.location?.href;
  let routeRevision = 0;
  let observer: MutationObserver | undefined;
  const revise = (records: MutationRecord[]) => {
    const changed = new Set<Element>();
    const views = [...document.querySelectorAll(selector)];
    for (const record of records) {
      // Swiph3l: Focus/scroll classes and styles can change during a genuine read gesture. Revoke on content/identity changes, while live visibility/latest checks handle presentation changes.
      if (
        record.type === "attributes" &&
        !["id", "src", "href"].includes(record.attributeName ?? "") &&
        !record.attributeName?.startsWith("data-")
      )
        continue;
      for (const view of views) {
        // Swiph3l: A SPA may detach and reinsert the same pane without changing its URL or content; mutations on its parent must revoke the old gesture too.
        const crossesBoundary =
          record.type === "childList" &&
          [...record.addedNodes, ...record.removedNodes].some((node) =>
            node.contains(view),
          );
        if (view.contains(record.target) || crossesBoundary) changed.add(view);
      }
    }
    for (const view of changed)
      revisions.set(view, (revisions.get(view) ?? 0) + 1);
  };
  return {
    key(view: Element): string {
      // Swiph3l: A provider mutation may precede its observer callback; drain it before comparing the acknowledgement context to close that race.
      if (observer) revise(observer.takeRecords());
      const nextRoute = document.defaultView?.location?.href;
      if (nextRoute !== route) {
        route = nextRoute;
        routeRevision += 1;
      }
      let identity = identities.get(view);
      if (identity === undefined) {
        identity = ++nextIdentity;
        identities.set(view, identity);
      }
      return `${prefix}:${identity}:${revisions.get(view) ?? 0}:${routeRevision}`;
    },
    observe(changed: () => void): () => void {
      const Observer = document.defaultView?.MutationObserver;
      if (Observer) {
        observer = new Observer((records) => {
          revise(records);
          changed();
        });
        // Swiph3l: WebView initialization runs before documentElement may exist; observing the Document also catches the provider's first mounted sidebar.
        observer.observe(document, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
      }
      document.addEventListener("scroll", changed, true);
      document.defaultView?.addEventListener("resize", changed);
      document.defaultView?.addEventListener("hashchange", changed);
      document.defaultView?.addEventListener("popstate", changed);
      return () => {
        observer?.disconnect();
        observer = undefined;
        document.removeEventListener("scroll", changed, true);
        document.defaultView?.removeEventListener("resize", changed);
        document.defaultView?.removeEventListener("hashchange", changed);
        document.defaultView?.removeEventListener("popstate", changed);
      };
    },
  };
}
