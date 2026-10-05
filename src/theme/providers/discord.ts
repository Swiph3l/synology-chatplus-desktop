import type {
  ProviderNotification,
  ProviderUnreadAdapter,
  ProviderUnreadSnapshot,
} from "./types";

const snowflake = "[0-9]{17,20}";
const messageId = new RegExp(`^chat-messages-(${snowflake})-(${snowflake})$`);
const guildItem = new RegExp(`^guildsnav___${snowflake}$`);

function semanticClass(element: Element, name: string): boolean {
  return [...element.classList].some((token) => token.startsWith(`${name}_`));
}

function semanticAncestor(element: Element, name: string): HTMLElement | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (semanticClass(node, name)) return node as HTMLElement;
  }
  return null;
}

function semanticDescendant(element: Element, name: string): Element | null {
  return (
    [...element.querySelectorAll("[class]")].find((node) =>
      semanticClass(node, name),
    ) ?? null
  );
}

function visible(element: HTMLElement, document: Document): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const view = document.defaultView;
  if (!view) return false;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const style = view.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  const rect = element.getBoundingClientRect();
  return (
    [
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
      rect.width,
      rect.height,
    ].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function badgePresent(element: Element): boolean {
  return [...element.querySelectorAll("[class]")].some(
    (node) =>
      semanticClass(node, "numberBadge") &&
      /^[1-9][0-9]*\+?$/.test(node.textContent?.trim() ?? ""),
  );
}

function guildPill(item: Element): Element | null {
  const wrapper = semanticAncestor(item, "listItem");
  return wrapper
    ? ([...wrapper.querySelectorAll("span[class]")].find(
        (node) =>
          semanticClass(node, "item") &&
          node.parentElement &&
          semanticClass(node.parentElement, "wrapper") &&
          node.parentElement.getAttribute("aria-hidden") === "true",
      ) ?? null)
    : null;
}

function completeGroup(group: Element): Element[] | null {
  const rows = [
    ...group.querySelectorAll(
      '[data-list-item-id^="guildsnav___"][aria-setsize][aria-posinset]',
    ),
  ].filter((item) => item.closest('[role="group"]') === group);
  const size = Number(rows[0]?.getAttribute("aria-setsize"));
  if (!Number.isInteger(size) || size < 1 || rows.length !== size) return null;
  const positions = new Set(
    rows.map((row) => Number(row.getAttribute("aria-posinset"))),
  );
  return rows.every(
    (row) => Number(row.getAttribute("aria-setsize")) === size,
  ) &&
    positions.size === size &&
    [...positions].every(
      (position) =>
        Number.isInteger(position) && position >= 1 && position <= size,
    )
    ? rows
    : null;
}

function completePrivateList(list: Element, document: Document): boolean {
  // Swiph3l: The ordinary private sidebar excludes message requests/spam. Their separate row appears whenever either store is nonempty, so an ordinary DM list cannot clear that hidden scope.
  if (list.querySelector('a[href="/message-requests"]')) return false;
  const rows = [
    ...list.querySelectorAll("[aria-setsize][aria-posinset]"),
  ].filter(
    (row) => row.closest('[data-list-id^="private-channels-"]') === list,
  );
  const size = Number(rows[0]?.getAttribute("aria-setsize"));
  const positions = new Set(
    rows.map((row) => Number(row.getAttribute("aria-posinset"))),
  );
  if (
    !visible(list as HTMLElement, document) ||
    !Number.isInteger(size) ||
    size < 1 ||
    rows.length !== size ||
    positions.size !== size ||
    rows.some((row) => Number(row.getAttribute("aria-setsize")) !== size) ||
    [...positions].some(
      (position) =>
        !Number.isInteger(position) || position < 1 || position > size,
    )
  )
    return false;
  // Swiph3l: Discord's global DM group and row pill both use mention counts. Muted ordinary DMs may have unread with no pill, and selection/hover hides their muted styling, so neither can prove a global zero.
  return rows.every((row) => {
    const dm = row.querySelector(`a[href^="/channels/@me/"]`);
    if (!dm) return !semanticClass(row, "dm");
    if (
      !semanticClass(row, "channel") ||
      !semanticClass(row, "dm") ||
      !new RegExp(`^/channels/@me/${snowflake}/?$`).test(
        dm.getAttribute("href") ?? "",
      )
    )
      return false;
    return (
      !row.matches(":hover") &&
      !semanticDescendant(row, "muted") &&
      !semanticDescendant(row, "mutedIcon") &&
      !semanticDescendant(row, "selected") &&
      !semanticDescendant(row, "interactiveSelected")
    );
  });
}

function guildState(item: Element, document: Document): boolean | null {
  const id = item.getAttribute("data-list-item-id") ?? "";
  const favorite = id === "guildsnav___favorites";
  // Swiph3l: Discord Home's numeric badge also counts Nitro offers and other activity; only guild/folder/favorites and the dedicated unread-DM group represent messages.
  if (!item.hasAttribute("aria-expanded") && !guildItem.test(id) && !favorite)
    return null;
  const wrapper = semanticAncestor(item, "listItem");
  const pill = guildPill(item);
  if (!wrapper || !pill) return null;
  if (badgePresent(wrapper)) return true;
  if (item.hasAttribute("aria-expanded")) {
    if (item.getAttribute("aria-expanded") === "true") {
      const group = document.getElementById(
        item.getAttribute("aria-owns") ?? "",
      );
      const children = group && completeGroup(group);
      if (!children) return null;
      const states = children.map((child) => guildState(child, document));
      return states.includes(true)
        ? true
        : states.every((state) => state === false)
          ? false
          : null;
    }
  }
  // Swiph3l: Discord's guild pill also lights up for hover/selection. Those states cannot prove unread or zero, including collapsed folders.
  if (semanticClass(pill, "selected") || semanticClass(pill, "hovered")) {
    if (item.hasAttribute("aria-expanded") || favorite) return null;
    // Swiph3l: The public guild renderer leaves aria-label equal to data-dnd-name only when aggregate unread/mentions and media suffixes are absent; this works in every Discord locale.
    const name = item.closest("[data-dnd-name]")?.getAttribute("data-dnd-name");
    const label = item.getAttribute("aria-label");
    if (!name || !label) return null;
    if (label === name) return false;
    // Swiph3l: A guild label changes for unread/mentions or media. Without the public media badge the different label is unread; media suffixes remain unknown instead of parsing translated text.
    return semanticDescendant(wrapper, "iconBadge") ||
      semanticDescendant(wrapper, "unavailableBadge")
      ? null
      : true;
  }
  return semanticClass(pill, "visible");
}

function conversationChannel(document: Document): string | null {
  const path = document.defaultView?.location.pathname ?? "";
  const route = new RegExp(
    `^/channels/(?:@me|${snowflake})/(${snowflake})(?:/(?:threads/(${snowflake})|${snowflake}))?/?$`,
  ).exec(path);
  return route?.[2] ?? route?.[1] ?? null;
}

interface ConversationViewport {
  channel: string;
  list: HTMLElement;
  scroller: HTMLElement;
  wrapper: HTMLElement;
  rows: HTMLElement[];
}

function conversationViewport(
  document: Document,
  latest: boolean,
): ConversationViewport | null {
  const channel = conversationChannel(document);
  if (!channel) return null;
  const candidates: ConversationViewport[] = [];
  for (const list of document.querySelectorAll<HTMLElement>(
    '[data-list-id="chat-messages"]',
  )) {
    const rows = [
      ...list.querySelectorAll<HTMLElement>('[id^="chat-messages-"]'),
    ].filter((row) => messageId.test(row.id));
    if (
      rows.length < 1 ||
      rows.some((row) => messageId.exec(row.id)?.[1] !== channel)
    )
      continue;
    const scroller = semanticAncestor(list, "scroller");
    const wrapper = semanticAncestor(list, "messagesWrapper");
    if (!scroller || !wrapper || !visible(scroller, document)) continue;
    const rect = scroller.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    if (!hit || !scroller.contains(hit)) continue;
    if (latest) {
      // Swiph3l: Reaching the bottom of a virtualized history page is not reaching the latest message; Discord exposes that distinction with its jump-to-present bar.
      if (
        semanticDescendant(wrapper, "jumpToPresentBar") ||
        semanticDescendant(wrapper, "messagesErrorBar")
      )
        continue;
      const { scrollTop, scrollHeight, offsetHeight } = scroller;
      // Swiph3l: Discord uses a two-pixel tolerance for its own bottom/read check, accommodating fractional scroll rounding without acknowledging a scrolled-up conversation.
      if (
        ![scrollTop, scrollHeight, offsetHeight].every(Number.isFinite) ||
        scrollTop < 0 ||
        offsetHeight <= 0 ||
        scrollHeight < offsetHeight ||
        scrollTop < scrollHeight - offsetHeight - 2
      )
        continue;
    }
    candidates.push({ channel, list, scroller, wrapper, rows });
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export function createDiscordAdapter(
  document: Document,
): ProviderUnreadAdapter {
  const view = document.defaultView;
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "hasFocus",
  );
  const browserHasFocus = document.hasFocus.bind(document);
  let hostForeground: boolean | undefined;
  let projected = false;
  const projectedHasFocus = () => hostForeground === true && browserHasFocus();
  if (view) {
    try {
      // Swiph3l: Windows can leave a minimized WebView logically focused. Discord's public blur handler checks document.hasFocus(), so blur alone would still suppress notifications upstream.
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: projectedHasFocus,
      });
      projected = true;
    } catch {
      // Swiph3l: A browser-owned non-configurable method must stay intact; unknown focus is safer than invoking Discord's private stores.
    }
  }
  const blur = () => view?.dispatchEvent(new Event("blur"));
  const preventBackgroundFocus = (event: Event) => {
    if (projected && hostForeground !== true) {
      // Swiph3l: Discord's public focus handler always marks focused. A logical WebView focus event while the host is backgrounded must not undo the native visibility projection.
      event.stopImmediatePropagation();
      blur();
    }
  };
  view?.addEventListener("focus", preventBackgroundFocus, true);

  const snapshot = (): ProviderUnreadSnapshot => {
    const rail = document.querySelector('[data-list-id="guildsnav"]');
    const dms = document.getElementById("guild-list-unread-dms");
    const privateLists = [
      ...document.querySelectorAll('[data-list-id^="private-channels-"]'),
    ];
    if (privateLists.some((list) => semanticDescendant(list, "unreadPill"))) {
      return { hasUnread: true, count: null };
    }
    if (dms && badgePresent(dms)) return { hasUnread: true, count: null };
    if (!rail) return { hasUnread: null, count: null };
    const items = [
      ...rail.querySelectorAll('[data-list-item-id^="guildsnav___"]'),
    ];
    const states = items.map((item) => guildState(item, document));
    if (states.includes(true)) return { hasUnread: true, count: null };
    if (!dms) return { hasUnread: null, count: null };
    const rootGroups = [...rail.querySelectorAll('[role="group"]')].filter(
      (group) =>
        !group.parentElement?.closest('[role="group"]') && completeGroup(group),
    );
    if (rootGroups.length !== 1) return { hasUnread: null, count: null };
    const roots = completeGroup(rootGroups[0])!;
    const guildRows = items.filter((item) =>
      guildItem.test(item.getAttribute("data-list-item-id") ?? ""),
    );
    const covered = guildRows.every(
      (item) =>
        item.closest('[role="group"]') === rootGroups[0] ||
        roots.some((root) => {
          const owned = document.getElementById(
            root.getAttribute("aria-owns") ?? "",
          );
          return owned?.contains(item);
        }),
    );
    // Swiph3l: Missing rows, animated/selected folders and unknown server labels are not a global zero. Mention numbers also overlap guild/DM aggregates, so they cannot be summed into a message count.
    const favorites = items.filter(
      (item) =>
        item.getAttribute("data-list-item-id") === "guildsnav___favorites",
    );
    const complete =
      covered &&
      roots.every((root) => guildState(root, document) === false) &&
      favorites.every((item) => guildState(item, document) === false) &&
      privateLists.length === 1 &&
      completePrivateList(privateLists[0], document);
    return { hasUnread: complete ? false : null, count: null };
  };

  return {
    source: "discord-dom",
    snapshot,
    providerUnreadZero: () => snapshot().hasUnread === false,
    onHostForegroundChanged(foreground) {
      if (hostForeground === foreground) return;
      hostForeground = foreground;
      if (!projected) return;
      if (!foreground) blur();
      else if (browserHasFocus()) view?.dispatchEvent(new Event("focus"));
    },
    readContext: () => conversationViewport(document, true)?.channel ?? null,
    contentContext() {
      const viewport = conversationViewport(document, false);
      if (!viewport) return null;
      // Swiph3l: A conversation gesture must stay attached to actual message content. Scroll position and older virtualized rows can change independently, so use the newest retained message snowflake.
      const newest = viewport.rows
        .map((row) => messageId.exec(row.id)![2])
        .reduce((latest, id) =>
          id.length > latest.length ||
          (id.length === latest.length && id > latest)
            ? id
            : latest,
        );
      return `${viewport.channel}:${newest}`;
    },
    interactionContext(event) {
      const viewport = conversationViewport(document, false);
      const target = event
        .composedPath()
        .find(
          (node): node is Element =>
            typeof (node as Element)?.closest === "function",
        );
      if (!viewport || !target) return null;
      if (viewport.scroller.contains(target)) return viewport.channel;
      const editor = target.closest(
        '[contenteditable="true"], textarea, [role="textbox"]',
      );
      const chat = semanticAncestor(viewport.wrapper, "chatContent");
      return editor &&
        semanticAncestor(editor, "channelTextArea") &&
        chat?.contains(editor)
        ? viewport.channel
        : null;
    },
    isViewingNotification(notification: ProviderNotification) {
      if (!new RegExp(`^${snowflake}$`).test(notification.tag)) return false;
      const viewport = conversationViewport(document, true);
      if (!viewport) return false;
      // Swiph3l: Discord's browser Notification tag is the message snowflake, not a channel ID. Match the actual visible message row; titles cannot distinguish same-named conversations.
      const row = viewport.rows.find(
        (node) => messageId.exec(node.id)?.[2] === notification.tag,
      );
      if (!row || !visible(row, document)) return false;
      const bounds = viewport.scroller.getBoundingClientRect();
      const message = row.getBoundingClientRect();
      return (
        message.bottom > bounds.top &&
        message.top < bounds.bottom &&
        message.right > bounds.left &&
        message.left < bounds.right
      );
    },
    observe(changed) {
      const Observer = view?.MutationObserver;
      const scoped = Observer ? new Observer(() => changed()) : null;
      let roots: Element[] = [];
      const bind = () => {
        const next = [
          ...document.querySelectorAll(
            '[data-list-id="guildsnav"], #guild-list-unread-dms, [data-list-id^="private-channels-"], [class*="messagesWrapper_"]',
          ),
        ];
        if (
          next.length === roots.length &&
          next.every((root, index) => root === roots[index])
        )
          return;
        roots = next;
        scoped?.disconnect();
        for (const root of roots)
          scoped?.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
              "class",
              "hidden",
              "aria-hidden",
              "aria-label",
              "aria-expanded",
              "aria-owns",
              "aria-setsize",
              "aria-posinset",
              "data-dnd-name",
              "data-list-item-id",
            ],
          });
        changed();
      };
      const discovery = Observer
        ? new Observer((records) => {
            if (
              records.some(
                (record) => !roots.some((root) => root.contains(record.target)),
              )
            )
              bind();
          })
        : null;
      // Swiph3l: WebView2 initialization can run before <body>; watching Document keeps Discord's later SPA mount and reconnect discoverable.
      discovery?.observe(document, { childList: true, subtree: true });
      bind();
      const scroll = (event: Event) => {
        const target = event.target as Element | null;
        if (
          target &&
          typeof target.querySelector === "function" &&
          target.querySelector('[data-list-id="chat-messages"]')
        )
          changed();
      };
      document.addEventListener("scroll", scroll, true);
      view?.addEventListener("resize", changed);
      view?.addEventListener("popstate", changed);
      return () => {
        scoped?.disconnect();
        discovery?.disconnect();
        document.removeEventListener("scroll", scroll, true);
        view?.removeEventListener("resize", changed);
        view?.removeEventListener("popstate", changed);
        view?.removeEventListener("focus", preventBackgroundFocus, true);
        if (
          projected &&
          Object.getOwnPropertyDescriptor(document, "hasFocus")?.value ===
            projectedHasFocus
        ) {
          if (originalDescriptor)
            Object.defineProperty(document, "hasFocus", originalDescriptor);
          else Reflect.deleteProperty(document, "hasFocus");
        }
      };
    },
  };
}
