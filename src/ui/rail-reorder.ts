const HOLD_MS = 2000;
const RAIL_WIDTH = 56;

// The native provider views begin at x=56; keep the entire gesture in the rail.
export function bindRailReorder(
  list: HTMLElement,
  options: {
    commit: (ids: string[]) => void;
    end: () => void;
    busy: () => boolean;
  },
) {
  const buttons = [...list.querySelectorAll<HTMLButtonElement>("button")];
  const marker = document.createElement("span");
  marker.className = "rail-drop-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.hidden = true;
  list.append(marker);
  let gesture:
    | {
        button: HTMLButtonElement;
        pointerId: number;
        pointerType: string;
        x: number;
        y: number;
        startX: number;
        startY: number;
        moved: boolean;
        top: number;
        height: number;
        grabY: number;
        scrollTop: number;
        maxScroll: number;
        armed: boolean;
        index: number;
      }
    | undefined;
  let hold: number | undefined;
  let scroll: number | undefined;
  let suppressed: string | undefined;
  const ids = () => buttons.map((button) => button.dataset.railKey!);
  const inside = (x: number, y: number) => {
    const rect = list.getBoundingClientRect();
    return x >= 0 && x < RAIL_WIDTH && y >= rect.top && y <= rect.bottom;
  };
  const clearMarker = () => {
    marker.hidden = true;
    for (const button of buttons) {
      delete button.dataset.dropBefore;
      delete button.dataset.dropAfter;
    }
  };
  const position = () => {
    if (!gesture?.armed) return;
    const listRect = list.getBoundingClientRect();
    const top = Math.min(
      Math.max(listRect.top, listRect.bottom - gesture.height),
      Math.max(listRect.top, gesture.y - gesture.grabY),
    );
    const naturalTop = gesture.top - (list.scrollTop - gesture.scrollTop);
    gesture.button.style.setProperty(
      "--rail-drag-offset",
      `${top - naturalTop}px`,
    );
    const remaining = buttons.filter((button) => button !== gesture!.button);
    gesture.index = remaining.findIndex((button) => {
      const rect = button.getBoundingClientRect();
      return gesture!.y < (rect.top + rect.bottom) / 2;
    });
    if (gesture.index < 0) gesture.index = remaining.length;
    clearMarker();
    if (remaining[gesture.index])
      remaining[gesture.index].dataset.dropBefore = "true";
    else if (remaining.length)
      remaining[remaining.length - 1].dataset.dropAfter = "true";
    const target = remaining[gesture.index] ?? remaining.at(-1);
    if (target) {
      const rect = target.getBoundingClientRect();
      const top = remaining[gesture.index] ? rect.top - 3 : rect.bottom + 1;
      marker.style.top = `${top - list.getBoundingClientRect().top + list.scrollTop}px`;
      marker.hidden = false;
    }
  };
  const autoscroll = () => {
    scroll = undefined;
    if (!gesture?.armed) return;
    const rect = list.getBoundingClientRect();
    const edge = Math.min(28, (rect.bottom - rect.top) / 3);
    const direction =
      gesture.y < rect.top + edge ? -1 : gesture.y > rect.bottom - edge ? 1 : 0;
    // Transformed drag previews and the insertion marker can increase visual
    // overflow. The saved natural limit keeps edge scrolling bounded.
    list.scrollTop = Math.min(
      gesture.maxScroll,
      Math.max(0, list.scrollTop + direction * 6),
    );
    position();
    scroll = window.setTimeout(autoscroll, 16);
  };
  const finish = (commit: boolean, suppress = false) => {
    if (!gesture) return;
    const ended = gesture;
    gesture = undefined;
    window.clearTimeout(hold);
    window.clearTimeout(scroll);
    hold = scroll = undefined;
    clearMarker();
    list.classList.remove("rail-reordering");
    ended.button.classList.remove("rail-dragging");
    ended.button.style.removeProperty("--rail-drag-offset");
    if (ended.armed || ended.moved || suppress)
      suppressed = ended.button.dataset.railKey;
    if (ended.button.hasPointerCapture?.(ended.pointerId))
      ended.button.releasePointerCapture(ended.pointerId);
    if (commit && ended.armed) {
      const order = ids().filter((id) => id !== ended.button.dataset.railKey);
      order.splice(ended.index, 0, ended.button.dataset.railKey!);
      if (order.some((id, index) => id !== ids()[index])) options.commit(order);
    }
    options.end();
  };
  const move = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    gesture.moved ||=
      Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) > 6;
    if (
      !inside(gesture.x, gesture.y) ||
      (gesture.pointerType === "mouse" && (event.buttons & 1) === 0) ||
      (!gesture.armed && gesture.pointerType !== "mouse" && gesture.moved)
    ) {
      finish(false, true);
      return;
    }
    if (gesture.armed) {
      event.preventDefault();
      position();
    }
  };
  const up = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    gesture.moved ||=
      Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) > 6;
    if (gesture.armed) {
      event.preventDefault();
      position();
    }
    finish(event.button === 0 && inside(event.clientX, event.clientY));
  };
  const cancel = () => finish(false, true);
  const pointerCancel = (event: PointerEvent) => {
    if (gesture?.pointerId === event.pointerId) cancel();
  };
  const escape = (event: KeyboardEvent) => {
    if (gesture && event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };
  for (const button of buttons) {
    button.addEventListener("pointerdown", (event) => {
      if (
        event.button !== 0 ||
        (event.pointerType === "mouse" && (event.buttons & 1) === 0) ||
        event.isPrimary === false ||
        options.busy() ||
        buttons.length < 2 ||
        !inside(event.clientX, event.clientY)
      )
        return;
      finish(false);
      suppressed = undefined;
      const rect = button.getBoundingClientRect();
      gesture = {
        button,
        pointerId: event.pointerId,
        pointerType: event.pointerType || "mouse",
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        top: rect.top,
        height: rect.bottom - rect.top,
        grabY: event.clientY - rect.top,
        scrollTop: list.scrollTop,
        maxScroll: Math.max(0, list.scrollHeight - list.clientHeight),
        armed: false,
        index: buttons.indexOf(button),
      };
      try {
        button.setPointerCapture?.(event.pointerId);
      } catch {
        finish(false, true);
        return;
      }
      hold = window.setTimeout(() => {
        if (!gesture) return;
        gesture.armed = true;
        list.classList.add("rail-reordering");
        button.classList.add("rail-dragging");
        position();
        autoscroll();
      }, HOLD_MS);
    });
    button.addEventListener("contextmenu", cancel);
    button.addEventListener("lostpointercapture", (event) => {
      if (gesture?.button === button) pointerCancel(event);
    });
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", pointerCancel);
  window.addEventListener("blur", cancel);
  document.addEventListener("keydown", escape);
  return {
    interacting: () => !!gesture,
    consumeClick: (id: string, event: MouseEvent) => {
      // Keyboard Enter/Space activation has detail=0 and can follow a cancelled drag.
      if (event.detail === 0) return false;
      if (suppressed !== id) return false;
      suppressed = undefined;
      return true;
    },
    cancel,
    dispose: () => {
      finish(false);
      marker.remove();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("keydown", escape);
    },
  };
}
