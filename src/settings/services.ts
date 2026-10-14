import {
  providers,
  serviceSupportsNotifications,
  type ProviderId,
  type ServiceConfig,
} from "../app/providers";
import { normalizeServer } from "../app/navigation";
import {
  applyNotificationColor,
  normalizeNotificationColor,
  notificationColors,
  randomNotificationColor,
  resolveNotificationColor,
} from "../app/notification-colors";
import { t, type TranslationKey } from "../i18n";
import { providerIcon } from "../ui/rail-icons";
import { confirmServiceRemoval } from "../ui/service-removal";

type ServiceDialogMode =
  | { type: "create" }
  | { type: "edit"; serviceId: string }
  | { type: "remove"; serviceId: string }
  | null;

export interface ServiceDraftChange {
  notificationServiceId?: string;
}

function actionIcon(kind: "drag" | "up" | "down" | "edit" | "remove") {
  const icon = document.createElement("span");
  icon.className = "service-action-icon";
  icon.setAttribute("aria-hidden", "true");
  const paths = {
    drag: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
    remove: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg>`;
  return icon;
}

function normalizedServiceUrl(service: ServiceConfig): string {
  const definition = providers[service.provider];
  let value: string;
  try {
    value = normalizeServer(
      service.url ||
        (definition.urlMode === "fixed" ? definition.defaultUrl : ""),
    );
  } catch {
    throw new Error(t("services.urlInvalid"));
  }
  if (service.provider === "slack") {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      (url.port && url.port !== "443") ||
      !(url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"))
    )
      throw new Error(t("services.urlSlack"));
  }
  if (service.provider === "discord") {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "discord.com" ||
      (url.port && url.port !== "443")
    )
      throw new Error(t("services.urlInvalid"));
  }
  return value;
}

export function serviceEditor(
  container: HTMLElement,
  services: ServiceConfig[],
  onChange: (change?: ServiceDraftChange) => void,
  supportsNotifications: (
    service: Pick<ServiceConfig, "id" | "provider" | "url">,
  ) => boolean = serviceSupportsNotifications,
  dialogHelp: { saveHelp?: string; removalHelp?: string } = {},
) {
  let disabled = false;
  let disposed = false;
  let mode: ServiceDialogMode = null;
  let activeDialog: HTMLDialogElement | null = null;
  let closeEditor: (() => void) | null = null;
  let updateDialogNotifications: (() => void) | null = null;
  let removalController: AbortController | null = null;
  const cards = new Map<string, HTMLElement>();
  const wrapper = document.createElement("div");
  wrapper.className = "services-list-wrap";
  const list = document.createElement("ol");
  list.className = "services-list";
  list.setAttribute("aria-label", t("services.order"));
  const marker = document.createElement("div");
  marker.className = "services-drop-marker";
  marker.hidden = true;
  marker.setAttribute("aria-hidden", "true");
  const live = document.createElement("p");
  live.className = "services-screen-reader";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  wrapper.append(list, marker);
  container.replaceChildren(wrapper, live);

  type DragState = {
    id: string;
    pointerId: number;
    handle: HTMLButtonElement;
    card: HTMLElement;
    startY: number;
    startScroll: number;
    maxScroll: number;
    clientX: number;
    clientY: number;
    target: number;
    started: boolean;
    overList: boolean;
    frame: number;
    scroller: HTMLElement;
  };
  let drag: DragState | null = null;

  const focusCard = (id: string, action = "edit") => {
    cards
      .get(id)
      ?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
      ?.focus({ preventScroll: true });
  };

  const render = (animate = false) => {
    if (disposed) return;
    const before = new Map<string, number>();
    if (animate)
      for (const [id, card] of cards)
        before.set(id, card.getBoundingClientRect().top);
    cards.clear();
    list.replaceChildren();
    if (!services.length) {
      const empty = document.createElement("li");
      empty.className = "services-empty";
      const heading = document.createElement("p");
      heading.textContent = t("services.empty");
      const help = document.createElement("small");
      help.textContent = t("services.emptyHelp");
      empty.append(heading, help);
      list.append(empty);
      return;
    }
    services.forEach((service, index) => {
      const definition = providers[service.provider];
      const name = service.name || definition.name;
      const card = document.createElement("li");
      card.className = "service-card";
      card.id = `service-${service.id}-settings`;
      card.dataset.serviceId = service.id;
      card.classList.toggle("service-card-disabled", !service.enabled);
      cards.set(service.id, card);
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "secondary service-drag-handle service-icon-button";
      handle.dataset.action = "drag";
      handle.title = t("services.dragHandle", { name });
      handle.setAttribute("aria-label", handle.title);
      handle.disabled = disabled || services.length < 2;
      handle.append(actionIcon("drag"));
      handle.addEventListener("pointerdown", (event) =>
        beginDrag(event, service.id, handle, card),
      );
      handle.addEventListener("keydown", (event) => {
        if (
          !event.altKey ||
          (event.key !== "ArrowUp" && event.key !== "ArrowDown")
        )
          return;
        event.preventDefault();
        move(service.id, event.key === "ArrowUp" ? -1 : 1, "drag");
      });
      const position = document.createElement("span");
      position.className = "service-position";
      position.textContent = String(index + 1);
      position.setAttribute("aria-hidden", "true");
      const icon = providerIcon(service.provider);
      icon.classList.add("service-card-icon");
      const body = document.createElement("div");
      body.className = "service-card-body";
      const title = document.createElement("h3");
      title.className = "service-card-name";
      title.textContent = name;
      title.title = name;
      const metadata = document.createElement("div");
      metadata.className = "service-card-meta";
      const providerName = document.createElement("span");
      providerName.className = "service-provider-name";
      providerName.textContent = definition.name;
      metadata.append(providerName);
      if (definition.experimental) {
        const experimental = document.createElement("span");
        experimental.className = "experimental-badge";
        experimental.textContent = t("services.experimental");
        metadata.append(experimental);
      }
      const enabled = document.createElement("span");
      enabled.className = "service-enabled-status";
      enabled.classList.toggle("is-enabled", service.enabled);
      enabled.textContent = t(
        service.enabled ? "services.enabled" : "services.disabled",
      );
      metadata.append(enabled);
      const details = document.createElement("div");
      details.className = "service-card-details";
      const notifications = document.createElement("span");
      notifications.className = "service-notification-status";
      applyNotificationColor(notifications, service);
      const dot = document.createElement("span");
      dot.className = "service-notification-dot";
      dot.setAttribute("aria-hidden", "true");
      const notificationLabel = document.createElement("span");
      notificationLabel.textContent = t(
        service.notifications && supportsNotifications(service)
          ? "services.notificationsOn"
          : "services.notificationsOff",
      );
      notifications.append(dot, notificationLabel);
      details.append(notifications);
      if (definition.urlMode !== "fixed" && service.url) {
        const address = document.createElement("span");
        address.className = "service-server-address";
        address.title = service.url;
        try {
          const url = new URL(service.url);
          address.textContent =
            url.host +
            (url.pathname === "/" ? "" : url.pathname.replace(/\/$/, ""));
        } catch {
          address.textContent = service.url;
        }
        details.append(address);
      }
      body.append(title, metadata, details);
      const actions = document.createElement("div");
      actions.className = "service-card-actions";
      const reorder = document.createElement("div");
      reorder.className = "service-move-actions";
      for (const direction of [-1, 1] as const) {
        const up = direction === -1;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary service-icon-button service-move-button";
        button.dataset.action = up ? "up" : "down";
        button.title = t(up ? "services.moveUp" : "services.moveDown", {
          name,
        });
        button.setAttribute("aria-label", button.title);
        button.disabled =
          disabled || (up ? index === 0 : index === services.length - 1);
        button.append(actionIcon(up ? "up" : "down"));
        button.addEventListener("click", () =>
          move(service.id, direction, button.dataset.action),
        );
        reorder.append(button);
      }
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "secondary service-edit-button";
      editButton.dataset.action = "edit";
      editButton.id = `service-${service.id}-edit`;
      editButton.disabled = disabled;
      editButton.setAttribute("aria-label", t("services.editLabel", { name }));
      editButton.append(actionIcon("edit"), t("services.edit"));
      editButton.addEventListener("click", () => edit(service.id));
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className =
        "secondary danger service-icon-button service-remove-button";
      removeButton.dataset.action = "remove";
      removeButton.id = `service-${service.id}-remove`;
      removeButton.disabled = disabled;
      removeButton.title = t("services.removeLabel", { name });
      removeButton.setAttribute("aria-label", removeButton.title);
      removeButton.append(actionIcon("remove"));
      removeButton.addEventListener("click", () => {
        void remove(service.id);
      });
      actions.append(reorder, editButton, removeButton);
      card.append(handle, position, icon, body, actions);
      list.append(card);
    });
    if (
      animate &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      for (const [id, card] of cards) {
        const previous = before.get(id);
        if (previous === undefined) continue;
        const delta = previous - card.getBoundingClientRect().top;
        if (delta)
          card.animate(
            [
              { transform: `translateY(${delta}px)` },
              { transform: "translateY(0)" },
            ],
            { duration: 180, easing: "ease-out" },
          );
      }
  };

  const reorderTo = (id: string, target: number, action = "drag") => {
    if (disabled || disposed || mode) return;
    const index = services.findIndex((service) => service.id === id);
    if (
      index < 0 ||
      target < 0 ||
      target >= services.length ||
      index === target
    )
      return;
    // The ordered draft array is the only ordering source; profile identity never uses an index.
    const [service] = services.splice(index, 1);
    services.splice(target, 0, service);
    render(true);
    onChange();
    live.textContent = t("services.moved", {
      name: service.name,
      position: target + 1,
    });
    const button = cards
      .get(id)
      ?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (button && !button.disabled) button.focus({ preventScroll: true });
    else focusCard(id, "drag");
    cards.get(id)?.scrollIntoView({ block: "nearest" });
  };
  const move = (id: string, direction: number, action = "drag") => {
    reorderTo(
      id,
      services.findIndex((service) => service.id === id) + direction,
      action,
    );
  };
  const updateDrag = () => {
    if (!drag?.started) return;
    const state = drag;
    const rect = list.getBoundingClientRect();
    const viewport = state.scroller.getBoundingClientRect();
    state.overList =
      state.clientX >= rect.left - 12 &&
      state.clientX <= rect.right + 12 &&
      state.clientY >= viewport.top &&
      state.clientY <= viewport.bottom;
    marker.hidden = !state.overList;
    const others = [...cards.values()].filter((card) => card !== state.card);
    state.target = others.findIndex((card) => {
      const bounds = card.getBoundingClientRect();
      return state.clientY < bounds.top + bounds.height / 2;
    });
    if (state.target < 0) state.target = others.length;
    const next = others[state.target];
    const last = others[others.length - 1];
    const top = next
      ? next.getBoundingClientRect().top - 4
      : last
        ? last.getBoundingClientRect().bottom + 4
        : rect.top;
    marker.style.top = `${top - wrapper.getBoundingClientRect().top}px`;
    state.card.style.transform = `translateY(${state.clientY - state.startY + state.scroller.scrollTop - state.startScroll}px)`;
  };
  const scrollDrag = () => {
    if (!drag?.started) return;
    const state = drag;
    const bounds = state.scroller.getBoundingClientRect();
    const edge = 36;
    if (state.overList) {
      const offset =
        state.clientY < bounds.top + edge
          ? -Math.min(12, (bounds.top + edge - state.clientY) / 3)
          : state.clientY > bounds.bottom - edge
            ? Math.min(12, (state.clientY - bounds.bottom + edge) / 3)
            : 0;
      if (offset)
        state.scroller.scrollTop = Math.min(
          state.maxScroll,
          Math.max(0, state.scroller.scrollTop + offset),
        );
    }
    updateDrag();
    state.frame = requestAnimationFrame(scrollDrag);
  };
  const onDragMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.started && Math.abs(event.clientY - drag.startY) >= 5) {
      drag.started = true;
      drag.card.classList.add("is-dragging");
      container.classList.add("is-reordering");
      updateDrag();
      drag.frame = requestAnimationFrame(scrollDrag);
    }
    if (drag.started) {
      event.preventDefault();
      updateDrag();
    }
  };
  const finishDrag = (accept: boolean) => {
    if (!drag) return;
    const state = drag;
    drag = null;
    cancelAnimationFrame(state.frame);
    state.card.classList.remove("is-dragging");
    state.card.style.transform = "";
    container.classList.remove("is-reordering");
    marker.hidden = true;
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", onDragUp);
    document.removeEventListener("pointercancel", onDragCancel);
    document.removeEventListener("keydown", onDragKey);
    state.handle.removeEventListener("lostpointercapture", onDragCancel);
    if (state.handle.hasPointerCapture(state.pointerId))
      state.handle.releasePointerCapture(state.pointerId);
    if (accept && state.started && state.overList)
      reorderTo(state.id, state.target);
  };
  const onDragUp = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) finishDrag(true);
  };
  const onDragCancel = () => finishDrag(false);
  const onDragKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finishDrag(false);
    }
  };
  function beginDrag(
    event: PointerEvent,
    id: string,
    handle: HTMLButtonElement,
    card: HTMLElement,
  ) {
    if (
      event.button !== 0 ||
      disabled ||
      disposed ||
      mode ||
      services.length < 2
    )
      return;
    finishDrag(false);
    const scroller =
      container.closest<HTMLElement>(".settings-content") ?? container;
    drag = {
      id,
      pointerId: event.pointerId,
      handle,
      card,
      startY: event.clientY,
      startScroll: scroller.scrollTop,
      // Translated cards can expand scrollHeight during a drag. Keep scrolling
      // within the content bounds captured before applying that transform.
      maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      clientX: event.clientX,
      clientY: event.clientY,
      target: services.findIndex((service) => service.id === id),
      started: false,
      overList: true,
      frame: 0,
      scroller,
    };
    handle.setPointerCapture(event.pointerId);
    document.addEventListener("pointermove", onDragMove, { passive: false });
    document.addEventListener("pointerup", onDragUp);
    document.addEventListener("pointercancel", onDragCancel);
    document.addEventListener("keydown", onDragKey);
    handle.addEventListener("lostpointercapture", onDragCancel);
  }

  const open = (
    dialogMode: Exclude<ServiceDialogMode, { type: "remove" } | null>,
    draft: ServiceConfig,
    focusField?: "name" | "notifications",
  ) => {
    if (disabled || disposed || mode || document.querySelector("dialog[open]"))
      return;
    finishDrag(false);
    mode = dialogMode;
    const opening = structuredClone(draft);
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog");
    activeDialog = dialog;
    dialog.className = "service-dialog";
    dialog.setAttribute("aria-labelledby", "service-dialog-title");
    const form = document.createElement("form");
    form.className = "service-dialog-form";
    form.noValidate = true;
    const title = document.createElement("h2");
    title.id = "service-dialog-title";
    title.textContent =
      dialogMode.type === "create"
        ? t("services.add")
        : t("services.editTitle", {
            name: draft.name || providers[draft.provider].name,
          });
    const content = document.createElement("div");
    content.className = "service-dialog-content";
    const footer = document.createElement("div");
    footer.className = "service-dialog-footer";
    const help = document.createElement("small");
    help.textContent = dialogHelp.saveHelp ?? t("services.draftHelp");
    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = t("common.cancel");
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.textContent = t(
      dialogMode.type === "create" ? "services.add" : "services.apply",
    );
    actions.append(cancel, apply);
    footer.append(help, actions);
    form.append(title, content, footer);
    dialog.append(form);
    document.body.append(dialog);
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      closeEditor = null;
      updateDialogNotifications = null;
      activeDialog = null;
      mode = null;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (disposed) return;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else if (dialogMode.type === "edit" && cards.has(dialogMode.serviceId))
        focusCard(dialogMode.serviceId);
      else
        document.getElementById("add-service")?.focus({ preventScroll: true });
    };
    closeEditor = finish;
    cancel.addEventListener("click", finish);
    dialog.addEventListener("close", finish);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        finish();
    });

    const providerField = document.createElement("fieldset");
    providerField.className = "service-provider-field";
    const legend = document.createElement("legend");
    legend.textContent = t("services.provider");
    const providerChoices = document.createElement("div");
    providerChoices.className = "service-provider-choices";
    providerField.append(legend, providerChoices);
    const radios = new Map<ProviderId, HTMLInputElement>();
    for (const id of Object.keys(providers) as ProviderId[]) {
      const definition = providers[id];
      const label = document.createElement("label");
      label.className = "service-provider-choice";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "service-provider";
      radio.value = id;
      radio.checked = id === draft.provider;
      radio.id = `service-dialog-provider-${id}`;
      label.htmlFor = radio.id;
      radios.set(id, radio);
      const name = document.createElement("span");
      name.className = "service-provider-choice-name";
      name.textContent = definition.name;
      label.append(radio, providerIcon(id), name);
      if (definition.experimental) {
        const badge = document.createElement("span");
        badge.className = "experimental-badge";
        badge.textContent = t("services.experimental");
        label.append(badge);
      }
      radio.addEventListener("change", () => {
        if (!radio.checked || disabled) return;
        const old = providers[draft.provider];
        draft.provider = id;
        if (
          dialogMode.type === "create" &&
          (draft.name === old.name || draft.name === "ChatPlus")
        ) {
          draft.name = definition.name;
          nameInput.value = draft.name;
        }
        if (
          definition.urlMode === "fixed" ||
          old.urlMode === "fixed" ||
          definition.urlMode !== old.urlMode
        )
          draft.url = definition.defaultUrl;
        draft.notifications =
          draft.notifications && supportsNotifications(draft);
        updateProvider();
      });
      providerChoices.append(label);
    }
    content.append(providerField);
    const field = (key: string, text: string, control: HTMLInputElement) => {
      const wrapper = document.createElement("div");
      wrapper.className = "service-field";
      control.id = `service-dialog-${key}`;
      control.className = "service-control";
      const label = document.createElement("label");
      label.htmlFor = control.id;
      label.textContent = text;
      wrapper.append(label, control);
      content.append(wrapper);
      return wrapper;
    };
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.required = true;
    nameInput.maxLength = 60;
    nameInput.value = draft.name;
    nameInput.autocomplete = "off";
    nameInput.addEventListener("input", () => {
      draft.name = nameInput.value;
      nameInput.setCustomValidity("");
    });
    field("name", t("services.name"), nameInput);
    const url = document.createElement("input");
    url.type = "url";
    url.autocomplete = "off";
    url.spellcheck = false;
    const urlField = field("url", t("settings.serverUrl"), url);
    url.addEventListener("input", () => {
      draft.url = url.value;
      url.setCustomValidity("");
      updateNotifications();
    });
    const options = document.createElement("div");
    options.className = "service-dialog-options";
    const toggle = (key: "enabled" | "notifications", text: string) => {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `service-dialog-${key}`;
      checkbox.checked = draft[key];
      const label = document.createElement("label");
      label.className = "toggle";
      label.htmlFor = checkbox.id;
      label.append(checkbox, text);
      checkbox.addEventListener("change", () => {
        draft[key] = checkbox.checked;
      });
      options.append(label);
      return checkbox;
    };
    toggle("enabled", t("services.enabled"));
    const notificationToggle = toggle(
      "notifications",
      t("services.allowNotifications"),
    );
    const notificationHelp = document.createElement("small");
    notificationHelp.id = "service-dialog-notification-help";
    notificationToggle.setAttribute("aria-describedby", notificationHelp.id);
    options.append(notificationHelp);
    content.append(options);
    const colorField = document.createElement("fieldset");
    colorField.className = "service-color-field";
    const colorLegend = document.createElement("legend");
    colorLegend.textContent = t("services.color");
    const swatches = document.createElement("div");
    swatches.className = "service-color-swatches";
    const colorButtons = new Map<string, HTMLButtonElement>();
    draft.notificationColor = normalizeNotificationColor(
      draft.notificationColor,
    );
    for (const color of notificationColors) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "service-color-swatch";
      swatch.title = t(`services.color.${color}` as TranslationKey);
      swatch.setAttribute("aria-label", swatch.title);
      const circle = document.createElement("span");
      circle.className = "service-color-circle";
      circle.setAttribute("aria-hidden", "true");
      circle.textContent = color === "auto" ? "A" : "";
      swatch.append(circle);
      swatch.addEventListener("click", () => {
        if (disabled) return;
        draft.notificationColor = color;
        updateColors();
      });
      colorButtons.set(color, swatch);
      swatches.append(swatch);
    }
    const customControls = document.createElement("div");
    customControls.className = "service-custom-color-controls";
    const pickerLabel = document.createElement("label");
    pickerLabel.className = "service-color-picker-label";
    pickerLabel.textContent = t("services.colorCustom");
    const picker = document.createElement("input");
    picker.type = "color";
    picker.id = "service-dialog-custom-color";
    picker.className = "service-color-picker";
    pickerLabel.htmlFor = picker.id;
    const rgb = document.createElement("div");
    rgb.className = "service-color-rgb";
    const channels = (["r", "g", "b"] as const).map((channel) => {
      const label = document.createElement("label");
      const title = document.createElement("span");
      title.textContent = channel.toUpperCase();
      const input = document.createElement("input");
      input.id = `service-dialog-color-${channel}`;
      input.type = "number";
      input.min = "0";
      input.max = "255";
      input.step = "1";
      input.inputMode = "numeric";
      input.required = true;
      input.setAttribute("aria-label", t(`services.colorChannel.${channel}`));
      label.htmlFor = input.id;
      label.append(title, input);
      rgb.append(label);
      input.addEventListener("input", () => {
        if (disabled) return;
        const valid = channels.map((control) => {
          const value = Number(control.value);
          const accepted =
            /^\d{1,3}$/.test(control.value) &&
            Number.isInteger(value) &&
            value >= 0 &&
            value <= 255;
          control.setCustomValidity(
            accepted ? "" : t("services.colorInvalidRgb"),
          );
          return accepted;
        });
        if (!valid.every(Boolean)) return;
        draft.notificationColor = normalizeNotificationColor(
          `#${channels.map((control) => Number(control.value).toString(16).padStart(2, "0")).join("")}`,
        );
        updateColors();
      });
      return input;
    });
    const hexLabel = document.createElement("label");
    hexLabel.className = "service-color-hex-label";
    hexLabel.textContent = "HEX";
    const hex = document.createElement("input");
    hex.id = "service-dialog-color-hex";
    hex.type = "text";
    hex.maxLength = 7;
    hex.required = true;
    hex.autocomplete = "off";
    hex.spellcheck = false;
    hex.setAttribute("aria-label", t("services.colorHex"));
    hexLabel.htmlFor = hex.id;
    hexLabel.append(hex);
    const random = document.createElement("button");
    random.id = "service-dialog-random-color";
    random.type = "button";
    random.className = "secondary service-random-color";
    random.textContent = t("services.colorRandom");
    picker.addEventListener("input", () => {
      if (disabled) return;
      draft.notificationColor = normalizeNotificationColor(picker.value);
      updateColors();
    });
    hex.addEventListener("input", () => {
      if (disabled) return;
      const color = normalizeNotificationColor(hex.value);
      const valid = color.startsWith("#");
      hex.setCustomValidity(valid ? "" : t("services.colorInvalidHex"));
      if (!valid) return;
      draft.notificationColor = color;
      updateColors();
    });
    random.addEventListener("click", () => {
      if (disabled) return;
      draft.notificationColor = randomNotificationColor();
      updateColors();
    });
    customControls.append(pickerLabel, picker, rgb, hexLabel, random);
    const preview = document.createElement("div");
    preview.className = "service-color-preview";
    const badge = document.createElement("span");
    badge.className = "notification-badge service-unread-preview";
    badge.textContent = "99+";
    badge.setAttribute("aria-hidden", "true");
    const previewLabel = document.createElement("span");
    previewLabel.textContent = t("services.colorPreview");
    preview.append(badge, previewLabel);
    const colorHelp = document.createElement("small");
    colorHelp.id = "service-dialog-color-help";
    colorHelp.textContent = t("services.colorHelp");
    picker.setAttribute("aria-describedby", colorHelp.id);
    colorField.append(
      colorLegend,
      swatches,
      customControls,
      preview,
      colorHelp,
    );
    content.append(colorField);
    const experimentalHelp = document.createElement("small");
    experimentalHelp.className = "service-dialog-provider-help";
    experimentalHelp.textContent = t("services.ssoHelp");
    content.append(experimentalHelp);
    const error = document.createElement("p");
    error.className = "service-dialog-error";
    error.setAttribute("role", "alert");
    content.append(error);
    function updateColors() {
      for (const [color, button] of colorButtons) {
        button.setAttribute(
          "aria-pressed",
          String(color === draft.notificationColor),
        );
        applyNotificationColor(button, {
          provider: draft.provider,
          notificationColor: normalizeNotificationColor(color),
        });
      }
      applyNotificationColor(preview, draft);
      const color = resolveNotificationColor(draft).background;
      const customHex = /^#[\da-f]{6}$/i.test(color) ? color : "#2563c5";
      picker.value = customHex;
      hex.value = customHex;
      hex.setCustomValidity("");
      channels.forEach((control, index) => {
        control.value = String(
          Number.parseInt(customHex.slice(1 + index * 2, 3 + index * 2), 16),
        );
        control.setCustomValidity("");
      });
    }
    function updateProvider() {
      const definition = providers[draft.provider];
      for (const [id, radio] of radios) {
        radio.checked = id === draft.provider;
        radio.closest("label")?.classList.toggle("is-selected", radio.checked);
      }
      urlField.hidden = definition.urlMode === "fixed";
      url.required = definition.urlMode !== "fixed";
      url.disabled = definition.urlMode === "fixed" || disabled;
      urlField.querySelector("label")!.textContent = t(
        definition.urlMode === "workspace"
          ? "settings.workspaceUrl"
          : "settings.serverUrl",
      );
      url.value = draft.url;
      url.placeholder = definition.defaultUrl || "https://example.com/chat/";
      url.setCustomValidity("");
      updateNotifications();
      experimentalHelp.hidden = !definition.experimental;
      updateColors();
    }
    function updateNotifications() {
      const supported = supportsNotifications(draft);
      url.disabled = providers[draft.provider].urlMode === "fixed" || disabled;
      notificationToggle.disabled = !supported || disabled;
      notificationToggle.checked = draft.notifications && supported;
      notificationHelp.textContent = t(
        supported
          ? "services.notificationHelp"
          : "services.notificationsUnsupported",
      );
    }
    updateDialogNotifications = updateNotifications;
    updateProvider();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (disabled || disposed || mode !== dialogMode) return;
      error.textContent = "";
      nameInput.setCustomValidity(
        nameInput.value.trim() ? "" : t("services.nameRequired"),
      );
      url.setCustomValidity("");
      try {
        normalizedServiceUrl(draft);
      } catch (invalid) {
        url.setCustomValidity((invalid as Error).message);
      }
      if (!form.reportValidity()) return;
      let next: ServiceConfig = { ...draft, name: nameInput.value.trim() };
      let index = -1;
      let notificationServiceId: string | undefined;
      if (dialogMode.type === "create") {
        if (services.length >= 12) {
          error.textContent = t("services.limit");
          return;
        }
        // Creating appends a fresh identity and never uses an existing profile as its base.
        while (
          services.some(
            (service) => service.id.toLowerCase() === next.id.toLowerCase(),
          )
        )
          next.id = `service-${crypto.randomUUID()}`;
      } else {
        index = services.findIndex(
          (service) => service.id === dialogMode.serviceId,
        );
        if (index < 0) {
          error.textContent = t("services.unavailableDraft");
          return;
        }
        const current = services[index];
        // A rail mute/settings event may arrive while this dialog is open. Preserve
        // every current field the user left unchanged in their isolated dialog.
        next = {
          ...current,
          id: dialogMode.serviceId,
          provider:
            draft.provider === opening.provider
              ? current.provider
              : draft.provider,
          name:
            draft.name === opening.name ? current.name : nameInput.value.trim(),
          url: draft.url === opening.url ? current.url : draft.url,
          enabled:
            draft.enabled === opening.enabled ? current.enabled : draft.enabled,
          notifications:
            draft.notifications === opening.notifications
              ? current.notifications
              : draft.notifications,
          notificationColor:
            normalizeNotificationColor(draft.notificationColor) ===
            normalizeNotificationColor(opening.notificationColor)
              ? current.notificationColor
              : draft.notificationColor,
        };
        if (
          current.notifications !== next.notifications ||
          current.provider !== next.provider
        )
          notificationServiceId = next.id;
      }
      try {
        next.url = normalizedServiceUrl(next);
      } catch (invalid) {
        error.textContent = (invalid as Error).message;
        return;
      }
      next.notifications = next.notifications && supportsNotifications(next);
      // Missing legacy colors remain untouched when editing other fields.
      if (next.notificationColor !== undefined)
        next.notificationColor = normalizeNotificationColor(
          next.notificationColor,
        );
      if (index < 0) services.push(next);
      else {
        if (JSON.stringify(services[index]) === JSON.stringify(next)) {
          finish();
          return;
        }
        services[index] = next;
      }
      render();
      finish();
      onChange(notificationServiceId ? { notificationServiceId } : undefined);
    });
    try {
      dialog.showModal();
      if (focusField === "notifications" && !notificationToggle.disabled)
        notificationToggle.focus();
      else {
        nameInput.focus();
        if (dialogMode.type === "edit") nameInput.select();
      }
    } catch {
      finish();
      live.textContent = t("services.settingsError");
    }
  };

  function add(provider: ProviderId = "synology-chatplus") {
    if (disabled || disposed || mode) return;
    if (services.length >= 12) {
      live.textContent = t("services.limit");
      return;
    }
    // Every opening, including after Cancel, allocates a new isolated draft and UUID.
    open(
      { type: "create" },
      {
        id: `service-${crypto.randomUUID()}`,
        provider,
        name: providers[provider].name,
        url: providers[provider].defaultUrl,
        enabled: true,
        notifications: providers[provider].notifications,
        notificationColor: randomNotificationColor(),
      },
    );
  }
  function edit(id: string, field?: "name" | "notifications") {
    const service = services.find((item) => item.id === id);
    if (!service) {
      live.textContent = t("services.unavailableDraft");
      return;
    }
    open({ type: "edit", serviceId: id }, structuredClone(service), field);
  }
  async function remove(id: string): Promise<boolean> {
    if (disabled || disposed || mode || document.querySelector("dialog[open]"))
      return false;
    const service = services.find((item) => item.id === id);
    if (!service) return false;
    finishDrag(false);
    const removalMode: ServiceDialogMode = { type: "remove", serviceId: id };
    mode = removalMode;
    removalController = new AbortController();
    try {
      const accepted = await confirmServiceRemoval(service.name, {
        help: dialogHelp.removalHelp ?? t("services.draftRemovalHelp"),
        signal: removalController.signal,
      });
      if (!accepted || disposed || disabled || mode !== removalMode)
        return false;
      const index = services.findIndex((item) => item.id === id);
      if (index < 0) return false;
      // This only edits the Settings draft. Save owns persistence and native view cleanup.
      services.splice(index, 1);
      render();
      onChange();
      const next = services[Math.min(index, services.length - 1)];
      if (next) focusCard(next.id);
      else
        document.getElementById("add-service")?.focus({ preventScroll: true });
      return true;
    } catch {
      if (!disposed) live.textContent = t("services.removeError");
      return false;
    } finally {
      if (mode === removalMode) mode = null;
      removalController = null;
      if (
        !disposed &&
        document.hasFocus() &&
        document.activeElement === document.body &&
        !document.querySelector("dialog[open]")
      ) {
        if (cards.has(id)) focusCard(id);
        else
          document
            .getElementById("add-service")
            ?.focus({ preventScroll: true });
      }
    }
  }

  render();
  return {
    add,
    edit,
    remove,
    refresh() {
      const focused = document.activeElement as HTMLElement | null;
      const id =
        focused?.closest<HTMLElement>(".service-card")?.dataset.serviceId;
      const action = focused?.dataset.action;
      const index = id ? [...cards.keys()].indexOf(id) : -1;
      finishDrag(false);
      render();
      updateDialogNotifications?.();
      if (!id || !action || mode || !document.hasFocus()) return;
      if (cards.has(id)) focusCard(id, action);
      else {
        const next =
          services[Math.min(Math.max(index, 0), services.length - 1)];
        if (next) focusCard(next.id);
        else
          document
            .getElementById("add-service")
            ?.focus({ preventScroll: true });
      }
    },
    setDisabled(value: boolean) {
      disabled = value;
      finishDrag(false);
      const focused = document.activeElement as HTMLElement | null;
      const id =
        focused?.closest<HTMLElement>(".service-card")?.dataset.serviceId;
      const action = focused?.dataset.action;
      render();
      if (!disabled && id && action) focusCard(id, action);
      if (activeDialog) {
        for (const control of activeDialog.querySelectorAll<
          HTMLInputElement | HTMLButtonElement
        >("input, button"))
          control.disabled = disabled;
        updateDialogNotifications?.();
      }
    },
    isDialogOpen: () => mode !== null,
    dispose() {
      disposed = true;
      finishDrag(false);
      closeEditor?.();
      removalController?.abort();
      mode = null;
      cards.clear();
      container.replaceChildren();
    },
  };
}
